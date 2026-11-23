import { NextResponse } from "next/server";
import { verifyWebhook, type WebhookEventData } from "@waffo/pancake-ts";
import { getPlan } from "@/config/pricing";
import {
  clawbackGrant,
  findSubscription,
  fulfillOrder,
  getOrder,
  grantSubscriptionCredits,
  updateSubscriptionStatus,
  upsertSubscription,
} from "@/lib/payments/fulfill";
import { eventTime, paymentTrail, statusResult } from "@/lib/payments/events";
import { releaseRefundForPayment } from "@/lib/payments/refunds";
import { waffoCents } from "@/lib/payments/waffo";

/** 退款比例 = 这次退的金额 ÷ 原支付金额（Waffo 的金额是展示格式字符串）；拿不到就按全额 */
const ratioOf = (refunded?: string, original?: string) => {
  const r = Number(refunded);
  const o = Number(original);
  return r > 0 && o > 0 ? r / o : 1;
};

const cents = waffoCents;

/**
 * Waffo webhook：控制台「设置 → Webhooks」添加 https://你的域名/api/webhooks/waffo，测试、生产环境各加一条，
 * 勾选下面 switch 里处理的事件。同一事件可能重试推送，处理逻辑全部幂等。
 *
 * 安全要点（顺序很重要）：
 * 1. 用 request.text() 读原始请求体验签：签名是对原始字节算的，request.json() 会让验签失败
 * 2. 校验 storeId：Waffo 全平台共用同一对签名密钥（测试一对、生产一对），验签通过只说明「是 Waffo 发的」，
 *    不说明「是我们店铺的订单」。别人在自己店铺里把 webhook 填成我们的地址，给自己下单，签名一样是真的
 * 3. 校验 mode：WAFFO_TEST_MODE=true 时只处理测试事件，否则只处理生产事件（测试卡谁都能刷）
 * 4. 给谁发、发多少，只看我们数据库里的订单 / 订阅记录；回调里的 orderMetadata 只用来找到订单
 * 5. 退款（refund.succeeded）按当初发放的那一笔扣回积分，余额不够会变成负数（冻结）；
 *    当期订阅款全额退回时 Pro 立即结束（Waffo 自己仍显示订阅到期前有效，也不会另发结束事件）
 * 6. 订阅状态按事件时间（event.timestamp）取最新：重推或乱序到达的旧事件不改状态，积分照常按付款幂等发放
 *
 * 本地联调用 ngrok 转发；localtunnel 会丢掉 X-Waffo-Signature 头。
 */
