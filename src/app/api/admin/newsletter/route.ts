import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAdminSession } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-users";
import { runJobByName } from "@/lib/jobs/runner";
import { AUDIENCES, createCampaign, sendTestEmail, type Audience } from "@/lib/newsletter";

/**
 * 后台 Newsletter 操作：POST { action, ... }
 * - test { subject, body, locale }：发测试信给当前管理员
 * - send { subject, body, audience }：建群发，马上发第一批，其余由定时任务 newsletter.send 接着发
 * - unsubscribe / remove { id }：替订阅者退订 / 删除（用户要求删除个人数据时用）
 */
export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const admin = { id: session.user.id, email: session.user.email };
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string; subject?: unknown; body?: unknown; audience?: string; locale?: string };
  const db = await getDb();
  const { newsletterSubscriber: sub } = schema;

  if (body.action === "unsubscribe" || body.action === "remove") {
    if (!body.id) return Response.json({ error: "invalid_input" }, { status: 400 });
    const done =
      body.action === "remove"
        ? await db.delete(sub).where(eq(sub.id, body.id)).returning({ email: sub.email })
        : await db.update(sub).set({ status: "unsubscribed", unsubscribedAt: new Date() }).where(eq(sub.id, body.id)).returning({ email: sub.email });
    if (done.length === 0) return Response.json({ error: "not_found" }, { status: 404 });
    await logAdminAction(admin, `newsletter_${body.action}`, null, done[0].email);
    return Response.json({ ok: true });
  }

  const subject = typeof body.subject === "string" ? body.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 150) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 20_000) : "";
  if (!subject || !text) return Response.json({ error: "invalid_input" }, { status: 400 });

  if (body.action === "test") {
    const ok = await sendTestEmail(session.user.email, { subject, body: text }, body.locale === "zh" ? "zh" : "en");
    return ok ? Response.json({ ok: true, to: session.user.email }) : Response.json({ error: "send_failed" }, { status: 502 });
  }
  if (body.action === "send") {
    if (!(AUDIENCES as readonly string[]).includes(body.audience ?? "")) return Response.json({ error: "invalid_input" }, { status: 400 });
    const created = await createCampaign({ subject, body: text, audience: body.audience as Audience, by: session.user.email });
    if (!created) return Response.json({ error: "no_recipients" }, { status: 409 });
    await logAdminAction(admin, "newsletter_send", null, `${created.id}: ${subject} (${created.total})`);
    after(() => runJobByName("newsletter.send", "manual", { by: session.user.email }));
    return Response.json({ ok: true, ...created });
  }
  return Response.json({ error: "invalid_input" }, { status: 400 });
}
