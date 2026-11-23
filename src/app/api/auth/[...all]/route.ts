import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { isDisposableEmail, limits } from "@/lib/abuse";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

/** Better Auth 的全部接口：/api/auth/sign-in/email、/api/auth/callback/google 等 */
export async function GET(request: Request) {
  return toNextJsHandler(await getAuth()).GET(request);
}

/** 发验证码、输验证码的接口：按 IP 单独限流 */
const OTP_PATHS = new Set([
  "/email-otp/send-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/email-otp/check-verification-otp",
  "/email-otp/reset-password",
]);

/** POST 前先过防刷：按 IP 限流注册 / 登录 / 验证码，拦截临时邮箱注册 */
export async function POST(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  const ip = getClientIp(request.headers);

  if (path === "/sign-up/email") {
    const r = await rateLimit(`signup:${ip}`, limits.signUpPerIpPerHour, 3600);
    if (!r.ok) return tooManyRequests(r.retryAfter);
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { email?: string };
    if (body.email && isDisposableEmail(body.email)) {
      return Response.json(
        { code: "DISPOSABLE_EMAIL", message: "Please use a permanent email address." },
        { status: 400 },
      );
    }
  } else if (path === "/sign-in/email") {
    const r = await rateLimit(`signin:${ip}`, limits.signInPerIpPer10Min, 600);
    if (!r.ok) return tooManyRequests(r.retryAfter);
  } else if (OTP_PATHS.has(path)) {
    const r = await rateLimit(`otp:${ip}`, limits.otpPerIpPer10Min, 600);
    if (!r.ok) return tooManyRequests(r.retryAfter);
  }

  return toNextJsHandler(await getAuth()).POST(request);
}
