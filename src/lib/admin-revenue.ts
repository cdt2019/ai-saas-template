import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { plans } from "@/config/pricing";
import { getDb, schema } from "@/db";
import { isProblem } from "./payments/events";
import type { TableQuery } from "./table";
import { inRange } from "./table-db";

/**
 * 后台「收入」模块的列表查询：交易（到账、结账单）、订阅、退款申请，以及支付日志。都是服务端分页（只查当前一页，总数单独 count），
 * 搜索 / 筛选 / 日期范围 / 排序参数来自网址（见 src/lib/table.ts）。分栏上的数字跟着除状态以外的条件走，和列表对得上
 */
const { user, order, subscription, refundRequest, payment } = schema;

const PROVIDERS = ["stripe", "creem", "waffo", "mock"] as const;
const PLAN_IDS = plans.map((p) => p.id);
const like = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const where = (conds: (SQL | undefined)[]) => {
  const list = conds.filter(Boolean) as SQL[];
  return list.length ? and(...list) : undefined;
};

/* ---------------- 结账单（订单） ---------------- */

export const ORDER_FILTERS = { status: ["pending", "paid", "failed", "refunded"], provider: PROVIDERS, plan: PLAN_IDS } as const;
export const ORDER_SORTS = ["created", "amount"];

export async function listOrders(q: TableQuery) {
  const db = await getDb();
  const term = q.q ? like(q.q) : null;
  const cond = where([
    term ? or(ilike(user.email, term), eq(order.id, q.q), eq(order.providerRef, q.q)) : undefined,
    q.filters.status ? eq(order.status, q.filters.status) : undefined,
    q.filters.provider ? eq(order.provider, q.filters.provider) : undefined,
    q.filters.plan ? eq(order.planId, q.filters.plan) : undefined,
    inRange(q, order.createdAt),
  ]);
  const col = q.sort === "amount" ? order.amount : order.createdAt;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ o: order, email: user.email })
      .from(order)
      .innerJoin(user, eq(order.userId, user.id))
      .where(cond)
      .orderBy(q.dir === "asc" ? asc(col) : desc(col), desc(order.id))
      .limit(q.size)
      .offset(q.offset),
    db.select({ n: count() }).from(order).innerJoin(user, eq(order.userId, user.id)).where(cond),
  ]);
  return { rows, total: n };
}

/* ---------------- 订阅 ---------------- */

export const SUB_FILTERS = { status: ["active", "past_due", "canceled", "expired", "refunded"], provider: PROVIDERS, plan: PLAN_IDS } as const;
export const SUB_SORTS = ["created", "period"];

