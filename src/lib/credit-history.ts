import "server-only";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * 积分记录分页（只读）：设置 → 用量 的列表首屏 + GET /api/credits/history 往下加载。
 * 按 (created_at, id) 倒序翻页，游标里带数据库原始精度（微秒）的时间，同一毫秒多条也不会漏、不会重
 */
export type HistoryItem = { id: string; delta: number; reason: string; note: string | null; at: string };
export type HistoryPage = { items: HistoryItem[]; next: string | null };

const tx = schema.creditTransaction;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// 游标就是「时间|id」，放进地址时由 URLSearchParams 编码；不用 Buffer，边缘运行时也能跑
const encodeCursor = (at: string, id: string) => `${at}|${id}`;
const decodeCursor = (cursor: string) => {
  const i = cursor.indexOf("|");
  const at = cursor.slice(0, i);
  const id = cursor.slice(i + 1);
  return i > 0 && id && !Number.isNaN(Date.parse(at)) ? { at, id } : null;
};

/** cursor 不合法时返回 null（接口回 400） */
export async function getCreditHistoryPage(
  userId: string,
  { cursor, limit = PAGE_SIZE, direction }: { cursor?: string | null; limit?: number; direction?: string | null } = {},
): Promise<HistoryPage | null> {
  const after = cursor ? decodeCursor(cursor) : undefined;
  if (after === null) return null;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit) || PAGE_SIZE));
  // 原始精度的时间，只用来做游标；展示用 JS Date（毫秒）
  const exact = sql<string>`to_char(${tx.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const db = await getDb();
  const rows = await db
    .select({ id: tx.id, delta: tx.delta, reason: tx.reason, note: tx.note, createdAt: tx.createdAt, exact })
    .from(tx)
    .where(
      and(
        eq(tx.userId, userId),
        direction === "in" ? sql`${tx.delta} > 0` : direction === "out" ? sql`${tx.delta} < 0` : undefined,
        after
          ? or(sql`${tx.createdAt} < ${after.at}::timestamptz`, and(sql`${tx.createdAt} = ${after.at}::timestamptz`, lt(tx.id, after.id)))
          : undefined,
      ),
    )
    .orderBy(desc(tx.createdAt), desc(tx.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, delta: r.delta, reason: r.reason, note: r.note, at: r.createdAt.toISOString() })),
    next: rows.length > size && last ? encodeCursor(last.exact, last.id) : null,
  };
}
