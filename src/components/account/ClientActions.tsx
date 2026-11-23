"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ExternalLink, LogOut, RotateCcw, Tag, X, Zap } from "lucide-react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { authClient, useSession } from "@/lib/auth-client";
import { localePath } from "@/lib/paths";
import { Field, FormMessage } from "@/components/auth/fields";
import { SwapLabel } from "@/components/ui";
import { usePulse } from "@/lib/pulse";
import { NewPasswordField, PasswordInput } from "@/components/auth/PasswordInput";
import { isValidPassword } from "@/lib/password";

/** 价格页地址里的优惠码（/pricing?code=XXX）；服务端渲染时没有地址栏，返回空 */
const PROMO_CODE = /^[A-Za-z0-9-]{3,32}$/;
const readPromoCode = () => {
  const code = new URLSearchParams(window.location.search).get("code") ?? "";
  return PROMO_CODE.test(code) ? code.toUpperCase() : "";
};
const noSubscribe = () => () => {};
const usePromoCode = () => useSyncExternalStore(noSubscribe, readPromoCode, () => "");

/** 价格页上提示「结账时会自动填入优惠码」：发推广链接时让用户知道折扣已经带上了 */
export function PromoCodeNotice({ template }: { template: string }) {
  const code = usePromoCode();
  if (!code) return null;
  const [before, after] = template.split("{code}");
  return (
    <p className="mx-auto mt-7 inline-flex max-w-full items-center gap-2.5 rounded-full border border-brand-1/35 bg-brand-soft py-1.5 pr-4 pl-1.5 text-sm text-brand-soft-fg shadow-[0_0_24px_-10px_var(--glow-1)]">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
        <Tag className="size-3.5" />
      </span>
      <span>
        {before}
        <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.8125rem] font-medium text-fg">{code}</span>
        {after}
      </span>
    </p>
  );
}

/** 价格页购买按钮：未登录先去登录（带着优惠码回来），登录后创建订单并跳转收银台 */
export function BuyButton({
  planId,
  label,
  t,
  locale,
  highlight,
}: {
  planId: string;
  label: string;
  t: Dictionary["pricing"];
  locale: Locale;
  highlight?: boolean;
}) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const code = usePromoCode();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const buy = async () => {
    if (!session) {
      const back = localePath(locale, "/pricing") + (code ? `?code=${encodeURIComponent(code)}` : "");
      router.push(`${localePath(locale, "/login")}?next=${encodeURIComponent(back)}`);
      return;
    }
    setPending(true);
    setError("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, locale, ...(code ? { code } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (data.url) return void (window.location.href = data.url);
    setPending(false);
    setError(data.error ?? "error");
  };

  return (
    <div>
      <button
        type="button"
        onClick={buy}
        disabled={pending || isPending}
        className={`btn btn-lg w-full ${highlight ? "btn-brand" : "btn-primary"}`}
      >
        {pending ? t.redirecting : !isPending && !session ? t.signInFirst : label}
      </button>
      {error && <p className="mt-2 text-center text-xs text-danger-fg">{error}</p>}
    </div>
  );
}

/** 用户中心：演示消耗 1 积分 */
export function SpendDemo({ t, className = "btn btn-glass btn-sm" }: { t: Dictionary["account"]; className?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState(false);

  const spend = async () => {
    setPending(true);
    const res = await fetch("/api/credits/spend", { method: "POST" });
    setPending(false);
    setMsg(res.ok ? t.spent : t.insufficient);
    router.refresh();
  };

  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" onClick={spend} disabled={pending} className={className}>
        <Zap className="size-3.5" /> {t.tryIt}
      </button>
      {msg && <span className="text-xs opacity-80">{msg}</span>}
    </span>
  );
}

/** 跳转 Stripe 订阅管理页 */
export function ManageSubscriptionButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  const open = async () => {
    setPending(true);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (data.url) window.location.href = data.url;
    else setPending(false);
  };
  return (
    <button type="button" onClick={open} disabled={pending} className="btn btn-secondary btn-sm">
      {label} <ExternalLink className="size-3.5 text-fg-3" />
    </button>
  );
}

