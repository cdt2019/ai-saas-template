"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { authClient } from "@/lib/auth-client";
import { isValidPassword } from "@/lib/password";
import { localePath } from "@/lib/paths";
import { GitHubIcon, GoogleIcon } from "@/components/icons";
import { CODE_LENGTH, CodeCard, CodeInput, codeError, DevMailNote, ResendCode, withEmail } from "./EmailCode";
import { DevNote, Field, FormMessage } from "./fields";
import { NewPasswordField, PasswordInput } from "./PasswordInput";
import { captchaHeaders, TURNSTILE_SITE_KEY, useTurnstile } from "./Turnstile";

type T = Dictionary["auth"];
type Social = "google" | "github";
type Method = Social | "email";

/** 只允许站内跳转，防止 ?next= 被用来做开放重定向 */
const safeNext = (next: string | undefined, fallback: string) =>
  next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;

/** 记住上次用哪种方式登录，按钮上标「上次使用」。只存在浏览器本地，和登录逻辑无关 */
const LAST_METHOD = "auth:last-method";
const lastMethodListeners = new Set<() => void>();
const readLastMethod = () => {
  try {
    return localStorage.getItem(LAST_METHOD) as Method | null;
  } catch {
    return null;
  }
};
const rememberMethod = (m: Method) => {
  try {
    localStorage.setItem(LAST_METHOD, m);
  } catch {}
  lastMethodListeners.forEach((l) => l());
};
const useLastMethod = () =>
  useSyncExternalStore(
    (l) => {
      lastMethodListeners.add(l);
      return () => lastMethodListeners.delete(l);
    },
    readLastMethod,
    () => null,
  );

const ICONS: Record<Social, typeof GoogleIcon> = { google: GoogleIcon, github: GitHubIcon };
const NAMES: Record<Social, string> = { google: "Google", github: "GitHub" };
const DEV = process.env.NODE_ENV !== "production";

/** 本地开发时列出还没配置的登录相关服务和对应的环境变量；生产环境不显示 */
function DevSetupNote({ t, google }: { t: T; google?: boolean }) {
  const items: [string, string[]][] = [];
  if (google === false) items.push([t.devGoogle, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]]);
  if (!TURNSTILE_SITE_KEY) items.push([t.devCaptcha, ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]]);
  if (!DEV || items.length === 0) return null;
  return (
    <DevNote>
      <p>{t.devHint}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map(([label, vars]) => (
          <li key={label}>
            <span className="text-fg">{label}</span>
            {vars.map((v) => (
              <code key={v} className="block font-mono break-all text-fg-2">
                {v}
              </code>
            ))}
          </li>
        ))}
      </ul>
    </DevNote>
  );
}

function SocialButtons({ providers, t, callbackURL }: { providers: Social[]; t: T; callbackURL: string }) {
  const last = useLastMethod();
  const devHint = DEV && (!providers.includes("google") || !TURNSTILE_SITE_KEY);
  return (
    <>
      {providers.length > 0 && (
        <div className="grid gap-2.5">
          {providers.map((p) => {
            const Icon = ICONS[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  rememberMethod(p);
                  authClient.signIn.social({ provider: p, callbackURL });
                }}
                className="btn btn-secondary btn-lg relative w-full text-[0.875rem]"
              >
                <Icon className={`size-[18px] ${p === "github" ? "text-fg" : ""}`} />
                {t.continueWith} {NAMES[p]}
                {last === p && <span className="badge badge-brand badge-plain absolute right-3 h-5">{t.lastUsed}</span>}
              </button>
            );
          })}
        </div>
      )}
      {devHint && (
        <div className={providers.length > 0 ? "mt-3" : ""}>
          <DevSetupNote t={t} google={providers.includes("google")} />
        </div>
      )}
      {(providers.length > 0 || devHint) && (
        <div className="my-6 flex items-center gap-3 text-xs text-fg-3">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-line" /> {t.or}
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-line" />
        </div>
      )}
    </>
  );
}

function SubmitButton({ pending, disabled, label }: { pending: boolean; disabled?: boolean; label: string }) {
  return (
    <button type="submit" disabled={pending || disabled} className="btn btn-primary btn-lg w-full">
      {pending ? "…" : label} {!pending && <ArrowRight className="size-4" />}
    </button>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="mx-auto mt-5 flex items-center gap-1.5 text-xs font-medium text-fg-2 hover:text-fg">
      <ArrowLeft className="size-3.5" /> {label}
    </button>
  );
}

