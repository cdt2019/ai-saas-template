"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { isValidPassword } from "@/lib/password";
import { Field } from "./fields";

type T = Dictionary["auth"];

/**
 * 设新密码的输入框：右上角写着规则（至少 8 位、字母和数字），满足后变绿打勾；下面是强度条。
 * 提交时父表单用 isValidPassword 再查一遍，不满足就提示、不提交
 */
export function NewPasswordField({ t, label, name = "password", compact = false }: { t: T; label: string; name?: string; compact?: boolean }) {
  const [password, setPassword] = useState("");
  const ok = isValidPassword(password);
  return (
    <Field
      label={label}
      hint={
        <span className={`inline-flex items-center gap-1 transition-colors ${ok ? "text-success-fg" : ""}`}>
          {ok && <Check className="size-3.5" strokeWidth={2.5} />}
          {t.passwordHint}
        </span>
      }
    >
      <PasswordInput
        t={t}
        name={name}
        required
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={compact ? "field field-sm" : "field"}
      />
      <PasswordStrength value={password} t={t} />
    </Field>
  );
}

/** 密码框：右侧小眼睛切换显示 / 隐藏 */
export function PasswordInput({
  t,
  className = "field",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { t: Pick<T, "showPassword" | "hidePassword"> }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={visible ? "text" : "password"} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t.hidePassword : t.showPassword}
        title={visible ? t.hidePassword : t.showPassword}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-fg-3 transition hover:text-fg"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

const RULES = {
  length: (p: string) => p.length >= 8,
  case: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p),
  number: (p: string) => /\d/.test(p),
  symbol: (p: string) => /[^A-Za-z0-9]/.test(p),
};
// 一眼就能猜到的：重复字符、连续数字 / 键盘序列、常见弱密码
const WEAK = /^(.)\1+$|^(?:0123456789|1234567890|abcdefgh|qwertyui|asdfghjk)|password|passw0rd|qwerty|12345678|iloveyou|admin/i;

/** 0..4：长度、大小写、数字、符号各加分，长度 12+ 再加一分（不到 12 位最多「较强」）；太好猜的最多 1 分 */
export function scorePassword(p: string) {
  if (!p) return 0;
  let score = Object.values(RULES).filter((rule) => rule(p)).length;
  score = p.length >= 12 ? score + 1 : Math.min(score, 3);
  if (!RULES.length(p)) score = Math.min(score, 1);
  if (WEAK.test(p)) score = Math.min(score, 1);
  return Math.min(4, score);
}

const LEVELS = [
  { key: "weak", bar: "bg-danger", text: "text-danger-fg" },
  { key: "weak", bar: "bg-danger", text: "text-danger-fg" },
  { key: "fair", bar: "bg-warning", text: "text-warning-fg" },
  { key: "good", bar: "bg-success/55", text: "text-success-fg" },
  { key: "strong", bar: "bg-success", text: "text-success-fg" },
];

/** 密码强度：4 段条 + 等级（只是提示，不拦提交；最低 8 位由服务端校验） */
export function PasswordStrength({ value, t }: { value: string; t: Pick<T, "strength"> }) {
  const score = scorePassword(value);
  const level = LEVELS[score];
  const filled = value ? Math.max(1, score) : 0;
  return (
    <div className="mt-2 flex items-center gap-3" aria-live="polite">
      <div aria-hidden className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= filled ? level.bar : "bg-viz-muted"}`} />
        ))}
      </div>
      <span className={`w-12 text-right text-xs font-medium ${value ? level.text : "text-fg-3"}`}>{value ? t.strength[level.key] : ""}</span>
    </div>
  );
}
