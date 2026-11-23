import "server-only";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPlan } from "@/config/pricing";
import { logPaymentEvent } from "./events";
import {
  clawbackGrant,
  findSubscription,
  fulfillOrder,
  getOrder,
  grantSubscriptionCredits,
  syncPaymentRefunded,
  updateSubscriptionStatus,
  upsertSubscription,
  type PaidWith,
} from "./fulfill";
import { creemSubStatus, getCreemCheckout, getCreemSubscription, type CreemSubscription } from "./creem";
import { grantRefIdForPaymentIntent, stripeClient, stripeSubStatus } from "./stripe";
import { waffoCents, waffoQuery, waffoSubStatus } from "./waffo";

/**
 * 主动查询与对账：回调（webhook）是「至少一次」但不是「一定送到」—— 地址配错、签名密钥换了、服务器宕机、
 * 平台重试次数用完，都会让付款 / 退款 / 状态变化永远到不了。所以不能只等回调：
 * - 主动查单：用户付完跳回来（?paid=订单号）、以及定时任务，对还在 pending 的订单去支付平台查一次
 * - 对账：每天拉支付平台最近 48 小时的付款、退款，和本地比，漏掉的补上；本地有效 / 欠费的订阅逐个核对状态
 * 补单走和回调完全相同的幂等入口、相同的 refId（order_<订单号>、waffo_<支付号>、stripe_<账单号>、creem_tx_<交易号>、
 * waffo_refund_<退款号>），所以回调晚到、和定时任务同时跑、重复跑，都只发一次积分、只扣一次。
 * 每次补了什么都写进支付流水：用户跳回时补的记 reconciled（回调比用户慢，正常）；
 * 定时任务补的记 missed_webhook（回调确实丢了，算问题，会发邮件提醒管理员）。
 */

type Order = typeof schema.order.$inferSelect;
type Source = "return" | "cron";

const idOf = (v: string | { id?: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));
const fromUnix = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);
/** 下单后超过这么久还没付款，就当用户放弃了，订单标记 failed（之后真付了，补单 / 回调照样能改成 paid） */
const ABANDON_AFTER_MS = 24 * 3600_000;

/* ---------------- 支付平台那边的订单（三家统一成一种形状） ---------------- */

type RemoteSub = { id: string; customerId?: string | null; status: string; cancelAtPeriodEnd?: boolean; currentPeriodEnd?: Date | null };
type RemotePeriod = { refId: string; paid: PaidWith; trial?: boolean };
type Remote =
  | { state: "pending" | "expired"; ref?: string }
  | { state: "paid"; ref?: string; payment?: PaidWith; subscription?: RemoteSub; periods?: RemotePeriod[] };

async function stripeRemote(ord: Order): Promise<Remote> {
  if (!ord.providerRef) return { state: "pending" };
  const stripe = stripeClient();
  const s = await stripe.checkout.sessions.retrieve(ord.providerRef);
  if (s.status === "expired") return { state: "expired", ref: s.id };
  if (s.status !== "complete") return { state: "pending", ref: s.id };
  if (s.mode === "payment") {
    if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return { state: "pending", ref: s.id };
    return {
      state: "paid",
      ref: s.id,
      payment: { providerPaymentId: idOf(s.payment_intent) ?? s.id, amount: s.amount_total, currency: s.currency, listAmount: s.amount_subtotal },
    };
  }
  const subId = idOf(s.subscription);
  if (!subId) return { state: "pending", ref: s.id };
  const sub = await stripe.subscriptions.retrieve(subId);
  const invoiceId = idOf(s.invoice);
  const inv = invoiceId ? await stripe.invoices.retrieve(invoiceId) : null;
  return {
    state: "paid",
    ref: s.id,
    subscription: {
      id: sub.id,
      customerId: idOf(sub.customer),
      status: stripeSubStatus(sub.status),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: fromUnix(sub.items.data[0]?.current_period_end),
    },
    periods:
      inv?.id && inv.status === "paid"
        ? [{ refId: `stripe_${inv.id}`, paid: { providerPaymentId: inv.id, amount: inv.amount_paid, currency: inv.currency, listAmount: inv.subtotal } }]
        : [],
  };
}

