import "server-only";
import Stripe from "stripe";
import { isLocalDev } from "@/lib/env";
import { providerTimeoutMs } from "./http";
import type { PaymentProvider } from "./types";

let client: Stripe | null = null;
export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  // STRIPE_API_BASE_URL 只给本地测试脚本指向假 Stripe 用（scripts/payment-test.mjs），线上一律走官方地址
  const override = isLocalDev() && process.env.STRIPE_API_BASE_URL ? new URL(process.env.STRIPE_API_BASE_URL) : null;
  // 超时和网络重试交给 SDK：Stripe 重试 POST 时会自动带同一个幂等键，不会重复建单 / 重复退款
  client ??= new Stripe(key, {
    timeout: providerTimeoutMs(),
    maxNetworkRetries: 2,
    ...(override ? { host: override.hostname, port: Number(override.port), protocol: override.protocol.replace(":", "") as "http" | "https" } : {}),
  });
  return client;
}

export const stripeProvider: PaymentProvider = {
  id: "stripe",

  async createCheckout({ orderId, plan, user, successUrl, cancelUrl, promoCode }) {
    const price = process.env[`STRIPE_PRICE_${plan.id.toUpperCase()}`];
    if (!price) throw new Error(`STRIPE_PRICE_${plan.id.toUpperCase()} is not set`);
    const metadata = { orderId, userId: user.id, planId: plan.id };

    // 链接带的优惠码：查到有效的推广码就直接用上；查不到就照常让用户在收银台自己填。
    // Stripe 不允许同时传 discounts 和 allow_promotion_codes，二选一
    const promo = promoCode ? (await stripeClient().promotionCodes.list({ code: promoCode, active: true, limit: 1 })).data[0] : undefined;
    const discount = promo ? { discounts: [{ promotion_code: promo.id }] } : { allow_promotion_codes: true };

    const session = await stripeClient().checkout.sessions.create({
      mode: plan.mode === "subscription" ? "subscription" : "payment",
      line_items: [{ price, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      // 订阅的每期账单也要带上 userId / planId，续费 webhook 才能找到用户；
      // 一次性付款写在 PaymentIntent 上，退款 / 拒付时能对应回订单
      ...(plan.mode === "subscription" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      ...discount,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return {
      url: session.url,
      providerRef: session.id,
      ...(promoCode && !promo ? { promoDropped: `no active Stripe promotion code "${promoCode}"` } : {}),
    };
  },

  async getPortalUrl(customerId, returnUrl) {
    const portal = await stripeClient().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return portal.url;
  },
};

/**
 * 退款申请批准后退款（金额单位：分）。一次性付款记的是 PaymentIntent，订阅记的是账单 in_…，先找到账单对应的 PaymentIntent。
 * idempotencyKey 用申请号：网络重试不会退两次。
 */
export async function refundStripePayment(p: { providerPaymentId: string }, amount: number, requestId: string): Promise<string> {
  const stripe = stripeClient();
  let paymentIntent = p.providerPaymentId;
  if (paymentIntent.startsWith("in_")) {
    const payments = await stripe.invoicePayments.list({ invoice: paymentIntent, limit: 1 });
    const pi = payments.data[0]?.payment?.payment_intent;
    if (!pi) throw new Error(`No PaymentIntent found for invoice ${paymentIntent}`);
    paymentIntent = typeof pi === "string" ? pi : pi.id;
  }
  const refund = await stripe.refunds.create(
    { payment_intent: paymentIntent, amount, metadata: { refundRequestId: requestId } },
    { idempotencyKey: `refund_${requestId}` },
  );
  return refund.id;
}

/** 订阅退款后关掉自动续费：本期到期后结束（全额退款的话我们这边已经立即结束 Pro） */
export async function cancelStripeRenewal(subscriptionId: string) {
  await stripeClient().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

/**
 * 找到某笔付款（PaymentIntent）当初发的那笔积分，退款 / 拒付时扣回用：
 * - 订阅账单的付款 → stripe_<账单号>（invoice.paid 发积分时用的 refId）
 * - 一次性付款 → order_<订单号>（从收银台会话的 metadata 找回订单号）
 */
export async function grantRefIdForPaymentIntent(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const stripe = stripeClient();
  const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1 });
  const invoice = payments.data[0]?.invoice;
  if (invoice) return `stripe_${typeof invoice === "string" ? invoice : invoice.id}`;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const orderId = sessions.data[0]?.metadata?.orderId;
  return orderId ? `order_${orderId}` : null;
}

/** Stripe 订阅状态 → 本站状态（trialing 算有效，unpaid 算欠费） */
export const stripeSubStatus = (s: Stripe.Subscription.Status) =>
  s === "active" || s === "trialing" ? "active" : s === "past_due" || s === "unpaid" ? "past_due" : s === "canceled" ? "canceled" : "expired";
