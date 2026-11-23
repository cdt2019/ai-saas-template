import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const DAY = 86_400_000;
export const USAGE_DAYS = 28;

/** 最近 n 天的 UTC 日期（YYYY-MM-DD，旧的在前） */
export function lastDays(n: number) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

/** 最近 n 天的起点 */
export const since = (days: number) => new Date(Date.now() - days * DAY);

/**
 * 近 n 天每天净用掉的积分：AI 消耗减去失败退回（只读统计，给用户中心和设置页的用量图用）
 */
export async function getUsage(userId: string, days = USAGE_DAYS) {
  const db = await getDb();
  const tx = schema.creditTransaction;
  const day = sql<string>`to_char(${tx.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, used: sql<number>`coalesce(sum(-${tx.delta}), 0)::int` })
    .from(tx)
    .where(and(eq(tx.userId, userId), inArray(tx.reason, ["spend", "refund"]), gte(tx.createdAt, since(days))))
    .groupBy(day);
  const byDay = new Map(rows.map((r) => [r.day, Math.max(0, Number(r.used))]));
  const list = lastDays(days).map((d) => ({ d, n: byDay.get(d) ?? 0 }));
  return { days: list, total: list.reduce((s, u) => s + u.n, 0) };
}
