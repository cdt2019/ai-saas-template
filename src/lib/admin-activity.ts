import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { aiFeatures } from "@/config/ai";
import { getDb, schema } from "@/db";
import type { TableQuery } from "./table";
import { inRange } from "./table-db";

/**
 * 后台「运营」模块的查询：全站积分流水、AI 调用。都是服务端分页；页面顶部的汇总跟着当前筛选走，
 * 和下面的列表对得上（全站积分余额除外：它是此刻的总数，不分时间）
 */
const { user, creditTransaction: tx, generation } = schema;

const like = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const where = (conds: (SQL | undefined)[]) => {
  const list = conds.filter(Boolean) as SQL[];
  return list.length ? and(...list) : undefined;
};

/* ---------------- 积分流水 ---------------- */

export const CREDIT_FILTERS = {
  reason: ["signup_bonus", "purchase", "subscription", "trial", "spend", "refund", "clawback", "restore", "admin"],
  direction: ["in", "out"],
} as const;

export async function listCreditLedger(q: TableQuery) {
  const db = await getDb();
  const cond = where([
    q.q ? or(ilike(user.email, like(q.q)), eq(tx.userId, q.q), eq(tx.refId, q.q)) : undefined,
    q.filters.reason ? eq(tx.reason, q.filters.reason) : undefined,
    q.filters.direction === "in" ? sql`${tx.delta} > 0` : q.filters.direction === "out" ? sql`${tx.delta} < 0` : undefined,
    inRange(q, tx.createdAt),
  ]);
  const [rows, [totals], [balance]] = await Promise.all([
    db
      .select({ t: tx, email: user.email })
      .from(tx)
      .innerJoin(user, eq(tx.userId, user.id))
      .where(cond)
      .orderBy(desc(tx.createdAt), desc(tx.id))
      .limit(q.size)
      .offset(q.offset),
    db
      .select({
        n: count(),
        added: sql<number>`coalesce(sum(${tx.delta}) filter (where ${tx.delta} > 0), 0)::bigint`.mapWith(Number),
        removed: sql<number>`coalesce(-sum(${tx.delta}) filter (where ${tx.delta} < 0), 0)::bigint`.mapWith(Number),
      })
      .from(tx)
      .innerJoin(user, eq(tx.userId, user.id))
      .where(cond),
    db.select({ total: sql<number>`coalesce(sum(${user.credits}), 0)::bigint`.mapWith(Number) }).from(user),
  ]);
  return { rows, total: totals.n, summary: { added: totals.added, removed: totals.removed, net: totals.added - totals.removed, balance: balance.total } };
}

/* ---------------- AI 调用 ---------------- */

export const AI_STATUSES = ["pending", "succeeded", "failed"] as const;
export const AI_FILTERS = { status: AI_STATUSES, feature: aiFeatures.map((f) => f.id) } as const;
export const AI_SORTS = ["created", "duration"];
/** 排队超过这么久还没结果，算卡住（视频 20 分钟超时退款，靠轮询或回调触发；用户走了又没回调就会停在这里） */
const STUCK_MINUTES = 30;

export async function listAiCalls(q: TableQuery) {
  const db = await getDb();
  // 分栏数字和按功能汇总不跟状态走
  const base = [
    q.q ? or(ilike(user.email, like(q.q)), eq(generation.id, q.q), eq(generation.userId, q.q), ilike(generation.model, like(q.q))) : undefined,
    q.filters.feature ? eq(generation.feature, q.filters.feature) : undefined,
    inRange(q, generation.createdAt),
  ];
  const cond = where([...base, q.filters.status ? eq(generation.status, q.filters.status) : undefined]);
  const col = q.sort === "duration" ? generation.durationMs : generation.createdAt;
  const order = q.dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
  const [rows, [{ n }], features] = await Promise.all([
    db
      .select({
        id: generation.id,
        userId: generation.userId,
        email: user.email,
        feature: generation.feature,
        model: generation.model,
        cost: generation.cost,
        status: generation.status,
        input: generation.input,
        error: generation.error,
        durationMs: generation.durationMs,
        createdAt: generation.createdAt,
      })
      .from(generation)
      .innerJoin(user, eq(generation.userId, user.id))
      .where(cond)
      .orderBy(order, desc(generation.id))
      .limit(q.size)
      .offset(q.offset),
    db.select({ n: count() }).from(generation).innerJoin(user, eq(generation.userId, user.id)).where(cond),
    db
      .select({
        feature: generation.feature,
        calls: count(),
        succeeded: sql<number>`count(*) filter (where ${generation.status} = 'succeeded')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${generation.status} = 'failed')`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${generation.status} = 'pending')`.mapWith(Number),
        stuck: sql<number>`count(*) filter (where ${generation.status} = 'pending' and ${generation.createdAt} < now() - make_interval(mins => ${STUCK_MINUTES}))`.mapWith(Number),
        credits: sql<number>`coalesce(sum(${generation.cost}) filter (where ${generation.status} = 'succeeded'), 0)::bigint`.mapWith(Number),
        avgMs: sql<number | null>`avg(${generation.durationMs}) filter (where ${generation.status} = 'succeeded')`.mapWith((v) => (v == null ? null : Math.round(Number(v)))),
        p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${generation.durationMs}) filter (where ${generation.status} = 'succeeded')`.mapWith((v) =>
          v == null ? null : Math.round(Number(v)),
        ),
      })
      .from(generation)
      .innerJoin(user, eq(generation.userId, user.id))
      .where(where(base))
      .groupBy(generation.feature)
      .orderBy(asc(generation.feature)),
  ]);
  const sum = (k: "calls" | "succeeded" | "failed" | "pending" | "stuck" | "credits") => features.reduce((a, f) => a + f[k], 0);
  return {
    rows,
    total: n,
    features,
    summary: { calls: sum("calls"), succeeded: sum("succeeded"), failed: sum("failed"), pending: sum("pending"), stuck: sum("stuck"), credits: sum("credits") },
  };
}