export async function listSubscriptions(q: TableQuery) {
  const db = await getDb();
  const term = q.q ? like(q.q) : null;
  const base = [
    term ? or(ilike(user.email, term), eq(subscription.providerSubId, q.q)) : undefined,
    q.filters.provider ? eq(subscription.provider, q.filters.provider) : undefined,
    q.filters.plan ? eq(subscription.planId, q.filters.plan) : undefined,
    inRange(q, subscription.createdAt),
  ];
  const cond = where([...base, q.filters.status ? eq(subscription.status, q.filters.status) : undefined]);
  const col = q.sort === "period" ? subscription.currentPeriodEnd : subscription.createdAt;
  const [rows, [{ n }], byStatus] = await Promise.all([
    db
      .select({ s: subscription, email: user.email })
      .from(subscription)
      .innerJoin(user, eq(subscription.userId, user.id))
      .where(cond)
      .orderBy(q.dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`, desc(subscription.id))
      .limit(q.size)
      .offset(q.offset),
    db.select({ n: count() }).from(subscription).innerJoin(user, eq(subscription.userId, user.id)).where(cond),
    db
      .select({ status: subscription.status, n: count() })
      .from(subscription)
      .innerJoin(user, eq(subscription.userId, user.id))
      .where(where(base))
      .groupBy(subscription.status),
  ]);
  return { rows, total: n, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number> };
}

/* ---------------- 退款申请 ---------------- */

export const REFUND_STATUSES = ["pending", "processing", "refunded", "rejected", "failed", "canceled"] as const;
export const REFUND_SORTS = ["created", "amount"];

export async function listRefundRequests(q: TableQuery) {
  const db = await getDb();
  const term = q.q ? like(q.q) : null;
  const base = [term ? or(ilike(user.email, term), eq(refundRequest.id, q.q), eq(payment.providerPaymentId, q.q)) : undefined, inRange(q, refundRequest.createdAt)];
  const cond = where([...base, q.filters.status ? eq(refundRequest.status, q.filters.status) : undefined]);
  const col = q.sort === "amount" ? refundRequest.amount : refundRequest.createdAt;
  // 没选状态时：待审核、处理中排在前面
  const urgent = sql`case ${refundRequest.status} when 'pending' then 0 when 'processing' then 1 else 2 end`;
  const [rows, [{ n }], byStatus] = await Promise.all([
    db
      .select({ r: refundRequest, p: payment, email: user.email })
      .from(refundRequest)
      .innerJoin(payment, eq(refundRequest.paymentId, payment.id))
      .innerJoin(user, eq(refundRequest.userId, user.id))
      .where(cond)
      .orderBy(...(q.filters.status || q.sort ? [] : [urgent]), q.dir === "asc" ? asc(col) : desc(col), desc(refundRequest.id))
      .limit(q.size)
      .offset(q.offset),
    db
      .select({ n: count() })
      .from(refundRequest)
      .innerJoin(payment, eq(refundRequest.paymentId, payment.id))
      .innerJoin(user, eq(refundRequest.userId, user.id))
      .where(cond),
    db
      .select({ status: refundRequest.status, n: count() })
      .from(refundRequest)
      .innerJoin(payment, eq(refundRequest.paymentId, payment.id))
      .innerJoin(user, eq(refundRequest.userId, user.id))
      .where(where(base))
      .groupBy(refundRequest.status),
  ]);
  return { rows, total: n, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number> };
}

/* ---------------- 支付日志（事件）和到账（付款） ---------------- */

export const EVENT_FILTERS = { outcome: ["ok", "ignored", "rejected", "error"], provider: [...PROVIDERS, "system"], problems: ["1"] } as const;

/** 支付日志：有搜索词时按时间正序（就是这笔交易 / 这个人的完整时间线），否则新的在前 */
export async function listPaymentEvents(q: TableQuery) {
  const db = await getDb();
  const e = schema.paymentEvent;
  const term = q.q || null;
  const cond = where([
    term
      ? or(
          ilike(e.userEmail, like(term)),
          ...[e.userId, e.orderId, e.paymentId, e.providerPaymentId, e.providerOrderId, e.providerSubId, e.providerRefundId, e.providerEventId].map((c) => eq(c, term)),
        )
      : undefined,
    q.filters.outcome ? eq(e.outcome, q.filters.outcome) : undefined,
    q.filters.provider ? eq(e.provider, q.filters.provider) : undefined,
    q.filters.problems ? isProblem : undefined,
    inRange(q, e.createdAt),
  ]);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select()
      .from(e)
      .where(cond)
      .orderBy(term ? asc(e.createdAt) : desc(e.createdAt), desc(e.id))
      .limit(q.size)
      .offset(q.offset),
    db.select({ n: count() }).from(e).where(cond),
  ]);
  return { rows, total: n };
}

export const PAYMENT_FILTERS = { status: ["paid", "partially_refunded", "refunded", "disputed"], provider: PROVIDERS } as const;
export const PAYMENT_SORTS = ["created", "amount"];

export async function listPayments(q: TableQuery) {
  const db = await getDb();
  const term = q.q || null;
  const cond = where([
    term
      ? or(ilike(payment.userEmail, like(term)), ...[payment.id, payment.userId, payment.orderId, payment.providerPaymentId, payment.providerSubId].map((c) => eq(c, term)))
      : undefined,
    q.filters.status ? eq(payment.status, q.filters.status) : undefined,
    q.filters.provider ? eq(payment.provider, q.filters.provider) : undefined,
    inRange(q, payment.createdAt),
  ]);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select()
      .from(payment)
      .where(cond)
      .orderBy(q.dir === "asc" ? asc(q.sort === "amount" ? payment.amount : payment.createdAt) : desc(q.sort === "amount" ? payment.amount : payment.createdAt), desc(payment.id))
      .limit(q.size)
      .offset(q.offset),
    db.select({ n: count() }).from(payment).where(cond),
  ]);
  return { rows, total: n };
}
