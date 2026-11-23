import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAdminSession } from "@/lib/admin";
import { listIssues } from "@/lib/admin-ops";
import { logAdminAction } from "@/lib/admin-users";
import { ISSUE_KINDS, ISSUE_STATUSES } from "@/lib/issues";
import { parseTableQuery } from "@/lib/table";

/**
 * 问题列表（和后台「异常与对账」页同一份数据，给脚本 / 测试用）：GET ?status=open&kind=&severity=&page=&size=
 * → { rows, total, byStatus }，rows 的 detail 已解析成对象
 */
export async function GET(request: Request) {
  if (!(await getAdminSession())) return Response.json({ error: "forbidden" }, { status: 403 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseTableQuery(sp, { filters: { status: ISSUE_STATUSES, kind: ISSUE_KINDS, severity: ["error", "warning"] } });
  return Response.json(await listIssues(query), { headers: { "Cache-Control": "no-store" } });
}

/**
 * 处理问题：POST { id, action: "resolve" | "ignore" | "reopen", note? }
 * 已解决：问题处理掉了（状态类的下次检查还在会重新打开）；忽略：确认没问题，以后检查到也不再提醒
 */
export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id, action, note } = (await request.json().catch(() => ({}))) as { id?: string; action?: string; note?: string };
  const status = { resolve: "resolved", ignore: "ignored", reopen: "open" }[action ?? ""];
  if (!id || !status) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = await getDb();
  const done = await db
    .update(schema.ledgerIssue)
    .set({
      status,
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : undefined,
      resolvedAt: status === "open" ? null : new Date(),
      resolvedBy: status === "open" ? null : session.user.email,
    })
    .where(eq(schema.ledgerIssue.id, id))
    .returning({ key: schema.ledgerIssue.key, userId: schema.ledgerIssue.userId });
  if (done.length === 0) return Response.json({ error: "not_found" }, { status: 404 });
  await logAdminAction({ id: session.user.id, email: session.user.email }, `${action}_issue`, null, `${done[0].key}${note ? `: ${note}` : ""}`);
  return Response.json({ ok: true });
}