export async function POST(request: Request) {
  const storeId = process.env.WAFFO_STORE_ID;
  if (!storeId) return NextResponse.json({ error: "not_configured" }, { status: 500 });

  const raw = await request.text();
  let event;
  try {
    event = verifyWebhook<WebhookEventData>(raw, request.headers.get("x-waffo-signature"));
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const d = event.data;
  const orderId = d.orderMetadata?.orderId;
  // 支付流水：验签通过的每条回调记一行（别人店铺的、环境不符的也记，方便发现配置问题）
  const trail = paymentTrail({
    provider: "waffo",
    providerEventType: event.eventType,
    providerEventId: event.eventId,
    providerOrderId: d.orderId,
    providerPaymentId: d.paymentId,
    currency: d.currency?.toLowerCase(),
    raw: d,
  });

  if (event.storeId !== storeId) {
    console.warn(`[waffo webhook] rejected event from foreign store ${event.storeId}`);
    await trail.result("rejected", `event from another store ${event.storeId} (signature is valid but it is not our order)`).save();
    return NextResponse.json({ error: "foreign_store" }, { status: 403 });
  }
  const expectedMode = process.env.WAFFO_TEST_MODE === "true" ? "test" : "prod";
  if (event.mode !== expectedMode) {
    await trail.result("ignored", `${event.mode} event while WAFFO_TEST_MODE expects ${expectedMode}`).save();
    return NextResponse.json({ ignored: `mode ${event.mode}` });
  }
  if (orderId) trail.set({ orderId });
  const periodEnd = d.currentPeriodEnd ? new Date(d.currentPeriodEnd) : undefined;
  const eventAt = eventTime(event.timestamp);
  /**
   * 付款事件里实际扣款的金额（chargedAmount，旧事件只有 amount），以及这一期的标价 listPrice.listTotal
   * （折扣前；试用期扣款是试用价，用来认出试用。SDK 0.26 的类型里还没有这个字段）
   */
  const paidWith = (paymentId: string) => ({
    providerPaymentId: paymentId,
    amount: cents(d.chargedAmount ?? d.amount),
    currency: d.currency,
    listAmount: cents((d.listPrice as { listTotal?: string } | undefined)?.listTotal),
  });

  /**
   * 找到这笔 Waffo 订阅对应的用户和方案：优先用已有的订阅记录，否则用我们的订单（必须是 Waffo 下的订阅订单）。
   * 找不到就什么都不做：不能用回调里的 userId / planId 直接发积分。
   */
  const resolveSubscriber = async () => {
    const existing = await findSubscription("waffo", d.orderId);
    if (existing) return { userId: existing.userId, planId: existing.planId };
    const ord = orderId ? await getOrder(orderId) : null;
    if (!ord || ord.provider !== "waffo" || getPlan(ord.planId)?.mode !== "subscription") return null;
    return { userId: ord.userId, planId: ord.planId };
  };
  /** 返回订阅的用户和方案，以及这次状态有没有被采用（旧事件不改状态） */
  const saveSubscription = async (patch: { status: string; currentPeriodEnd?: Date }) => {
    const sub = await resolveSubscriber();
    if (!sub) return null;
    const applied = await upsertSubscription({
      ...sub,
      provider: "waffo",
      providerSubId: d.orderId,
      providerCustomerId: sub.userId, // 下单时 buyerIdentity 用的就是我们的用户 id，客户门户按它登录
      ...patch,
      eventAt,
    });
    return { sub, applied };
  };
  const STALE = " (stale event: status unchanged)";

  /** 付款事件：标价、折扣、实付写进流水 */
  const tracePaid = (paymentId: string) => {
    const p = paidWith(paymentId);
    trail.set({
      providerPaymentId: paymentId,
      chargedAmount: p.amount ?? undefined,
      listAmount: p.listAmount ?? undefined,
      discountAmount: p.listAmount != null && p.amount != null ? Math.max(p.listAmount - p.amount, 0) : undefined,
    });
    return p;
  };

  try {
    switch (event.eventType) {
      case "order.completed": {
        // 一次性购买成功：标记订单已付并发积分（数量按订单的方案），记下这笔付款供网页退款
        trail.set({ kind: "paid" });
        if (!orderId) {
          trail.result("ignored", "no orderMetadata.orderId — not an order from this site");
          break;
        }
        const { credits } = await fulfillOrder(orderId, "waffo", tracePaid(d.paymentId ?? event.eventId));
        trail.set({ creditsDelta: credits }).result("ok", credits ? `order paid, +${credits} credits` : "already processed (duplicate delivery)");
        break;
      }
      case "subscription.activated": {
        // 首次订阅成功：标记订单已付、建订阅记录（积分在 payment_succeeded 里发）
        trail.set({ kind: "subscription_started", providerSubId: d.orderId });
        if (orderId) await fulfillOrder(orderId, "waffo");
        const saved = await saveSubscription({ status: "active", currentPeriodEnd: periodEnd });
        if (!saved) trail.result("ignored", "no matching order on this site");
        else trail.result(saved.applied ? "ok" : "ignored", `subscription active until ${d.currentPeriodEnd ?? "?"}${saved.applied ? "" : STALE}`);
        break;
      }
      case "subscription.payment_succeeded": {
        // 首期和每次续费都会触发：按期发积分。eventId 是这笔扣款的 Payment ID，重复推送只发一次
        trail.set({ kind: "period_paid", providerSubId: d.orderId });
        const saved = await saveSubscription({ status: "active" });
        if (!saved) {
          trail.result("ignored", "no subscription or order on this site for this payment — no credits granted");
          break;
        }
        // 旧的付款事件晚到也照常发这一期的积分（付款确实发生了，按付款 id 幂等），只是不改订阅状态
        const r = await grantSubscriptionCredits({
          ...saved.sub,
          refId: `waffo_${event.eventId}`,
          orderId,
          provider: "waffo",
          providerSubId: d.orderId,
          paid: tracePaid(event.eventId),
        });
        trail
          .set({ kind: r.trial ? "trial_paid" : "period_paid", creditsDelta: r.credits })
          .result("ok", (r.trial ? `trial period (list price below the plan price): +${r.credits} trial credits` : r.granted ? `period paid, +${r.credits} credits` : "already processed (duplicate delivery)") + (saved.applied ? "" : STALE));
        break;
      }
      case "subscription.renewed":
      case "subscription.recovered":
      case "subscription.canceling": // 用户发起取消：本期结束前仍然有效
      case "subscription.uncanceled":
      case "subscription.canceled":
      case "subscription.past_due": {
        const patch =
          event.eventType === "subscription.canceling"
            ? { cancelAtPeriodEnd: true }
            : event.eventType === "subscription.uncanceled"
              ? { cancelAtPeriodEnd: false }
              : event.eventType === "subscription.canceled"
                ? { status: "canceled" }
                : event.eventType === "subscription.past_due"
                  ? { status: "past_due" }
                  : { status: "active", ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) };
        const r = await updateSubscriptionStatus("waffo", d.orderId, patch, eventAt);
        trail.set({ kind: "subscription_status", providerSubId: d.orderId }).result(...statusResult(r, event.eventType.replace("subscription.", "")));
        break;
      }
      case "refund.succeeded": {
        // 退款完成：一次性订单扣回该订单发的积分；订阅扣回被退那一期发的积分（eventId 是 Refund ID，每笔退款单独推送）
        const ord = orderId ? await getOrder(orderId) : null;
        const oneTime = ord && ord.provider === "waffo" && getPlan(ord.planId)?.mode === "one_time";
        const grantRefId = oneTime ? `order_${ord.id}` : d.paymentId ? `waffo_${d.paymentId}` : null;
        const refunded = cents(d.refundedAmount);
        trail.set({ kind: "refunded", providerRefundId: event.eventId, refundedAmount: refunded ?? undefined, chargedAmount: cents(d.originalChargedAmount) ?? undefined });
        const change = await clawbackGrant({
          grantRefId,
          clawbackRefId: `waffo_refund_${event.eventId}`,
          ratio: ratioOf(d.refundedAmount, d.originalChargedAmount),
          refunded: refunded != null ? { amount: refunded } : undefined,
        });
        trail.set({ creditsDelta: -change }).result(grantRefId ? "ok" : "error", grantRefId ? `refund ${d.refundedAmount} of ${d.originalChargedAmount}, clawed back ${change} credits` : "refund for a payment this site never recorded — nothing clawed back");
        break;
      }
      case "refund.failed": {
        // 网页退款申请的退款没退成：撤回这笔付款上处理中的申请，冻结的积分还给用户
        const released = d.paymentId ? await releaseRefundForPayment(d.paymentId, "refund failed at Waffo") : false;
        trail.set({ kind: "refund_failed", providerRefundId: event.eventId }).result("ok", released ? "refund failed at Waffo; held credits returned" : "refund failed at Waffo; no request was holding credits");
        break;
      }
      default:
        trail.result("ignored", "event type not handled");
    }
  } catch (e) {
    // 返回 500 让 Waffo 重试（默认 3 次，指数退避）
    console.error("[waffo webhook]", event.eventType, e);
    await trail.result("error", (e as Error).message).save();
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  await trail.save();
  return NextResponse.json({ received: true });
}
