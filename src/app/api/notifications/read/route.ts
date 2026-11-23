import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";

/** 标为已读：POST { ids?: string[] }，不传 ids 表示全部。只能改自己的通知，返回剩余未读数 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string").slice(0, 200) : null;
  const { notification: n } = schema;
  const mine = and(eq(n.userId, session.user.id), isNull(n.readAt));
  const db = await getDb();
  await db
    .update(n)
    .set({ readAt: new Date() })
    .where(list ? and(mine, inArray(n.id, list.length ? list : ["-"])) : mine);
  const [{ unread }] = await db.select({ unread: count() }).from(n).where(mine);
  return Response.json({ ok: true, unread });
}
