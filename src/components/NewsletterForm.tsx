"use client";

import { useState } from "react";
import { ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/en";

type Labels = Dictionary["newsletter"];

/** 订阅表单（页脚、/newsletter 页）。website 是给机器人的隐藏蜜罐字段，真人看不到 */
export function NewsletterForm({ locale, t, className = "" }: { locale: string; t: Labels; className?: string }) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    setError("");
    const res = await fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale, website }) }).catch(() => null);
    if (res?.ok) return setState("done");
    setState("idle");
    setError(res?.status === 400 ? t.invalid : res?.status === 429 ? t.tooMany : t.failed);
  };

  if (state === "done") {
    return (
      <p role="status" className={`flex items-start gap-2 text-sm text-fg-2 ${className}`}>
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-fg" /> {t.checkInbox}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className={className}>
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          autoComplete="email"
          className="field field-sm min-w-0 flex-1"
        />
        <button type="submit" disabled={state === "busy"} aria-label={t.subscribe} className="btn btn-secondary btn-sm h-9 shrink-0">
          {state === "busy" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
          <span className="sr-only">{t.subscribe}</span>
        </button>
      </div>
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px opacity-0" />
      {error && <p role="alert" className="mt-1.5 text-xs text-danger-fg">{error}</p>}
    </form>
  );
}

/** /newsletter 页的确认 / 退订按钮：要真人按一下才生效 */
export function NewsletterAction({ action, token, t }: { action: "confirm" | "unsubscribe"; token: string; t: Labels }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid">("idle");
  const labels = action === "confirm" ? t.confirm : t.unsubscribe_;
  const run = async () => {
    setState("busy");
    const res = await fetch(`/api/newsletter/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    setState(res?.ok ? "done" : "invalid");
  };
  if (state === "done") {
    return (
      <p role="status" className="flex items-center justify-center gap-2 text-sm text-fg-2">
        <CircleCheck className="size-4 text-success-fg" /> {labels.done}
      </p>
    );
  }
  if (state === "invalid") return <p role="alert" className="text-sm text-danger-fg">{t.invalidLink}</p>;
  return (
    <button type="button" onClick={run} disabled={state === "busy"} className="btn btn-primary">
      {state === "busy" && <LoaderCircle className="size-4 animate-spin" />} {labels.button}
    </button>
  );
}
