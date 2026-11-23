import { NextResponse } from "next/server";
import { verifyCreemSignature } from "@/lib/payments/creem";
import { eventTime, paymentTrail, statusResult } from "@/lib/payments/events";
import {
  clawbackGrant,
  findSubscription,
  fulfillOrder,
  getOrder,
  grantSubscriptionCredits,
  updateSubscriptionStatus,
  upsertSubscription,
} from "@/lib/payments/fulfill";

/**
 * Creem webhook：在 Creem 后台 Developers → Webhooks 添加 https://你的域名/api/webhooks/creem
 * 同一事件可能重复推送，处理逻辑全部幂等。
 * 退款（refund.created）和拒付（dispute.created）按当初发放的那一笔扣回积分，余额不够会变成负数（冻结）；
 * 当期订阅款全额退回时 Pro 立即结束，部分退款保留 Pro。
 * 订阅状态按事件时间（created_at）取最新：重推或晚到的旧事件不改状态。
 */
type Meta = { orderId?: string; userId?: string; planId?: string };
type Transaction = { id: string; amount_paid?: number; subscription?: string | null };
type CreemEvent = {
  id: string;
  eventType: string;
  /** 事件创建时间（毫秒时间戳） */
  created_at?: number | string;
  object: {
    id: string;
    request_id?: string;
    metadata?: Meta;
    subscription?: { id: string; metadata?: Meta } | null;
    customer?: { id?: string; email?: string } | string;
    current_period_end_date?: string;
    status?: string;
    /** subscription.paid：刚付款的那笔交易（amount 是折扣前的标价，amount_paid 是实付） */
    last_transaction_id?: string;
    last_transaction?: { id?: string; amount?: number; amount_paid?: number; currency?: string };
    /** refund.created / dispute.created */
    transaction?: Transaction;
    checkout?: { id: string; request_id?: string; metadata?: Meta };
    /** checkout.completed：这次付款生成的订单（实付金额、交易号） */
    order?: { id?: string; transaction?: string; amount?: number; amount_paid?: number; currency?: string };
    refund_amount?: number;
    amount?: number;
  };
};

const STATUS: Record<string, string> = {
  "subscription.active": "active",
  "subscription.trialing": "active",
  "subscription.canceled": "canceled",
  "subscription.expired": "expired",
  "subscription.past_due": "past_due",
  "subscription.unpaid": "past_due",
  "subscription.paused": "past_due",
};