/** 撤销还在审核中的退款申请：冻结的积分立即退回（心跳刷新右上角积分） */
export function CancelRefundButton({ id, label, confirmText }: { id: string; label: string; confirmText: string }) {
  const router = useRouter();
  const pulse = usePulse();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (!confirm(confirmText)) return;
        setPending(true);
        await fetch(`/api/refunds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        setPending(false);
        pulse?.refresh();
        router.refresh();
      }}
      className="text-xs text-fg-3 underline decoration-line-2 underline-offset-[3px] transition hover:text-fg"
    >
      {label}
    </button>
  );
}

/**
 * 用户中心：申请退款。金额和要扣的积分由服务端按未用积分算好（summary 里已经填好），这里只提交付款 id 和原因
 * 点击后弹出原生 <dialog>：Esc 和遮罩都能关闭，键盘焦点自动进入弹窗
 */
export function RefundRequestButton({
  paymentId,
  summary,
  rules,
  t,
}: {
  paymentId: string;
  summary: string;
  rules: string;
  t: Dictionary["account"]["refund"];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  const close = () => {
    dialog.current?.close();
    setOpen(false);
    setError("");
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await fetch("/api/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, reason: String(new FormData(e.currentTarget).get("reason")) }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (res.ok) {
      close();
      router.refresh();
    } else setError(t.errors[data.error ?? ""] ?? data.error ?? "error");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-fg-3 underline decoration-line-2 underline-offset-[3px] transition hover:text-brand hover:decoration-current"
      >
        {t.request}
      </button>
      {open && (
        <dialog
          ref={dialog}
          onClose={() => setOpen(false)}
          onClick={(e) => e.target === dialog.current && close()}
          className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[1.25rem] border border-line bg-surface p-0 text-fg shadow-[0_40px_80px_-24px_rgb(var(--shadow)/0.6)] backdrop:bg-[rgb(var(--shadow)/0.45)] backdrop:backdrop-blur-sm"
        >
          <form onSubmit={onSubmit} className="p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <RotateCcw className="size-[18px]" />
              </span>
              <button type="button" onClick={close} aria-label={t.cancel} className="icon-btn size-8 border-transparent shadow-none">
                <X className="size-4" />
              </button>
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-[-0.02em]">{t.request}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-2">{summary}</p>
            <p className="mt-3 rounded-xl bg-canvas-2 px-3.5 py-3 text-xs leading-relaxed text-fg-3">{rules}</p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[0.8125rem] font-medium">{t.reason}</span>
              <textarea name="reason" required minLength={3} maxLength={500} rows={3} className="field" autoFocus />
            </label>
            {error && (
              <div className="mt-3">
                <FormMessage tone="error">{error}</FormMessage>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="btn btn-secondary">
                {t.cancel}
              </button>
              <button type="submit" disabled={pending} className="btn btn-primary">
                {t.submit}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}

export function ProfileForm({ name, t }: { name: string; t: Dictionary["account"] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await authClient.updateUser({ name: String(new FormData(e.currentTarget).get("name")) });
    setSaved(true);
    router.refresh();
  };
  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <input name="name" defaultValue={name} required aria-label={t.name} className="field field-sm" onChange={() => setSaved(false)} />
      <button type="submit" className="btn btn-secondary h-9 shrink-0">
        <SwapLabel show={saved} alt={t.saved}>
          {t.save}
        </SwapLabel>
      </button>
    </form>
  );
}

export function ChangePasswordForm({ t, auth }: { t: Dictionary["account"]; auth: Dictionary["auth"] }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [error, setError] = useState("");
  // 改成功后换 key，把受控的新密码框（和强度条）一起清空
  const [round, setRound] = useState(0);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (!isValidPassword(String(data.get("next")))) {
      setError(auth.passwordRule);
      setState("error");
      return;
    }
    setState("pending");
    const { error } = await authClient.changePassword({
      currentPassword: String(data.get("current")),
      newPassword: String(data.get("next")),
      revokeOtherSessions: true,
    });
    if (error) {
      setError(error.message || auth.genericError);
      setState("error");
    } else {
      form.reset();
      setRound((r) => r + 1);
      setState("done");
    }
  };
  return (
    <form onSubmit={onSubmit} onChange={() => state === "error" && setState("idle")} className="max-w-md space-y-4">
      <Field label={t.currentPassword}>
        <PasswordInput t={auth} name="current" required autoComplete="current-password" className="field field-sm" />
      </Field>
      <NewPasswordField key={round} t={auth} label={auth.newPassword} name="next" compact />
      {state === "error" && <FormMessage tone="error">{error}</FormMessage>}
      {state === "done" && <FormMessage tone="success">{t.saved}</FormMessage>}
      <button type="submit" disabled={state === "pending"} className="btn btn-primary btn-sm">
        {t.changePassword}
      </button>
    </form>
  );
}

export function SignOutButton({ label, locale }: { label: string; locale: Locale }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        await authClient.signOut();
        router.push(localePath(locale));
        router.refresh();
      }}
    >
      <LogOut className="size-3.5" /> {label}
    </button>
  );
}

/** 模拟收银台的支付按钮（仅开发环境） */
export function MockPayButton({ orderId, next, label }: { orderId: string; next: string; label: string }) {
  const [pending, setPending] = useState(false);
  const pay = async () => {
    setPending(true);
    const res = await fetch("/api/mock/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    if (res.ok) window.location.href = next;
    else setPending(false);
  };
  return (
    <button type="button" onClick={pay} disabled={pending} className="btn btn-brand btn-lg w-full">
      {pending ? "…" : label}
    </button>
  );
}