/**
 * 验证邮箱：输入发到邮箱的 6 位验证码，填满自动提交。
 * 验证通过即登录（autoSignInAfterVerification），由 onVerified 跳转
 */
function VerifyEmailStep({
  email,
  lead,
  t,
  devMail,
  onVerified,
  onBack,
}: {
  email: string;
  lead: string;
  t: T;
  devMail: boolean;
  onVerified: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const verify = async (otp: string) => {
    if (pending || otp.length !== CODE_LENGTH) return;
    setPending(true);
    setError("");
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
    setPending(false);
    if (error) return setError(codeError(error, t));
    onVerified();
  };

  return (
    <>
      <CodeCard title={t.codeTitle} lead={withEmail(lead, email)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify(code);
          }}
          className="space-y-4"
        >
          <CodeInput
            value={code}
            label={t.codeLabel}
            invalid={!!error}
            onChange={(v) => {
              setCode(v);
              setError("");
              if (v.length === CODE_LENGTH) verify(v);
            }}
          />
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <SubmitButton pending={pending} disabled={code.length !== CODE_LENGTH} label={t.verifyButton} />
        </form>
        <div className="mt-5">
          <ResendCode
            t={t}
            onResend={async (fetchOptions) => {
              const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" }, fetchOptions);
              return error ? codeError(error, t) : null;
            }}
          />
        </div>
        {devMail && (
          <div className="mt-5">
            <DevMailNote t={t} />
          </div>
        )}
      </CodeCard>
      <BackLink onClick={onBack} label={t.differentEmail} />
    </>
  );
}

type FormProps = { t: T; locale: Locale; next?: string; providers: Social[]; devMail: boolean };

export function SignInForm({ t, locale, next, providers, devMail }: FormProps) {
  const router = useRouter();
  const target = safeNext(next, localePath(locale, "/dashboard"));
  const last = useLastMethod();
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState("");
  const [pending, setPending] = useState(false);
  const [captcha, token, resetCaptcha] = useTurnstile();

  const done = () => {
    rememberMethod("email");
    router.push(target);
    router.refresh();
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError("");
    const { error } = await authClient.signIn.email({ email, password: String(form.get("password")) }, captchaHeaders(token));
    setPending(false);
    if (error) {
      resetCaptcha();
      // 密码对但邮箱没验证：服务端已经自动发了验证码，切到输验证码
      if (error.code === "EMAIL_NOT_VERIFIED") return setUnverified(email);
      return setError(error.status === 429 ? t.tooMany : error.message || t.genericError);
    }
    done();
  };

  return (
    <>
      {unverified && (
        <VerifyEmailStep email={unverified} lead={t.codeSignInLead} t={t} devMail={devMail} onVerified={done} onBack={() => setUnverified("")} />
      )}
      <div hidden={!!unverified}>
        <SocialButtons providers={providers} t={t} callbackURL={target} />
        <form onSubmit={onSubmit} onChange={() => setError("")} className="space-y-4">
          <Field label={t.email} hint={last === "email" && providers.length > 0 ? <span className="badge badge-brand badge-plain h-5">{t.lastUsed}</span> : undefined}>
            <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="field" />
          </Field>
          <Field
            label={t.password}
            hint={
              <Link href={localePath(locale, "/forgot-password")} className="text-fg-2 hover:text-fg">
                {t.forgot}
              </Link>
            }
          >
            <PasswordInput t={t} name="password" required autoComplete="current-password" />
          </Field>
          {captcha}
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <SubmitButton pending={pending} disabled={!!TURNSTILE_SITE_KEY && !token} label={t.signIn} />
        </form>
      </div>
    </>
  );
}

