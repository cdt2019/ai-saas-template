import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * 固定窗口限流：key 在 windowSec 秒内最多 limit 次。
 * 计数存在数据库里（一条原子 UPSERT），多实例部署也准确，不需要 Redis。
 *
 *   const r = await rateLimit(`ai:${userId}`, 20, 60);
 *   if (!r.ok) return 429;
 */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const db = await getDb();
  const t = schema.rateLimit;
  // 窗口过期则重置为 1，否则 +1
  const expired = sql`${t.windowStart} < now() - make_interval(secs => ${windowSec})`;
  const [row] = await db
    .insert(t)
    .values({ key, count: 1, windowStart: sql`now()` })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${t.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${t.windowStart} END`,
      },
    })
    .returning({ count: t.count, windowStart: t.windowStart });

  const resetAt = new Date(row.windowStart.getTime() + windowSec * 1000);
  return {
    ok: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
  };
}

/** 429 响应（带 Retry-After 头） */
export function tooManyRequests(retryAfter: number) {
  return Response.json(
    { error: "rate_limited", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