type WaffoPayment = {
  id: string;
  status: string;
  periodNumber?: number | null;
  createdAt: string;
  amount: { amount: string; currency: string };
  snapshotAmountDetails?: { listTotal?: string | null } | null;
};
const WAFFO_PAYMENT = "id status periodNumber createdAt amount { amount currency } snapshotAmountDetails { listTotal }";
/** Waffo 的 Money.amount 是最小单位（分）的字符串；snapshotAmountDetails.listTotal 是这一期的标价（展示格式，试用期是试用价） */
const waffoPaid = (p: WaffoPayment): PaidWith => ({
  providerPaymentId: p.id,
  amount: Number(p.amount.amount),
  currency: p.amount.currency,
  listAmount: waffoCents(p.snapshotAmountDetails?.listTotal),
});
const waffoPeriod = (p: WaffoPayment): RemotePeriod => ({ refId: `waffo_${p.id}`, paid: waffoPaid(p) });
const byPeriod = (a: WaffoPayment, b: WaffoPayment) => (a.periodNumber ?? 0) - (b.periodNumber ?? 0) || a.createdAt.localeCompare(b.createdAt);

async function waffoRemote(ord: Order): Promise<Remote> {
  const storeId = process.env.WAFFO_STORE_ID;
  if (!storeId) throw new Error("WAFFO_STORE_ID is not set");
  const isSub = getPlan(ord.planId)?.mode === "subscription";
  // 下单时 orderMerchantExternalId 填的就是我们的订单号
  const { orders } = await waffoQuery<{
    orders: { id: string; status: string; currentPeriodEnd?: string | null; payments: WaffoPayment[] }[];
  }>(
    `query($s: String!, $o: String!) { orders: ${isSub ? "subscriptionOrders" : "onetimeOrders"}(storeId: $s, filter: { orderMerchantExternalId: { eq: $o } }, limit: 5) {
      id status ${isSub ? "currentPeriodEnd" : ""} payments { ${WAFFO_PAYMENT} } } }`,
    { s: storeId, o: ord.id },
  );
  const o = orders[0];
  if (!o) return { state: "pending" };
  const succeeded = o.payments.filter((p) => p.status === "succeeded").sort(byPeriod);
  if (!isSub) {
    if (o.status === "canceled") return { state: "expired", ref: o.id };
    return succeeded[0] ? { state: "paid", ref: o.id, payment: waffoPaid(succeeded[0]) } : { state: "pending", ref: o.id };
  }
  const st = waffoSubStatus(o.status);
  if (!st || !succeeded.length) return st?.status === "canceled" || o.status === "expired" ? { state: "expired", ref: o.id } : { state: "pending", ref: o.id };
  return {
    state: "paid",
    ref: o.id,
    subscription: { id: o.id, customerId: ord.userId, ...st, currentPeriodEnd: o.currentPeriodEnd ? new Date(o.currentPeriodEnd) : null },
    periods: succeeded.map(waffoPeriod),
  };
}

async function creemRemote(ord: Order): Promise<Remote> {
  if (!ord.providerRef) return { state: "pending" };
  const c = await getCreemCheckout(ord.providerRef);
  if (!c) return { state: "pending" };
  if (c.status === "expired") return { state: "expired", ref: c.id };
  if (c.status !== "completed") return { state: "pending", ref: c.id };
  const tx = c.order?.transaction;
  const paid: PaidWith = { providerPaymentId: tx ?? c.id, amount: c.order?.amount_paid ?? c.order?.amount, currency: c.order?.currency, listAmount: c.order?.amount };
  if (!c.subscription) return { state: "paid", ref: c.id, payment: paid };
  const sub: CreemSubscription | null = typeof c.subscription === "string" ? await getCreemSubscription(c.subscription) : c.subscription;
  if (!sub) return { state: "pending", ref: c.id };
  const st = creemSubStatus(sub.status) ?? { status: "active", cancelAtPeriodEnd: false };
  return {
    state: "paid",
    ref: c.id,
    subscription: { id: sub.id, customerId: idOf(sub.customer ?? c.customer), ...st, currentPeriodEnd: sub.current_period_end_date ? new Date(sub.current_period_end_date) : null },
    // 首期交易号和 subscription.paid 回调里的 last_transaction_id 是同一笔，refId 一致
    periods: tx ? [{ refId: `creem_tx_${tx}`, paid, trial: sub.status === "trialing" ? true : undefined }] : [],
  };
}