export function SignUpForm({ t, locale, next, providers, devMail }: FormProps) {
  const router = useRouter();
  const target = safeNext(next, localePath(locale, "/dashboard"));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [captcha, token, resetCaptcha] = useTurnstile();

  const done = () => {
    rememberMethod("email");
    router.push(target);
    router.refresh();
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    if (!isValidPassword(String(form.get("password")))) return setError(t.passwordRule);
    setPending(true);
    setError("");
    const { data, error } = await authClient.signUp.email(
      // 注册页不填昵称：先用邮箱 @ 前面的部分，之后可以在设置里改
      { name: email.split("@")[0], email, password: String(form.get("password")) },
      captchaHeaders(token),
    );
    setPending(false);
    resetCaptcha();
    if (error) return setError(error.status === 429 ? t.tooMany : error.message || t.genericError);
    // 要验证邮箱时不会直接登录（没有 token），验证码已发出：切到输验证码
    if (!data?.token) return setSentTo(email);
    done();
  };

  return (
    <>
      {sentTo && <VerifyEmailStep email={sentTo} lead={t.codeSentTo} t={t} devMail={devMail} onVerified={done} onBack={() => setSentTo("")} />}
      {/* 切到验证码时只是藏起来，返回改邮箱时填过的内容还在 */}
      <div hidden={!!sentTo}>
        <SocialButtons providers={providers} t={t} callbackURL={target} />
        <form onSubmit={onSubmit} onChange={() => setError("")} className="space-y-4">
          <Field label={t.email}>
            <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="field" />
          </Field>
          <NewPasswordField t={t} label={t.password} />
          {captcha}
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <SubmitButton pending={pending} disabled={!!TURNSTILE_SITE_KEY && !token} label={t.signUp} />
          <p className="text-center text-xs leading-relaxed text-fg-3">{t.terms}</p>
        </form>
      </div>
    </>
  );
}

/**
 * 找回密码：输邮箱 → 发验证码 → 同一页输验证码 + 新密码。
 * 无论邮箱是否注册都进入第二步（不暴露邮箱是否存在）；没注册的邮箱收不到验证码，输什么都是「验证码不对」
 */
export function ForgotPasswordForm({ t, locale, devMail }: { t: T; locale: Locale; devMail: boolean }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [captcha, token, resetCaptcha] = useTurnstile();

  const sendCode = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError("");
    const { error } = await authClient.emailOtp.requestPasswordReset({ email }, captchaHeaders(token));
    setPending(false);
    resetCaptcha();
    if (error) return setError(codeError(error, t));
    setCode("");
    setStep("code");
  };

  const reset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!isValidPassword(String(form.get("password")))) return setError(t.passwordRule);
    setPending(true);
    setError("");
    const { error } = await authClient.emailOtp.resetPassword({ email, otp: code, password: String(form.get("password")) });
    setPending(false);
    if (error) return setError(codeError(error, t));
    setStep("done");
  };

  if (step === "done")
    return (
      <div className="space-y-4">
        <FormMessage tone="success">{t.resetDone}</FormMessage>
        <Link href={localePath(locale, "/login")} className="btn btn-primary btn-lg w-full">
          {t.signIn} <ArrowRight className="size-4" />
        </Link>
      </div>
    );

  if (step === "code")
    return (
      <>
        <CodeCard title={t.codeTitle} lead={withEmail(t.codeResetLead, email)}>
          <form onSubmit={reset} onChange={() => setError("")} className="space-y-4">
            <CodeInput
              value={code}
              label={t.codeLabel}
              onChange={(v) => {
                setCode(v);
                setError("");
              }}
            />
            <NewPasswordField t={t} label={t.newPassword} />
            {error && <FormMessage tone="error">{error}</FormMessage>}
            <SubmitButton pending={pending} disabled={code.length !== CODE_LENGTH} label={t.resetButton} />
          </form>
          <div className="mt-5">
            <ResendCode
              t={t}
              onResend={async (fetchOptions) => {
                const { error } = await authClient.emailOtp.requestPasswordReset({ email }, fetchOptions);
                return error ? codeError(error, t) : null;
              }}
            />
          </div>
          {devMail && (
            <div className="mt-5">
              <DevMailNote t={t} />
            </div>
          )}
        </CodeCard>
        <BackLink
          onClick={() => {
            setError("");
            setStep("email");
          }}
          label={t.differentEmail}
        />
      </>
    );

  return (
    <form onSubmit={sendCode} onChange={() => setError("")} className="space-y-4">
      <DevSetupNote t={t} />
      <Field label={t.email}>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          className="field"
        />
      </Field>
      {captcha}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <SubmitButton pending={pending} disabled={!!TURNSTILE_SITE_KEY && !token} label={t.sendCode} />
    </form>
  );
}
