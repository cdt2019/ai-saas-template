import "server-only";
import { headers } from "next/headers";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { captcha, emailOTP } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { siteConfig } from "@/config/site";
import { getDb, schema, type DB } from "@/db";
import { emailLayout, otpEmail, sendEmail } from "./email";
import { grantCredits } from "./credits";
import { authSecret } from "./env";
import { notify } from "./notify";
import { isValidPassword } from "./password";

/**
 * 登录认证（Better Auth）
 * - 邮箱 + 密码；邮箱验证和找回密码都用 6 位验证码（emailOTP 插件），不发链接
 * - 默认要求验证邮箱（AUTH_REQUIRE_EMAIL_VERIFICATION=false 可关）：注册后输入验证码才登录；
 *   没验证的账号登录时会自动再发一封验证码
 * - Google / GitHub：配置了对应环境变量才启用
 * - 新用户注册赠送积分：SIGNUP_BONUS_CREDITS（默认 10），开启邮箱验证时验证通过才发
 * - 人机验证：配置 TURNSTILE_SECRET_KEY 后，注册 / 登录 / 发验证码 / 找回密码都要求 Turnstile
 * - 管理员：见 src/lib/admin.ts（ADMIN_EMAILS 里的邮箱，且邮箱已验证）
 */
const SIGNUP_BONUS = Number(process.env.SIGNUP_BONUS_CREDITS ?? 10);
const REQUIRE_VERIFICATION = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "false";

/** 注册赠送积分：refId 按用户固定，重复调用只发一次 */
const grantSignupBonus = async (userId: string) => {
  if (SIGNUP_BONUS <= 0) return;
  if (await grantCredits({ userId, amount: SIGNUP_BONUS, reason: "signup_bonus", refId: `signup_${userId}` })) {
    await notify({ userId, type: "signup_bonus", params: { credits: SIGNUP_BONUS }, link: "/studio", refId: userId });
  }
};

/** 设密码的接口和对应的字段：服务端强制密码规则（至少 8 位，含字母和数字；浏览器端也会先查） */
const PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/email-otp/reset-password": "password",
  "/change-password": "newPassword",
};

/**
 * 用不到的接口直接关掉（返回 404）：链接式的验证邮件 / 重置密码（已改成验证码），
 * 以及验证码登录、改邮箱（不提供这些入口；验证码登录还会绕过注册页的防刷检查）
 */
const DISABLED_PATHS = [
  "/send-verification-email",
  "/verify-email",
  "/request-password-reset",
  "/reset-password",
  "/sign-in/email-otp",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];

function createAuth(db: DB) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  return betterAuth({
    appName: siteConfig.name,
    baseURL: process.env.BETTER_AUTH_URL ?? siteConfig.url,
    // 没配置时只有本机开发能用默认密钥；线上直接报错，避免用公开的默认密钥签发登录态
    secret: authSecret(),
    disabledPaths: DISABLED_PATHS,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const field = PASSWORD_FIELDS[ctx.path];
        const value = field ? ctx.body?.[field] : undefined;
        if (typeof value === "string" && !isValidPassword(value)) {
          throw new APIError("BAD_REQUEST", {
            code: "WEAK_PASSWORD",
            message: "Use at least 8 characters, including both letters and numbers.",
          });
        }
      }),
    },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    user: {
      additionalFields: {
        credits: { type: "number", required: false, defaultValue: 0, input: false },
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: REQUIRE_VERIFICATION,
      // 开启验证时，用已注册的邮箱再注册会返回和新注册一样的结果（不暴露邮箱是否已注册），
      // 实际不建号、不发验证码，而是给邮箱主人发这封提醒
      onExistingUserSignUp: async ({ user }) => {
        await sendEmail({
          to: user.email,
          subject: `Your ${siteConfig.name} account already exists`,
          html: emailLayout({
            title: "You already have an account",
            body: "Someone just tried to create a new account with this email. If it was you, sign in instead, or reset your password from the sign-in page if you've forgotten it. If it wasn't you, you can ignore this email.",
            action: { label: "Sign in", url: `${process.env.BETTER_AUTH_URL ?? siteConfig.url}/login` },
          }),
        });
      },
    },
    // 验证邮件由 emailOTP 插件接管（overrideDefaultEmailVerification），发的是验证码
    emailVerification: {
      sendOnSignUp: REQUIRE_VERIFICATION,
      sendOnSignIn: REQUIRE_VERIFICATION,
      autoSignInAfterVerification: true,
    },
    socialProviders,
    databaseHooks: {
      // 封禁中的账号不能建新的登录会话（密码、Google、验证码自动登录都走这里）；封禁时已有的会话由后台直接删掉
      session: {
        create: {
          before: async (s) => {
            const { user } = schema;
            const [banned] = await db
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.id, s.userId), eq(user.banned, true), or(isNull(user.banExpires), gt(user.banExpires, new Date()))));
            if (banned) throw new APIError("FORBIDDEN", { code: "BANNED", message: "This account has been suspended." });
          },
        },
      },
      user: {
        create: {
          // 注意：不在注册时按邮箱发管理员身份（见 src/lib/admin.ts，要求邮箱已验证）
          // 注册积分：不要求验证邮箱时直接发；要求时只发给已验证的（如 Google 登录），其余等验证通过
          after: async (user) => {
            if (!REQUIRE_VERIFICATION || user.emailVerified) await grantSignupBonus(user.id);
          },
        },
        update: {
          // 邮箱变成已验证（输入验证码、用验证码重置密码）时补发注册积分；已发过的不会重复
          after: async (user) => {
            if (user.emailVerified) await grantSignupBonus(user.id);
          },
        },
      },
    },
    plugins: [
      ...(process.env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: process.env.TURNSTILE_SECRET_KEY,
              // 会发邮件的接口都要过人机验证，防止被拿来轰炸别人的邮箱
              endpoints: ["/sign-up/email", "/sign-in/email", "/email-otp/send-verification-otp", "/email-otp/request-password-reset"],
            }),
          ]
        : []),
      emailOTP({
        otpLength: 6,
        expiresIn: 600, // 10 分钟
        allowedAttempts: 5, // 输错 5 次作废，要重新发
        storeOTP: "hashed",
        disableSignUp: true, // 只能从注册页建号（那里有防刷检查）
        overrideDefaultEmailVerification: true,
        rateLimit: { window: 60, max: 5 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendEmail({ to: email, ...otpEmail(otp, type) });
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

const globalForAuth = globalThis as unknown as { __auth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  if (!globalForAuth.__auth) {
    globalForAuth.__auth = getDb()
      .then(createAuth)
      .catch((e) => {
        globalForAuth.__auth = undefined;
        throw e;
      });
  }
  return globalForAuth.__auth;
}

/** 服务端获取当前登录用户（Server Component / Route Handler 里用），未登录返回 null */
export async function getSession(): Promise<Session | null> {
  // 先读请求头：让 Next 把调用它的页面识别为动态页面，避免构建时预渲染去连数据库
  const h = await headers();
  const auth = await getAuth();
  return auth.api.getSession({ headers: h });
}

/** 已启用的第三方登录（登录页据此显示按钮） */
export function enabledSocialProviders(): ("google" | "github")[] {
  const list: ("google" | "github")[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) list.push("google");
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) list.push("github");
  return list;
}
