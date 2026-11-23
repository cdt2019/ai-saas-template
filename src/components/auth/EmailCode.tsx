"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MailCheck } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { DevNote } from "./fields";
import { captchaHeaders, TURNSTILE_SITE_KEY, useTurnstile } from "./Turnstile";

type T = Dictionary["auth"];

export const CODE_LENGTH = 6;
const RESEND_AFTER = 60;

/** Better Auth 验证码接口的错误 → 给用户看的提示 */
export function codeError(error: { code?: string; status?: number; message?: string }, t: T) {
  if (error.status === 429) return t.tooMany;
  if (error.code === "INVALID_OTP") return t.codeInvalid;
  if (error.code === "OTP_EXPIRED") return t.codeExpired;
  if (error.code === "TOO_MANY_ATTEMPTS") return t.codeTooMany;
  return error.message || t.genericError;
}

/** 把文案里的 {email} 换成加粗的邮箱 */
export function withEmail(text: string, email: string) {
  const [before, after] = text.split("{email}");
  return (
    <>
      {before}
      <span className="font-medium [overflow-wrap:anywhere] text-fg">{email}</span>
      {after}
    </>
  );
}

/** 验证码页的卡片头：图标 + 标题 + 说明 */
export function CodeCard({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="bezel">
      <div className="card p-6">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <MailCheck className="size-6" />
        </span>
        <h2 className="mt-4 text-center text-lg font-semibold tracking-[-0.02em]">{title}</h2>
        <p className="mt-2 text-center text-sm leading-relaxed text-fg-2">{lead}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/**
 * 6 位验证码：一个真实输入框盖在 6 个格子上（透明），
 * 粘贴整串、手机键盘上的「从邮件填充」、退格都按普通输入框处理
 */
export function CodeInput({
  value,
  onChange,
  label,
  invalid = false,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div className="relative">
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const current = focused && i === active;
          return (
            <span
              key={i}
              className={`grid h-13 place-items-center rounded-xl border bg-surface font-mono text-[1.375rem] font-semibold shadow-[0_1px_2px_rgb(var(--shadow)/0.04)] transition ${
                current ? "border-brand-1 ring-4 ring-brand-1/18" : invalid ? "border-danger" : value[i] ? "border-line-2" : "border-line"
              }`}
            >
              {value[i] ?? (current && <span className="h-6 w-px animate-pulse bg-fg" />)}
            </span>
          );
        })}
      </div>
      <input
        name="otp"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={label}
        aria-invalid={invalid}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        required
        autoFocus // 刚切到验证码这一步，直接能输
        className="absolute inset-0 size-full cursor-text opacity-0"
      />
    </div>
  );
}

/**
 * 「没收到？重新发送」：60 秒倒计时。开了人机验证时在后台静默过一次（需要操作才显示），
 * onResend 返回错误提示，成功返回 null
 */
export function ResendCode({ t, onResend }: { t: T; onResend: (fetchOptions: ReturnType<typeof captchaHeaders>) => Promise<string | null> }) {
  const [left, setLeft] = useState(RESEND_AFTER);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [captcha, token, resetCaptcha] = useTurnstile({ quiet: true });

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const resend = async () => {
    setPending(true);
    const error = await onResend(captchaHeaders(token));
    setPending(false);
    resetCaptcha();
    setNote(error ? { ok: false, text: error } : { ok: true, text: t.codeResent });
    if (!error) setLeft(RESEND_AFTER);
  };

  return (
    <div className="space-y-2 text-center text-xs text-fg-3">
      {captcha}
      {note && <p className={note.ok ? "text-success-fg" : "text-danger-fg"}>{note.text}</p>}
      <p>
        {t.noCode}{" "}
        {left > 0 ? (
          <span className="tabular-nums">{t.resendIn.replace("{s}", String(left))}</span>
        ) : (
          <button type="button" onClick={resend} disabled={pending || (!!TURNSTILE_SITE_KEY && !token)} className="link">
            {t.resendCode}
          </button>
        )}
      </p>
    </div>
  );
}

/** 本地没配 Resend 时：验证码在 dev server 终端里 */
export function DevMailNote({ t }: { t: T }) {
  const [before, after] = t.devMail.split("{var}");
  return (
    <DevNote>
      {before}
      <code className="font-mono text-fg">RESEND_API_KEY</code>
      {after}
    </DevNote>
  );
}