const REMOTE: Record<string, ((ord: Order) => Promise<Remote>) | undefined> = { stripe: stripeRemote, waffo: waffoRemote, creem: creemRemote };

/** 配了密钥的支付平台才去查：换过通道后旧通道留下的订单不查（查也只会每次报错） */
const CONFIGURED: Record<string, () => boolean> = {
  waffo: () => !!(process.env.WAFFO_MERCHANT_ID && process.env.WAFFO_STORE_ID),
  stripe: () => !!process.env.STRIPE_SECRET_KEY,
  creem: () => !!process.env.CREEM_API_KEY,
};
const configuredProviders = () => Object.keys(CONFIGURED).filter((p) => CONFIGURED[p]());

/* ---------------- 补单（和回调同一个幂等入口） ---------------- */

/**
 * 这一笔处理过没有：记过付款，或者发过积分。payment 表上线前的老付款只有积分记录，
 * 不能当成漏单再补一行付款（补出来的汇总不知道它后来退没退款）
 */
async function processed(grantRefId: string) {
  const db = await getDb();
  const [p] = await db.select({ id: schema.payment.id }).from(schema.payment).where(eq(schema.payment.grantRefId, grantRefId));
  if (p) return true;
  const [tx] = await db.select({ id: schema.creditTransaction.id }).from(schema.creditTransaction).where(eq(schema.creditTransaction.refId, grantRefId));
  return !!tx;
}

/** 订阅：本地没有就建；没记过的每一期按回调同样的 refId 发积分。返回补了什么 */
async function backfillSubscription(
  ctx: { provider: string; userId: string; planId: string; orderId?: string | null },
  sub: RemoteSub,
  periods: RemotePeriod[],
): Promise<string[]> {
  const done: string[] = [];
  const existing = await findSubscription(ctx.provider, sub.id);
  if (!existing) {
    await upsertSubscription({
      userId: ctx.userId,
      provider: ctx.provider,
      providerSubId: sub.id,
      providerCustomerId: sub.customerId,
      planId: ctx.planId,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    });
    done.push(`subscription ${sub.id} created (${sub.status})`);
  }
  for (const p of periods) {
    if (await processed(p.refId)) continue;
    const r = await grantSubscriptionCredits({
      userId: existing?.userId ?? ctx.userId,
      planId: existing?.planId ?? ctx.planId,
      refId: p.refId,
      orderId: ctx.orderId,
      provider: ctx.provider,
      providerSubId: sub.id,
      paid: p.paid,
      trial: p.trial,
    });
    done.push(`${r.trial ? "trial period" : "period"} ${p.paid.providerPaymentId} paid, +${r.credits} credits`);
  }
  return done;
}

async function applyRemote(ord: Order, remote: Remote): Promise<string[]> {
  if (remote.state !== "paid") return [];
  const plan = getPlan(ord.planId);
  if (!plan) throw new Error(`Unknown plan: ${ord.planId}`);
  const wasUnpaid = ord.status === "pending" || ord.status === "failed";
  if (plan.mode === "one_time") {
    if (!remote.payment) return [];
    if (!wasUnpaid && (await processed(`order_${ord.id}`))) return [];
    const { credits } = await fulfillOrder(ord.id, ord.provider, remote.payment);
    return [`order paid${credits ? `, +${credits} credits` : ""}`];
  }
  const done: string[] = [];
  if (wasUnpaid) {
    await fulfillOrder(ord.id, ord.provider);
    done.push("order paid");
  }
  if (remote.subscription) done.push(...(await backfillSubscription({ provider: ord.provider, userId: ord.userId, planId: ord.planId, orderId: ord.id }, remote.subscription, remote.periods ?? [])));
  return done;
}

