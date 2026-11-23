import "server-only";
import { captureError } from "@/lib/monitoring";
import { asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";

/**
 * 支付流水（payment_event 表）：支付流程里每件事记一行，查问题时按邮箱或任一 id 一查就是完整时间线。
 * - 下单（/api/checkout）、每条验签通过的支付回调、网页退款的申请与审核都会记
 * - 验签失败的请求不记库（任何人都能往回调地址乱发，记库会被刷爆），只打日志
 * - 记流水失败不影响支付本身，只打印错误
 */

export type PaymentEventFields = Partial<Omit<typeof schema.paymentEvent.$inferInsert, "id" | "createdAt" | "raw">> & {
  raw?: unknown;
};
export type Outcome = "ok" | "ignored" | "rejected" | "error";

const RAW_LIMIT = 8000;

/** 写一行流水；缺的冗余字段（用户、邮箱、余额、订单、我们的付款 id）按已有的 id 补齐 */
export async function logPaymentEvent(e: PaymentEventFields & { provider: string; kind: string; outcome: Outcome }) {
  try {
    const db = await getDb();
    const f = { ...e };
    if (f.providerPaymentId && (!f.paymentId || !f.userId)) {
      const [p] = await db.select().from(schema.payment).where(eq(schema.payment.providerPaymentId, f.providerPaymentId));
      if (p) {
        f.paymentId ??= p.id;
        f.userId ??= p.userId;
        f.orderId ??= p.orderId;
        f.planId ??= p.planId;
        f.providerSubId ??= p.providerSubId;
        // 回调里没带金额时，用记账时的实付补上，每行都能看到这笔钱是多少
        f.chargedAmount ??= p.amount;
        f.currency ??= p.currency;
      }
    }
    if (f.orderId && (!f.userId || !f.planId)) {
      const [o] = await db.select().from(schema.order).where(eq(schema.order.id, f.orderId));
      if (o) {
        f.userId ??= o.userId;
        f.planId ??= o.planId;
        f.promoCode ??= o.promoCode;
      }
    }
    if (f.userId) {
      const [u] = await db.select({ email: schema.user.email, credits: schema.user.credits }).from(schema.user).where(eq(schema.user.id, f.userId));
      f.userEmail ??= u?.email;
      f.balanceAfter ??= u?.credits;
    }
    const raw = f.raw === undefined ? null : (typeof f.raw === "string" ? f.raw : JSON.stringify(f.raw)).slice(0, RAW_LIMIT);
    await db.insert(schema.paymentEvent).values({ ...f, id: newId("pev"), raw });
  } catch (err) {
    console.error("[payment-event] failed to log", e.kind, err);
  }
}

/**
 * 一次回调 / 一次操作对应一行流水：开头带上已知的字段，处理过程中 set() 补，最后 save()。
 * kind 默认是 webhook，处理分支里按做了什么改成 paid / period_paid / refunded 等。
 */
export function paymentTrail(base: PaymentEventFields & { provider: string }) {
  const fields: PaymentEventFields & { kind: string; provider: string } = { kind: "webhook", ...base };
  let outcome: Outcome = "ok";
  let message: string | undefined;
  return {
    /** 补字段（undefined 的不覆盖） */
    set(patch: PaymentEventFields & { kind?: string }) {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (fields as Record<string, unknown>)[k] = v;
      return this;
    },
    /** 记下结果和说明；多次调用以最后一次为准 */
    result(o: Outcome, m?: string) {
      outcome = o;
      message = m;
      return this;
    },
    save() {
      // 回调处理出错：除了记流水和问题表，也报给错误监控（配了才发）
      if (outcome === "error") void captureError(new Error(`payment webhook failed: ${message ?? fields.kind}`), { tags: { area: "payments", provider: fields.provider } });
      return logPaymentEvent({ ...fields, outcome, message: message ?? fields.message ?? undefined });
    },
  };
}

/* ---------------- 后台查询 ---------------- */

/**
 * 支付日志里「只看问题」筛选用：处理出错、被拒（别人店铺的回调等）、优惠码没用上、平台退款失败、
 * 以及定时任务补上的漏单。要处理的问题由 src/lib/issues.ts 从这些流水里归纳进问题表
 */
export const PROBLEM_KINDS = ["promo_dropped", "refund_failed", "missed_webhook"];
export const isProblem = or(inArray(schema.paymentEvent.outcome, ["error", "rejected"]), inArray(schema.paymentEvent.kind, PROBLEM_KINDS));

/** 后台按邮箱 / 任一 id 查：付款汇总 + 按时间排好的完整经过（GET /api/admin/payments，给脚本 / 测试用） */
export async function searchPaymentTrail(opts: { q?: string; limit?: number }) {
  const db = await getDb();
  const { payment, paymentEvent } = schema;
  const q = opts.q?.trim();
  const limit = opts.limit ?? 50;

  const eventMatch = q
    ? or(
        ilike(paymentEvent.userEmail, `%${q}%`),
        ...[
          paymentEvent.userId,
          paymentEvent.orderId,
          paymentEvent.paymentId,
          paymentEvent.providerPaymentId,
          paymentEvent.providerOrderId,
          paymentEvent.providerSubId,
          paymentEvent.providerRefundId,
          paymentEvent.providerEventId,
        ].map((c) => eq(c, q)),
      )
    : undefined;
  const paymentMatch = q
    ? or(
        ilike(payment.userEmail, `%${q}%`),
        ...[payment.id, payment.userId, payment.orderId, payment.providerPaymentId, payment.providerSubId].map((c) => eq(c, q)),
      )
    : undefined;

  const [payments, events] = await Promise.all([
    db.select().from(payment).where(paymentMatch).orderBy(desc(payment.createdAt)).limit(limit),
    // 有搜索词时按时间正序，就是这笔交易 / 这个人的完整经过
    q ? db.select().from(paymentEvent).where(eventMatch).orderBy(asc(paymentEvent.createdAt)).limit(200) : Promise.resolve([]),
  ]);
  return { payments, events };
}

/** 一笔付款一眼能看出的异常（后台高亮用） */
export function paymentFlags(p: typeof schema.payment.$inferSelect): string[] {
  const flags: string[] = [];
  if (p.refundedAmount > p.amount) flags.push("over-refunded");
  if (p.status === "disputed") flags.push("disputed");
  if (p.trial) flags.push("trial");
  if (p.amount === 0 && p.creditsGranted > 0 && !p.trial) flags.push("free credits");
  if (p.discountAmount && p.discountAmount > 0) flags.push(`discount${p.promoCode ? ` ${p.promoCode}` : ""}`);
  return flags;
}

/** 订阅状态事件的结果：比上一次采用的事件旧（重推、乱序到达）或本站没有这份订阅，都记 ignored */
export function statusResult(r: "applied" | "stale" | "missing", what: string): [Outcome, string] {
  if (r === "applied") return ["ok", what];
  return ["ignored", r === "stale" ? `${what}: stale event (older than the last applied status event), status unchanged` : `${what}: no subscription on this site`];
}

/** 平台事件时间 → Date；格式不对就当没有（不做旧事件判断） */
export function eventTime(v: string | number | null | undefined): Date | undefined {
  if (v == null || v === "") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
