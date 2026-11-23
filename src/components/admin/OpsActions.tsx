"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Pencil, Play } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SwapLabel } from "@/components/ui";

type JobsT = Dictionary["admin"]["jobs"];

async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
  return { ok: res.ok, data };
}

/** 一个定时任务的操作：立即运行（运行中按钮显示转圈、宽度不变）、开关、改频率 */
export function JobControls({ name, enabled, schedule, defaultSchedule, t }: { name: string; enabled: boolean; schedule: string; defaultSchedule: string; t: JobsT }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [cron, setCron] = useState(schedule);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMsg(null);
    const { ok, data } = await post("/api/admin/jobs", { name, action, ...extra });
    setBusy("");
    if (!ok) setMsg({ ok: false, text: t.errors[data.error ?? ""] ?? data.error ?? "error" });
    else if (action === "run") setMsg({ ok: data.status === "success", text: t.ran.replace("{status}", t.statuses[data.status ?? ""] ?? String(data.status)) });
    if (ok && action === "schedule") setEditing(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => act("run")} disabled={!!busy} className="btn btn-secondary btn-sm h-8">
          <SwapLabel show={busy === "run"} alt={<LoaderCircle className="size-3.5 animate-spin" />}>
            <Play className="size-3.5" /> {t.runNow}
          </SwapLabel>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? t.disable : t.enable}
          title={enabled ? t.disable : t.enable}
          onClick={() => act(enabled ? "disable" : "enable")}
          disabled={!!busy}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${enabled ? "bg-success" : "bg-viz-muted"}`}
        >
          <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${enabled ? "left-[1.125rem]" : "left-0.5"}`} />
        </button>
        <button type="button" onClick={() => setEditing((v) => !v)} aria-label={t.editSchedule} title={t.editSchedule} className="icon-btn size-8">
          <Pencil className="size-3.5" />
        </button>
      </div>
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("schedule", { schedule: cron });
          }}
          className="flex items-center gap-1.5"
        >
          <input value={cron} onChange={(e) => setCron(e.target.value)} aria-label={t.schedule} placeholder={defaultSchedule} className="field field-sm h-8 w-40 font-mono text-xs" />
          <button type="submit" disabled={!!busy} className="btn btn-primary btn-sm h-8">
            {t.save}
          </button>
          <button
            type="button"
            onClick={() => {
              setCron(defaultSchedule);
              act("schedule", { schedule: "" });
            }}
            className="btn btn-ghost btn-sm h-8 text-xs"
          >
            {t.reset}
          </button>
        </form>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</p>}
    </div>
  );
}

/** 账务问题的处理：标为已解决 / 忽略（可写备注）/ 重新打开 */
export function IssueActions({ id, status, t }: { id: string; status: string; t: Dictionary["admin"]["recon"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (action: string) => {
    const note = action === "reopen" ? undefined : (prompt(t.notePrompt) ?? undefined);
    if (note === undefined && action !== "reopen") return;
    setBusy(true);
    await post("/api/admin/issues", { id, action, note });
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="flex gap-1.5">
      {status === "open" ? (
        <>
          <button type="button" disabled={busy} onClick={() => act("resolve")} className="btn btn-secondary btn-sm h-7 px-2.5 text-xs">
            {t.resolve}
          </button>
          <button type="button" disabled={busy} onClick={() => act("ignore")} className="btn btn-ghost btn-sm h-7 px-2.5 text-xs">
            {t.ignore}
          </button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => act("reopen")} className="btn btn-ghost btn-sm h-7 px-2.5 text-xs">
          {t.reopen}
        </button>
      )}
    </div>
  );
}

/** 「立即检查」：手动跑一次账务检查任务 */
export function RunJobButton({ name, label, runningLabel }: { name: string; label: string; runningLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post("/api/admin/jobs", { name, action: "run" });
        setBusy(false);
        router.refresh();
      }}
      className="btn btn-secondary btn-sm"
    >
      <SwapLabel
        show={busy}
        alt={
          <>
            <LoaderCircle className="size-3.5 animate-spin" /> {runningLabel}
          </>
        }
      >
        <Play className="size-3.5" /> {label}
      </SwapLabel>
    </button>
  );
}
