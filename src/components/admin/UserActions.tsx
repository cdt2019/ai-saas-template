"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { Select } from "@/components/Select";

type T = Dictionary["admin"]["user"];

/**
 * 用户详情页右侧的管理操作：调积分（原因必填）、改角色、封禁 / 解封、踢下线、删除。
 * 都走 /api/admin/*，服务端再校验一遍（不能对自己、不能封 / 删管理员、付过款的不能删）
 */
export function UserActions({
  userId,
  email,
  usersHref,
  isSelf,
  isAdmin,
  envAdmin,
  role,
  banned,
  banReason,
  canDelete,
  t,
}: {
  userId: string;
  email: string;
  usersHref: string;
  isSelf: boolean;
  isAdmin: boolean;
  envAdmin: boolean;
  role: string;
  banned: boolean;
  banReason: string | null;
  canDelete: boolean;
  t: T;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [days, setDays] = useState("7");
  const [msg, setMsg] = useState<{ key: string; ok: boolean; text: string } | null>(null);

  const call = async (key: string, url: string, body: Record<string, unknown>, done?: (data: Record<string, unknown>) => string) => {
    setBusy(key);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy("");
    if (!res.ok) {
      setMsg({ key, ok: false, text: t.errors[String(data.error)] ?? t.errors.generic });
      return false;
    }
    setMsg(done ? { key, ok: true, text: done(data) } : null);
    router.refresh();
    return true;
  };
  const act = (action: string, extra: Record<string, unknown> = {}) => ({ action, ...extra });
  const note = (key: string) => msg?.key === key && <p className={`text-xs ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</p>;

  const adjust = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const ok = await call(
      "adjust",
      "/api/admin/credits",
      { userId, delta: Number(data.get("delta")), note: String(data.get("note")) },
      (d) => t.adjust.done.replace("{n}", String(d.balance)),
    );
    if (ok) form.reset();
  };

  const ban = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const days = String(data.get("days"));
    if (!confirm(t.confirmAction)) return;
    await call("ban", `/api/admin/users/${userId}`, act("ban", { reason: String(data.get("reason")), days: days === "forever" ? null : Number(days) }));
  };

  const remove = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const confirmEmail = String(new FormData(e.currentTarget).get("confirm"));
    const ok = await call("delete", `/api/admin/users/${userId}`, act("delete", { confirmEmail }));
    if (ok) router.push(usersHref);
  };

  return (
    <div className="divide-y divide-line">
      <Section title={t.adjust.title} body={t.adjust.amountHint}>
        <form onSubmit={adjust} className="grid gap-2">
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
            <input name="delta" type="number" required step={1} placeholder="+100" aria-label={t.adjust.amount} className="field field-sm font-mono" />
            <input name="note" required maxLength={300} placeholder={t.adjust.reasonPlaceholder} aria-label={t.adjust.reason} className="field field-sm" />
          </div>
          <button type="submit" disabled={busy === "adjust"} className="btn btn-secondary btn-sm justify-self-start">
            {t.adjust.submit}
          </button>
          {note("adjust")}
        </form>
      </Section>

      {!isSelf && (
        <Section title={t.role.title} body={isAdmin ? t.role.isAdmin : t.role.isUser}>
          {envAdmin && <p className="mb-2 text-xs text-warning-fg">{t.role.envNote}</p>}
          <button
            type="button"
            disabled={busy === "role"}
            onClick={() => confirm(t.confirmAction) && call("role", `/api/admin/users/${userId}`, act("set_role", { role: role === "admin" ? "user" : "admin" }))}
            className="btn btn-secondary btn-sm"
          >
            {role === "admin" ? t.role.makeUser : t.role.makeAdmin}
          </button>
          {note("role")}
        </Section>
      )}

      {!isSelf && !isAdmin && (
        <Section title={t.ban.title} body={t.ban.body}>
          {banned ? (
            <div className="grid gap-2">
              {banReason && <p className="text-xs text-fg-2">{t.ban.reasonNow.replace("{reason}", banReason)}</p>}
              <button
                type="button"
                disabled={busy === "unban"}
                onClick={() => call("unban", `/api/admin/users/${userId}`, act("unban"))}
                className="btn btn-secondary btn-sm justify-self-start"
              >
                {t.ban.unban}
              </button>
            </div>
          ) : (
            <form onSubmit={ban} className="grid gap-2">
              <input name="reason" required maxLength={500} placeholder={t.ban.reasonPlaceholder} aria-label={t.ban.reason} className="field field-sm" />
              <div className="flex items-center gap-2">
                <Select
                  name="days"
                  label={t.ban.duration}
                  value={days}
                  onChange={setDays}
                  options={["1", "7", "30", "forever"].map((d) => ({ value: d, label: t.ban.days[d] }))}
                  className="w-28"
                />
                <button type="submit" disabled={busy === "ban"} className="btn btn-danger btn-sm">
                  {t.ban.submit}
                </button>
              </div>
            </form>
          )}
          {note("ban")}
          {note("unban")}
        </Section>
      )}

      {!isSelf && (
        <Section title={t.sessions.title} body={t.sessions.body}>
          <button
            type="button"
            disabled={busy === "sessions"}
            onClick={() =>
              confirm(t.confirmAction) &&
              call("sessions", `/api/admin/users/${userId}`, act("revoke_sessions"), (d) => t.sessions.done.replace("{n}", String(d.count)))
            }
            className="btn btn-secondary btn-sm"
          >
            {t.sessions.submit}
          </button>
          {note("sessions")}
        </Section>
      )}

      {!isSelf && !isAdmin && (
        <Section title={t.remove.title} body={canDelete ? t.remove.body : t.remove.blocked}>
          {canDelete && (
            <form onSubmit={remove} className="grid gap-2">
              <input
                name="confirm"
                required
                autoComplete="off"
                placeholder={t.remove.confirm.replace("{email}", email)}
                aria-label={t.remove.confirm.replace("{email}", email)}
                className="field field-sm"
              />
              <button type="submit" disabled={busy === "delete"} className="btn btn-danger btn-sm justify-self-start">
                {t.remove.submit}
              </button>
              {note("delete")}
            </form>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5 p-4">
      <div>
        <h3 className="text-[0.8125rem] font-semibold">{title}</h3>
        {body && <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{body}</p>}
      </div>
      {children}
    </div>
  );
}