/** 找到被退款 / 拒付的交易当初发的那笔积分：订阅按交易号，一次性按我们的订单号 */
async function grantRefIdOf(obj: CreemEvent["object"]): Promise<string | null> {
  const tx = obj.transaction;
  if (tx?.subscription) return `creem_tx_${tx.id}`;
  const orderId = obj.checkout?.request_id ?? obj.checkout?.metadata?.orderId;
  const ord = orderId ? await getOrder(orderId) : null;
  return ord?.provider === "creem" ? `order_${ord.id}` : null;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyCreemSignature(raw, request.headers.get("creem-signature"))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  const event = JSON.parse(raw) as CreemEvent;
  const obj = event.object;
  const customerId = typeof obj.customer === "string" ? obj.customer : (obj.customer?.id ?? null);
  // 支付流水：验签通过的每条回调记一行
  const trail = paymentTrail({ provider: "creem", providerEventType: event.eventType, providerEventId: event.id, raw: obj });
  const eventAt = eventTime(event.created_at);
  const STALE = " (stale event: status unchanged)";

  try {
    if (event.eventType === "checkout.completed") {
      const meta = obj.metadata ?? {};
      const orderId = meta.orderId ?? obj.request_id;
      const providerPaymentId = obj.order?.transaction ?? obj.id;
      const charged = obj.order?.amount_paid ?? obj.order?.amount;
      trail.set({
        kind: obj.subscription ? "subscription_started" : "paid",
        orderId,
        providerOrderId: obj.id,
        providerPaymentId: obj.subscription ? undefined : providerPaymentId,
        currency: obj.order?.currency?.toLowerCase(),
        chargedAmount: charged,
        listAmount: obj.order?.amount,
      });
      if (!orderId) {
        trail.result("ignored", "no request_id / metadata.orderId — not an order from this site");
      } else {
        const { credits } = await fulfillOrder(orderId, "creem", {
          providerPaymentId,
          amount: charged,
          currency: obj.order?.currency,
          listAmount: obj.order?.amount,
        });
        trail.set({ creditsDelta: credits }).result("ok", obj.subscription ? "subscription checkout completed (credits come with subscription.paid)" : credits ? `order paid, +${credits} credits` : "already processed (duplicate delivery)");
      }
      if (obj.subscription && meta.userId && meta.planId) {
        await upsertSubscription({
          userId: meta.userId,
          provider: "creem",
          providerSubId: obj.subscription.id,
          providerCustomerId: customerId,
          planId: meta.planId,
          status: "active",
          eventAt,
        });
        trail.set({ providerSubId: obj.subscription.id });
      }
    } else if (event.eventType === "subscription.paid") {
      // 首期与每次续费：按期发放积分。refId 用这笔交易的 id，退款时才能对应扣回
      const existing = await findSubscription("creem", obj.id);
      const userId = obj.metadata?.userId ?? existing?.userId;
      const planId = obj.metadata?.planId ?? existing?.planId;
      const txId = obj.last_transaction_id ?? obj.last_transaction?.id ?? event.id;
      const tx = obj.last_transaction;
      trail.set({ kind: "period_paid", providerSubId: obj.id, providerPaymentId: txId, userId, planId, currency: tx?.currency?.toLowerCase(), chargedAmount: tx?.amount_paid, listAmount: tx?.amount });
      if (userId && planId) {
        const periodEnd = obj.current_period_end_date ? new Date(obj.current_period_end_date) : null;
        const applied = await upsertSubscription({
          userId,
          provider: "creem",
          providerSubId: obj.id,
          providerCustomerId: customerId,
          planId,
          status: "active",
          currentPeriodEnd: periodEnd,
          eventAt,
        });
        const r = await grantSubscriptionCredits({
          userId,
          planId,
          refId: `creem_tx_${txId}`,
          orderId: obj.metadata?.orderId,
          provider: "creem",
          providerSubId: obj.id,
          paid: { providerPaymentId: txId, amount: tx?.amount_paid, currency: tx?.currency, listAmount: tx?.amount },
          // 试用期：订阅状态是 trialing，或这笔交易的标价低于正价（在 grantSubscriptionCredits 里判断）
          trial: obj.status === "trialing" ? true : undefined,
        });
        trail
          .set({ kind: r.trial ? "trial_paid" : "period_paid", creditsDelta: r.credits })
          .result("ok", (r.trial ? `trial period: +${r.credits} trial credits` : r.granted ? `period paid, +${r.credits} credits` : "already processed (duplicate delivery)") + (applied ? "" : STALE));
      } else {
        trail.result("ignored", "no subscription or metadata on this site for this payment — no credits granted");
      }
    } else if (event.eventType === "refund.created" || event.eventType === "dispute.created") {
      // 退款按退款金额占实付金额的比例扣回；拒付按拒付金额（一般是全额）
      const isRefund = event.eventType === "refund.created";
      const paid = obj.transaction?.amount_paid ?? 0;
      const taken = isRefund ? (obj.refund_amount ?? 0) : (obj.amount ?? 0);
      const grantRefId = await grantRefIdOf(obj);
      trail.set({
        kind: isRefund ? "refunded" : "dispute_opened",
        providerPaymentId: obj.transaction?.id,
        orderId: obj.checkout?.request_id,
        providerSubId: obj.transaction?.subscription ?? undefined,
        providerRefundId: obj.id,
        chargedAmount: paid || undefined,
        refundedAmount: taken || undefined,
      });
      const change = await clawbackGrant({
        grantRefId,
        clawbackRefId: `creem_${isRefund ? "refund" : "dispute"}_${obj.id}`,
        ratio: paid > 0 && taken > 0 ? taken / paid : 1,
        ...(isRefund ? { refunded: taken > 0 ? { amount: taken } : undefined } : { dispute: true }),
      });
      trail.set({ creditsDelta: -change }).result(grantRefId ? "ok" : "error", grantRefId ? `${isRefund ? "refund" : "chargeback"} ${taken} of ${paid}, clawed back ${change} credits` : "refund / chargeback for a payment this site never recorded — nothing clawed back");
    } else if (event.eventType === "subscription.scheduled_cancel") {
      const r = await updateSubscriptionStatus("creem", obj.id, { cancelAtPeriodEnd: true }, eventAt);
      trail.set({ kind: "subscription_status", providerSubId: obj.id }).result(...statusResult(r, "cancels at period end"));
    } else if (STATUS[event.eventType]) {
      const r = await updateSubscriptionStatus("creem", obj.id, { status: STATUS[event.eventType] }, eventAt);
      trail.set({ kind: "subscription_status", providerSubId: obj.id }).result(...statusResult(r, `status ${STATUS[event.eventType]}`));
    } else {
      trail.result("ignored", "event type not handled");
    }
  } catch (e) {
    console.error("[creem webhook]", event.eventType, e);
    await trail.result("error", (e as Error).message).save();
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  await trail.save();
  return NextResponse.json({ received: true });
}
