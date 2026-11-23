"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { Select } from "@/components/Select";

type T = Dictionary["admin"]["newsletter"];

const post = async (body: Record<string, unknown>) => {
  const res = await fetch("/api/admin/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => ({}))) as { error?: string; to?: string; total?: number } | undefined;
  return { ok: !!res?.ok, data: data ?? {} };
};

/** 写一封群发：先发测试信给自己；发送要点两下（第二下显示收件人数），防手滑 */
export function CampaignComposer({ counts, audiences, t }: { counts: Record<string, number>; audiences: { value: string; label: string }[]; t: T }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [busy, setBusy] = useState("");
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const recipients = counts[audience] ?? 0;
  const ready = !!subject.trim() && !!body.trim();

  const act = async (action: "test" | "send") => {
    setBusy(action);
    setMsg(null);
    const { ok, data } = await post({ action, subject, body, audience, locale: audience === "zh" ? "zh" : "en" });
    setBusy("");
    setArmed(false);
    if (!ok) return setMsg({ ok: false, text: t.errors[data.error ?? ""] ?? t.errors.send_failed });
    if (action === "test") return setMsg({ ok: true, text: t.testSent.replace("{email}", data.to ?? "") });
    setMsg({ ok: true, text: t.queued.replace("{n}", String(data.total ?? recipients)) });
    setSubject("");
    setBody("");
    router.refresh();
  };

  return (
    <div className="space-y-3 p-4">
      <input value={subject} onChange={(e) => { setSubject(e.target.value); setArmed(false); }} maxLength={150} placeholder={t.subject} aria-label={t.subject} className="field field-sm" />
      <textarea value={body} onChange={(e) => { setBody(e.target.value); setArmed(false); }} rows={7} maxLength={20000} placeholder={t.body} aria-label={t.body} className="field text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-3">{t.audience}</span>
        <Select label={t.audience} value={audience} onChange={(v) => { setAudience(v); setArmed(false); }} options={audiences.map((a) => ({ ...a, label: `${a.label} (${counts[a.value] ?? 0})` }))} className="w-40" />
        <span className="flex-1" />
        <button type="button" disabled={!ready || !!busy} onClick={() => act("test")} className="btn btn-secondary btn-sm">
          {busy === "test" && <LoaderCircle className="size-3.5 animate-spin" />} {t.sendTest}
        </button>
        <button type="button" disabled={!ready || !!busy || recipients === 0} onClick={() => (armed ? act("send") : setArmed(true))} className={`btn btn-sm ${armed ? "btn-danger" : "btn-primary"}`}>
          {busy === "send" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {(armed ? t.confirmSend : t.send).replace("{n}", String(recipients))}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-fg-3">{t.bodyHint}</p>
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</p>}
    </div>
  );
}

/** 一个订阅者的操作：退订、删除（删除要点两下） */
export function SubscriberActions({ id, status, t }: { id: string; status: string; t: T }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const act = async (action: "unsubscribe" | "remove") => {
    setBusy(true);
    await post({ action, id });
    setBusy(false);
    setArmed(false);
    router.refresh();
  };
  return (
    <span className="flex justify-end gap-1">
      {status !== "unsubscribed" && (
        <button type="button" disabled={busy} onClick={() => act("unsubscribe")} className="btn btn-ghost btn-sm h-7 text-xs">
          {t.unsubscribe}
        </button>
      )}
      <button type="button" disabled={busy} onBlur={() => setArmed(false)} onClick={() => (armed ? act("remove") : setArmed(true))} className={`btn btn-ghost btn-sm h-7 text-xs ${armed ? "text-danger-fg" : ""}`}>
        {armed ? t.confirmRemove : t.remove}
      </button>
    </span>
  );
}