/**
 * 查一笔 pending 订单在支付平台的真实状态，付了就补单。
 * source=return：用户付完跳回来时（回调可能比人慢）；cron：定时任务（到这时还没回调，多半是丢了）
 */
export async function reconcileOrder(ord: Order, source: Source): Promise<{ status: string; changed: boolean; error?: string }> {
  const query = REMOTE[ord.provider];
  if (!query || !CONFIGURED[ord.provider]?.() || ord.status !== "pending") return { status: ord.status, changed: false };
  try {
    const remote = await query(ord);
    const done = await applyRemote(ord, remote);
    if (done.length) {
      await logPaymentEvent({
        provider: ord.provider,
        kind: source === "return" ? "reconciled" : "missed_webhook",
        outcome: "ok",
        orderId: ord.id,
        userId: ord.userId,
        providerOrderId: remote.ref,
        message: `${source === "return" ? "paid at the provider, filled in when the buyer came back (webhook not here yet)" : "paid at the provider but no webhook arrived; filled in by the payment job"}: ${done.join("; ")}`,
      });
      return { status: "paid", changed: true };
    }
    const abandoned = remote.state === "expired" || (remote.state === "pending" && Date.now() - ord.createdAt.getTime() > ABANDON_AFTER_MS);
    if (abandoned) {
      const db = await getDb();
      await db.update(schema.order).set({ status: "failed" }).where(and(eq(schema.order.id, ord.id), eq(schema.order.status, "pending")));
      await logPaymentEvent({
        provider: ord.provider,
        kind: "order_expired",
        outcome: "ok",
        orderId: ord.id,
        userId: ord.userId,
        providerOrderId: remote.ref,
        message: remote.state === "expired" ? "checkout expired at the provider without payment; order marked failed" : "still unpaid 24h after checkout; order marked failed",
      });
      return { status: "failed", changed: true };
    }
    return { status: "pending", changed: false };
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[reconcile] order ${ord.id} (${ord.provider})`, e);
    await logPaymentEvent({ provider: ord.provider, kind: "reconcile_failed", outcome: "error", orderId: ord.id, userId: ord.userId, message: `order query failed (${source}): ${error}` });
    return { status: ord.status, changed: false, error };
  }
}

/** 用户付完跳回 /dashboard?paid=订单号：只查自己的、还在 pending 的订单；同一订单 10 秒内只查一次（刷新页面不会打爆平台接口） */
const lastReturnCheck = new Map<string, number>();
export async function reconcileOnReturn(orderId: string, userId: string, waitMs = 5000) {
  const ord = await getOrder(orderId);
  if (!ord || ord.userId !== userId || ord.status !== "pending") return;
  const last = lastReturnCheck.get(orderId) ?? 0;
  if (Date.now() - last < 10_000) return;
  lastReturnCheck.set(orderId, Date.now());
  if (lastReturnCheck.size > 1000) lastReturnCheck.clear();
  // 页面最多等 waitMs：平台慢的话先显示「处理中」，查询在后台跑完照样补单
  await Promise.race([reconcileOrder(ord, "return"), new Promise((r) => setTimeout(r, waitMs))]);
}

/** 定时任务：下单超过 minAgeMinutes 还是 pending 的订单逐个去平台查（太新的不查，回调通常几秒内就到） */
export async function reconcilePendingOrders(opts: { minAgeMinutes?: number; maxAgeHours?: number } = {}) {
  const providers = configuredProviders();
  if (!providers.length) return { checked: 0, paid: 0, failed: 0, errors: 0 };
  const db = await getDb();
  const now = Date.now();
  const orders = await db
    .select()
    .from(schema.order)
    .where(
      and(
        eq(schema.order.status, "pending"),
        inArray(schema.order.provider, providers),
        lt(schema.order.createdAt, new Date(now - (opts.minAgeMinutes ?? 10) * 60_000)),
        gte(schema.order.createdAt, new Date(now - (opts.maxAgeHours ?? 72) * 3600_000)),
      ),
    )
    // 先查老的：放弃付款的订单 24 小时后标记 failed 就不再查，pending 的越积越少
    .orderBy(asc(schema.order.createdAt))
    .limit(500);
  const result = { checked: orders.length, paid: 0, failed: 0, errors: 0 };
  for (const ord of orders) {
    const r = await reconcileOrder(ord, "cron");
    if (r.error) result.errors++;
    else if (r.changed && r.status === "paid") result.paid++;
    else if (r.changed && r.status === "failed") result.failed++;
  }
  return result;
}

/* ---------------- 每日对账：最近的付款、退款、订阅状态 ---------------- */

type Tally = { payments: number; refunds: number; subscriptions: number; fixed: number; errors: number };

/** 对账补上的每一项记一行流水（kind missed_webhook，进「问题」列表、发提醒邮件） */
const logFix = (
  provider: string,
  f: { message: string; orderId?: string | null; userId?: string; providerPaymentId?: string; providerSubId?: string; providerRefundId?: string; creditsDelta?: number },
  kind = "missed_webhook",
) => logPaymentEvent({ provider, kind, outcome: "ok", ...f, orderId: f.orderId ?? undefined, message: `found by daily reconciliation: ${f.message}` });

const logFailure = (provider: string, what: string, e: unknown) => {
  console.error(`[reconcile] ${provider} ${what}`, e);
  return logPaymentEvent({ provider, kind: "reconcile_failed", outcome: "error", message: `${what}: ${(e as Error).message}` });
};

/** 这笔退款处理过没有：扣回记录在（或批准申请时的冻结已改名成它），或者有一条成功处理它的流水（扣回 0 的退款不留扣回记录） */
async function refundHandled(clawbackRefId: string, providerRefundId: string) {
  const db = await getDb();
  const [tx] = await db
    .select({ id: schema.creditTransaction.id })
    .from(schema.creditTransaction)
    .where(inArray(schema.creditTransaction.refId, [clawbackRefId, `${clawbackRefId}_adj`]));
  if (tx) return true;
  const [ev] = await db
    .select({ id: schema.paymentEvent.id })
    .from(schema.paymentEvent)
    .where(and(eq(schema.paymentEvent.providerRefundId, providerRefundId), eq(schema.paymentEvent.outcome, "ok")));
  return !!ev;
}

/** 本地有效 / 欠费的订阅（已退款的由我们自己定，不跟平台同步） */
async function liveSubscriptions(provider: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.subscription)
    .where(and(eq(schema.subscription.provider, provider), inArray(schema.subscription.status, ["active", "past_due"])));
}

/** 平台上的订阅状态和本地不一致（状态回调丢了）：以平台为准改过来 */
async function syncStatus(
  provider: string,
  local: typeof schema.subscription.$inferSelect,
  remote: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd?: Date | null },
  t: Tally,
) {
  if (local.status === remote.status && local.cancelAtPeriodEnd === remote.cancelAtPeriodEnd) return;
  // 平台当前的状态比本地收到过的任何回调都新：一定采用，并把事件时间记成「一分钟前」（至少比上一次采用的事件晚），
  // 之后晚到的旧事件（比如丢了的续费通知又到了）就改不回去；留一分钟余量，是怕平台和我们的时钟差几秒，
  // 查询前后刚发生的新事件被误当成旧的
  const eventAt = new Date(Math.max(Date.now() - 60_000, (local.statusEventAt?.getTime() ?? 0) + 1));
  const r = await updateSubscriptionStatus(
    provider,
    local.providerSubId,
    { status: remote.status, cancelAtPeriodEnd: remote.cancelAtPeriodEnd, ...(remote.currentPeriodEnd ? { currentPeriodEnd: remote.currentPeriodEnd } : {}) },
    eventAt,
  );
  if (r !== "applied") return; // 读完本地之后刚好又来了一条更新的回调：以回调为准
  t.fixed++;
  await logFix(provider, {
    userId: local.userId,
    providerSubId: local.providerSubId,
    message: `subscription was ${local.status}${local.cancelAtPeriodEnd ? " (canceling)" : ""} here but ${remote.status}${remote.cancelAtPeriodEnd ? " (canceling)" : ""} at the provider; updated`,
  });
}

async function waffoRecent(since: Date, t: Tally) {
  const storeId = process.env.WAFFO_STORE_ID;
  if (!storeId) throw new Error("WAFFO_STORE_ID is not set");
  // 1. 付款：一次性订单和订阅每一期（续费也在这里）
  const refundedAt = new Map<string, number>(); // 付款 id → 平台上的累计已退金额，第 3 步对汇总用
  for (let offset = 0; ; offset += 100) {
    const { payments } = await waffoQuery<{
      payments: (WaffoPayment & {
        orderId: string;
        orderMerchantExternalId: string | null;
        refundedAmount?: { amount: string } | null;
        subscriptionOrder: { id: string; status: string; currentPeriodEnd?: string | null } | null;
      })[];
    }>(
      `query($since: String!, $offset: Int!) { payments(limit: 100, offset: $offset, filter: { createdAt: { gte: $since }, status: { eq: "succeeded" }, orderMerchantExternalId: { isNull: false } }) {
        ${WAFFO_PAYMENT} orderId orderMerchantExternalId refundedAmount { amount } subscriptionOrder { id status currentPeriodEnd } } }`,
      { since: since.toISOString(), offset },
    );
    for (const p of payments.sort(byPeriod)) {
      t.payments++;
      if (Number(p.refundedAmount?.amount) > 0) refundedAt.set(p.id, Number(p.refundedAmount?.amount));
      const ord = p.orderMerchantExternalId ? await getOrder(p.orderMerchantExternalId) : null;
      if (!ord || ord.provider !== "waffo") continue; // 不是本站的订单
      try {
        const so = p.subscriptionOrder;
        const st = so ? waffoSubStatus(so.status) : null;
        const remote: Remote = so
          ? {
              state: "paid",
              subscription: { id: so.id, customerId: ord.userId, status: st?.status ?? "active", cancelAtPeriodEnd: st?.cancelAtPeriodEnd, currentPeriodEnd: so.currentPeriodEnd ? new Date(so.currentPeriodEnd) : null },
              periods: [waffoPeriod(p)],
            }
          : { state: "paid", payment: waffoPaid(p) };
        const done = await applyRemote(ord, remote);
        if (done.length) {
          t.fixed++;
          await logFix("waffo", { orderId: ord.id, userId: ord.userId, providerPaymentId: p.id, providerSubId: so?.id, message: `payment ${p.id}: ${done.join("; ")}` });
        }
      } catch (e) {
        t.errors++;
        await logFailure("waffo", `payment ${p.id}`, e);
      }
    }
    if (payments.length < 100) break;
  }
  // 2. 退款：按退款号去重（和 refund.succeeded 回调同一个 clawbackRefId）
  for (let offset = 0; ; offset += 100) {
    const { refunds } = await waffoQuery<{
      refunds: { id: string; paymentId: string; orderMerchantExternalId: string | null; amount: { amount: string }; payment: { amount: { amount: string } } | null }[];
    }>(
      `query($since: String!, $offset: Int!) { refunds(limit: 100, offset: $offset, filter: { createdAt: { gte: $since }, status: { eq: "succeeded" } }) {
        id paymentId orderMerchantExternalId amount { amount } payment { amount { amount } } } }`,
      { since: since.toISOString(), offset },
    );
    for (const r of refunds) {
      t.refunds++;
      const ord = r.orderMerchantExternalId ? await getOrder(r.orderMerchantExternalId) : null;
      if (!ord || ord.provider !== "waffo") continue;
      const clawbackRefId = `waffo_refund_${r.id}`;
      try {
        if (await refundHandled(clawbackRefId, r.id)) continue;
        const oneTime = getPlan(ord.planId)?.mode === "one_time";
        const refunded = Number(r.amount.amount);
        const original = Number(r.payment?.amount.amount);
        const change = await clawbackGrant({
          grantRefId: oneTime ? `order_${ord.id}` : `waffo_${r.paymentId}`,
          clawbackRefId,
          ratio: refunded > 0 && original > 0 ? refunded / original : 1,
          refunded: { amount: refunded },
        });
        t.fixed++;
        await logFix("waffo", { orderId: ord.id, userId: ord.userId, providerPaymentId: r.paymentId, providerRefundId: r.id, creditsDelta: -change, message: `refund ${r.id} (${refunded} of ${original}) was never processed here; clawed back ${change} credits` });
      } catch (e) {
        t.errors++;
        await logFailure("waffo", `refund ${r.id}`, e);
      }
    }
    if (refunds.length < 100) break;
  }
  // 3. 付款汇总的已退金额跟平台对齐（只改汇总、不动积分；放在退款之后，刚补扣的退款已经记进汇总，不会算两次）
  for (const [paymentId, refunded] of refundedAt) {
    const before = await syncPaymentRefunded(paymentId, refunded);
    if (before) {
      await logFix(
        "waffo",
        { orderId: before.orderId, userId: before.userId, providerPaymentId: paymentId, message: `payment summary said refunded ${before.refundedAmount} but Waffo says ${refunded}; summary updated (credits unchanged)` },
        "summary_synced",
      );
    }
  }
  // 4. 订阅状态（取消、欠费、恢复的回调丢了）。Waffo 的 id 是 ORD_ + 22 位字母数字（内部是 UUID），
  // 格式不对的不是 Waffo 的订单（本地测试数据），混进去会让整个查询报错
  const subs = (await liveSubscriptions("waffo")).filter((s) => /^ORD_[A-Za-z0-9]{22}$/.test(s.providerSubId));
  for (let i = 0; i < subs.length; i += 50) {
    const chunk = subs.slice(i, i + 50);
    const { orders } = await waffoQuery<{ orders: { id: string; status: string; currentPeriodEnd?: string | null }[] }>(
      `query($s: String!, $ids: [String!]) { orders: subscriptionOrders(storeId: $s, filter: { id: { in: $ids } }, limit: 50) { id status currentPeriodEnd } }`,
      { s: storeId, ids: chunk.map((s) => s.providerSubId) },
    );
    for (const local of chunk) {
      t.subscriptions++;
      const o = orders.find((x) => x.id === local.providerSubId);
      const st = o ? waffoSubStatus(o.status) : null;
      if (st) await syncStatus("waffo", local, { ...st, currentPeriodEnd: o?.currentPeriodEnd ? new Date(o.currentPeriodEnd) : null }, t);
    }
  }
}

async function stripeRecent(since: Date, t: Tally) {
  const stripe = stripeClient();
  const created = { gte: Math.floor(since.getTime() / 1000) };
  // 1. 已付的订阅账单（首期和续费）
  for await (const inv of stripe.invoices.list({ status: "paid", created, limit: 100 })) {
    t.payments++;
    const details = inv.parent?.subscription_details;
    const subId = idOf(details?.subscription);
    const { userId, planId, orderId } = details?.metadata ?? {};
    if (!inv.id || !subId || !userId || !planId || (await processed(`stripe_${inv.id}`))) continue;
    try {
      // 只认本站的：订阅已在本地，或账单带的订单号是这个用户在 Stripe 下的订单（同一个 Stripe 账号可能还有别的站）
      const existing = await findSubscription("stripe", subId);
      const ord = orderId ? await getOrder(orderId) : null;
      const ours = existing ? existing.userId === userId : ord?.provider === "stripe" && ord.userId === userId;
      if (!ours) continue;
      const sub = await stripe.subscriptions.retrieve(subId);
      const done = await backfillSubscription(
        { provider: "stripe", userId, planId, orderId },
        { id: subId, customerId: idOf(inv.customer), status: stripeSubStatus(sub.status), cancelAtPeriodEnd: sub.cancel_at_period_end, currentPeriodEnd: fromUnix(sub.items.data[0]?.current_period_end) },
        [{ refId: `stripe_${inv.id}`, paid: { providerPaymentId: inv.id, amount: inv.amount_paid, currency: inv.currency, listAmount: inv.subtotal } }],
      );
      if (done.length) {
        t.fixed++;
        await logFix("stripe", { orderId, userId, providerPaymentId: inv.id, providerSubId: subId, message: `invoice ${inv.id}: ${done.join("; ")}` });
      }
    } catch (e) {
      t.errors++;
      await logFailure("stripe", `invoice ${inv.id}`, e);
    }
  }
  // 2. 退款：按 charge 的累计已退金额补扣（和 charge.refunded 回调一样是累计口径，多笔退款只补差额）
  const db = await getDb();
  for await (const r of stripe.refunds.list({ created, limit: 100, expand: ["data.charge"] })) {
    t.refunds++;
    if (r.status !== "succeeded" || !r.charge) continue;
    try {
      const charge = typeof r.charge === "string" ? await stripe.charges.retrieve(r.charge) : r.charge;
      const grantRefId = await grantRefIdForPaymentIntent(idOf(charge.payment_intent));
      if (!grantRefId) continue;
      const [p] = await db.select().from(schema.payment).where(eq(schema.payment.grantRefId, grantRefId));
      if (!p || p.refundedAmount >= charge.amount_refunded) continue; // 不是本站的，或已经处理过
      const change = await clawbackGrant({
        grantRefId,
        clawbackRefId: `stripe_refund_recon_${charge.id}_${charge.amount_refunded}`,
        ratio: charge.amount > 0 ? charge.amount_refunded / charge.amount : 1,
        cumulative: true,
        refunded: { amount: charge.amount_refunded, cumulative: true },
      });
      t.fixed++;
      await logFix("stripe", { orderId: p.orderId, userId: p.userId, providerPaymentId: p.providerPaymentId, providerRefundId: r.id, creditsDelta: -change, message: `charge ${charge.id} refunded ${charge.amount_refunded} of ${charge.amount} but only ${p.refundedAmount} was recorded here; clawed back ${change} credits` });
    } catch (e) {
      t.errors++;
      await logFailure("stripe", `refund ${r.id}`, e);
    }
  }
  // 3. 订阅状态
  for (const local of await liveSubscriptions("stripe")) {
    t.subscriptions++;
    try {
      const sub = await stripe.subscriptions.retrieve(local.providerSubId);
      await syncStatus("stripe", local, { status: stripeSubStatus(sub.status), cancelAtPeriodEnd: sub.cancel_at_period_end, currentPeriodEnd: fromUnix(sub.items.data[0]?.current_period_end) }, t);
    } catch (e) {
      t.errors++;
      await logFailure("stripe", `subscription ${local.providerSubId}`, e);
    }
  }
}

/** Creem 没有按时间拉付款 / 退款的接口：pending 订单靠主动查单补，这里只核对订阅状态 */
async function creemRecent(_since: Date, t: Tally) {
  for (const local of await liveSubscriptions("creem")) {
    t.subscriptions++;
    try {
      const sub = await getCreemSubscription(local.providerSubId);
      const st = creemSubStatus(sub?.status);
      if (st) await syncStatus("creem", local, { ...st, currentPeriodEnd: sub?.current_period_end_date ? new Date(sub.current_period_end_date) : null }, t);
    } catch (e) {
      t.errors++;
      await logFailure("creem", `subscription ${local.providerSubId}`, e);
    }
  }
}

const RECENT: Record<string, (since: Date, t: Tally) => Promise<void>> = {
  waffo: waffoRecent,
  stripe: stripeRecent,
  creem: creemRecent,
};

/** 每日对账：已配置的支付平台逐个跑，一家失败不影响别家 */
export async function reconcileRecent(opts: { hours?: number } = {}) {
  const since = new Date(Date.now() - (opts.hours ?? 48) * 3600_000);
  const result: Record<string, Tally> = {};
  for (const provider of configuredProviders()) {
    const t: Tally = { payments: 0, refunds: 0, subscriptions: 0, fixed: 0, errors: 0 };
    try {
      await RECENT[provider](since, t);
    } catch (e) {
      t.errors++;
      await logFailure(provider, "reconciliation", e);
    }
    result[provider] = t;
  }
  return result;
}
