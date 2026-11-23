import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { paymentTrail, statusResult } from "@/lib/payments/events";
import { grantRefIdForPaymentIntent, stripeClient, stripeSubStatus } from "@/lib/payments/stripe";
import {
  clawbackGrant,
  fulfillOrder,
  grantSubscriptionCredits,
  restoreClawback,
  updateSubscriptionStatus,
  upsertSubscription,
} from "@/lib/payments/fulfill";

/**
 * Stripe webhook：在 Stripe 后台添加端点 https://你的域名/api/webhooks/stripe
 * 订阅以下事件：checkout.session.completed、invoice.paid、
 *             customer.subscription.updated、customer.subscription.deleted、
 *             charge.refunded、charge.dispute.created、charge.dispute.closed
 * 退款、拒付按当初发放的那一笔扣回积分（余额不够会变成负数 = 冻结），拒付赢了再还回去。
 * 当期订阅款全额退回时 Pro 立即结束（Stripe 退款不会自动取消订阅）；部分退款保留 Pro。
 * Stripe 不保证事件顺序：订阅状态按 event.created 取最新，重推或晚到的旧事件不改状态（积分照常按账单幂等发放）。
 * 本地调试：stripe listen --forward-to localhost:3000/api/webhooks/stripe
 */
const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 500 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(raw, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // 支付流水：验签通过的每条回调记一行
  const trail = paymentTrail({ provider: "stripe", providerEventType: event.type, providerEventId: event.id, raw: event.data.object });
  const eventAt = new Date(event.created * 1000);
  const STALE = " (stale event: status unchanged)";

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const { orderId, userId, planId } = s.metadata ?? {};
        trail.set({ kind: s.mode === "subscription" ? "subscription_started" : "paid", orderId, providerOrderId: s.id, currency: s.currency ?? undefined });
        if (!orderId) {
          trail.result("ignored", "no metadata.orderId — not an order from this site");
          break;
        }
        // 100% 折扣的优惠码：Stripe 不收钱，payment_status 是 no_payment_required，同样要发货
        if (s.mode === "payment" && s.payment_status !== "paid" && s.payment_status !== "no_payment_required") {
          trail.result("ignored", `payment_status ${s.payment_status} — waiting for the payment`);
          break;
        }
        // 一次性付款记下 PaymentIntent 和实付金额，网页退款时按它退；订阅的每期付款在 invoice.paid 里记
        const providerPaymentId = idOf(s.payment_intent) ?? s.id;
        trail.set({
          providerPaymentId: s.mode === "payment" ? providerPaymentId : undefined,
          chargedAmount: s.amount_total ?? undefined,
          listAmount: s.amount_subtotal ?? undefined,
          discountAmount: s.total_details?.amount_discount ?? undefined,
        });
        const { credits } = await fulfillOrder(orderId, "stripe", {
          providerPaymentId,
          amount: s.amount_total,
          currency: s.currency,
          listAmount: s.amount_subtotal,
        });
        const subId = idOf(s.subscription);
        if (s.mode === "subscription" && subId && userId && planId) {
          await upsertSubscription({
            userId,
            provider: "stripe",
            providerSubId: subId,
            providerCustomerId: idOf(s.customer),
            planId,
            status: "active",
            eventAt,
          });
          trail.set({ providerSubId: subId });
        }
        trail.set({ creditsDelta: credits }).result("ok", s.mode === "subscription" ? "subscription checkout completed (credits come with invoice.paid)" : credits ? `order paid, +${credits} credits` : "already processed (duplicate delivery)");
        break;
      }

      case "invoice.paid": {
        // 订阅首期和每次续费都会触发：按期发放积分
        const inv = event.data.object;
        const details = inv.parent?.subscription_details;
        const subId = idOf(details?.subscription);
        const { userId, planId, orderId } = details?.metadata ?? {};
        trail.set({ kind: "period_paid", providerPaymentId: inv.id, providerSubId: subId ?? undefined, userId, planId, currency: inv.currency, chargedAmount: inv.amount_paid, listAmount: inv.subtotal, discountAmount: Math.max(inv.subtotal - inv.amount_paid, 0) });
        if (!subId || !userId || !planId || !inv.id) {
          trail.result("ignored", "invoice without our subscription metadata — no credits granted");
          break;
        }
        const periodEnd = inv.lines.data[0]?.period?.end;
        const applied = await upsertSubscription({
          userId,
          provider: "stripe",
          providerSubId: subId,
          providerCustomerId: idOf(inv.customer),
          planId,
          status: "active",
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          eventAt,
        });
        const r = await grantSubscriptionCredits({
          userId,
          planId,
          refId: `stripe_${inv.id}`,
          orderId,
          provider: "stripe",
          providerSubId: subId,
          // subtotal 是折扣前的标价：试用期账单是 0，优惠券只影响 amount_paid
          paid: { providerPaymentId: inv.id, amount: inv.amount_paid, currency: inv.currency, listAmount: inv.subtotal },
        });
        trail
          .set({ kind: r.trial ? "trial_paid" : "period_paid", creditsDelta: r.credits })
          .result("ok", (r.trial ? `trial period (list price below the plan price): +${r.credits} trial credits` : r.granted ? `period paid, +${r.credits} credits` : "already processed (duplicate delivery)") + (applied ? "" : STALE));
        break;
      }

      case "charge.refunded": {
        // 退款（可能分多次）：amount_refunded 是累计已退金额，按累计比例补扣到位
        const charge = event.data.object;
        const pi = idOf(charge.payment_intent);
        const grantRefId = await grantRefIdForPaymentIntent(pi);
        trail.set({ kind: "refunded", providerPaymentId: grantRefId?.startsWith("stripe_") ? grantRefId.slice("stripe_".length) : (pi ?? undefined), currency: charge.currency, chargedAmount: charge.amount, refundedAmount: charge.amount_refunded });
        const change = await clawbackGrant({
          grantRefId,
          clawbackRefId: `stripe_refund_${event.id}`,
          ratio: charge.amount > 0 ? charge.amount_refunded / charge.amount : 1,
          cumulative: true,
          refunded: { amount: charge.amount_refunded, cumulative: true },
        });
        trail.set({ creditsDelta: -change }).result(grantRefId ? "ok" : "error", grantRefId ? `refunded ${charge.amount_refunded} of ${charge.amount} (cumulative), clawed back ${change} credits` : "refund for a payment this site never recorded — nothing clawed back");
        break;
      }

      case "charge.dispute.created": {
        // 拒付：先全额扣回；赢了再还（见 charge.dispute.closed）
        const dispute = event.data.object;
        const grantRefId = await grantRefIdForPaymentIntent(idOf(dispute.payment_intent));
        trail.set({ kind: "dispute_opened", providerPaymentId: grantRefId?.startsWith("stripe_") ? grantRefId.slice("stripe_".length) : (idOf(dispute.payment_intent) ?? undefined), providerRefundId: dispute.id, currency: dispute.currency, refundedAmount: dispute.amount });
        const change = await clawbackGrant({ grantRefId, clawbackRefId: `stripe_dispute_${dispute.id}`, dispute: true });
        trail.set({ creditsDelta: -change }).result(grantRefId ? "ok" : "error", grantRefId ? `chargeback opened, clawed back ${change} credits` : "chargeback for a payment this site never recorded");
        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object;
        trail.set({ kind: dispute.status === "won" ? "dispute_won" : "dispute_closed", providerPaymentId: idOf(dispute.payment_intent) ?? undefined, providerRefundId: dispute.id });
        if (dispute.status === "won") {
          const restored = await restoreClawback({ clawbackRefId: `stripe_dispute_${dispute.id}`, restoreRefId: `stripe_dispute_won_${dispute.id}` });
          trail.result("ok", restored ? "chargeback won, credits restored" : "chargeback won (already restored)");
        } else trail.result("ok", `chargeback closed: ${dispute.status}`);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const periodEnd = sub.items.data[0]?.current_period_end;
        const status = event.type === "customer.subscription.deleted" ? "canceled" : stripeSubStatus(sub.status);
        const r = await updateSubscriptionStatus(
          "stripe",
          sub.id,
          { status, cancelAtPeriodEnd: sub.cancel_at_period_end, currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null },
          eventAt,
        );
        trail.set({ kind: "subscription_status", providerSubId: sub.id }).result(...statusResult(r, `status ${status}${sub.cancel_at_period_end ? ", cancels at period end" : ""}`));
        break;
      }

      default:
        trail.result("ignored", "event type not handled");
    }
  } catch (e) {
    // 返回 500 让 Stripe 稍后重试（处理逻辑是幂等的）
    console.error("[stripe webhook]", event.type, e);
    await trail.result("error", (e as Error).message).save();
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  await trail.save();
  return NextResponse.json({ received: true });
}
