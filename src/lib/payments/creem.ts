import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isLocalDev } from "@/lib/env";
import { providerFetch } from "./http";
import type { PaymentProvider } from "./types";

/**
 * Creem：面向独立开发者的 MoR（代收代缴全球税费），国内个人也能开通
 * 测试模式：CREEM_TEST_MODE=true 时使用 test-api.creem.io
 */
const baseUrl = () =>
  // CREEM_API_BASE_URL 只给本地测试脚本指向假 Creem 用（scripts/payment-test.mjs），线上一律走官方地址
  (isLocalDev() && process.env.CREEM_API_BASE_URL) ||
  (process.env.CREEM_TEST_MODE === "true" ? "https://test-api.creem.io" : "https://api.creem.io");

export const creemProvider: PaymentProvider = {
  id: "creem",

  async createCheckout({ orderId, plan, user, successUrl, promoCode }) {
    const key = process.env.CREEM_API_KEY;
    const productId = process.env[`CREEM_PRODUCT_${plan.id.toUpperCase()}`];
    if (!key) throw new Error("CREEM_API_KEY is not set");
    if (!productId) throw new Error(`CREEM_PRODUCT_${plan.id.toUpperCase()} is not set`);

    // 超时 + 重试 1 次：重复建出的收银台只是多一个没人付的会话，不会多扣钱
    const create = (code?: string) =>
      providerFetch(
        `${baseUrl()}/v1/checkouts`,
        {
          method: "POST",
          headers: { "x-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: productId,
            request_id: orderId,
            success_url: successUrl,
            customer: { email: user.email },
            metadata: { orderId, userId: user.id, planId: plan.id },
            // 链接带的优惠码预填到收银台（用户在收银台本来就能自己填码）
            ...(code ? { discount_code: code } : {}),
          }),
        },
        { retries: 1, label: "Creem checkout" },
      );
    let res = await create(promoCode);
    let promoDropped: string | undefined;
    // 码不能用时 Creem 建单会报错：去掉码重来，用户照常付款
    if (!res.ok && promoCode && res.status < 500) {
      promoDropped = `Creem rejected "${promoCode}": ${res.status} ${(await res.text()).slice(0, 200)}`;
      console.warn(`[checkout] ${promoDropped}, continuing without it`);
      res = await create();
    }
    if (!res.ok) throw new Error(`Creem checkout failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string; checkout_url: string };
    return { url: data.checkout_url, providerRef: data.id, ...(promoDropped ? { promoDropped } : {}) };
  },
};

/** Creem 的收银台 / 订阅（主动查单、对账用到的字段） */
export type CreemSubscription = { id: string; status?: string; current_period_end_date?: string; customer?: { id?: string } | string };
export type CreemCheckout = {
  id: string;
  status?: string;
  request_id?: string;
  metadata?: { orderId?: string; userId?: string; planId?: string };
  order?: { id?: string; transaction?: string; amount?: number; amount_paid?: number; currency?: string };
  subscription?: CreemSubscription | string | null;
  customer?: { id?: string } | string;
};

/** Creem 只读查询（GET 可以放心重试）；404 返回 null */
async function creemGet<T>(apiPath: string): Promise<T | null> {
  const key = process.env.CREEM_API_KEY;
  if (!key) throw new Error("CREEM_API_KEY is not set");
  const res = await providerFetch(`${baseUrl()}${apiPath}`, { headers: { "x-api-key": key } }, { retries: 2, label: `Creem GET ${apiPath.split("?")[0]}` });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Creem GET ${apiPath}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const getCreemCheckout = (checkoutId: string) => creemGet<CreemCheckout>(`/v1/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`);
export const getCreemSubscription = (subscriptionId: string) =>
  creemGet<CreemSubscription>(`/v1/subscriptions?subscription_id=${encodeURIComponent(subscriptionId)}`);

/** Creem 订阅状态 → 本站状态；不认识的返回 null（不动本地） */
export function creemSubStatus(s: string | undefined): { status: string; cancelAtPeriodEnd: boolean } | null {
  if (s === "active" || s === "trialing") return { status: "active", cancelAtPeriodEnd: false };
  if (s === "scheduled_cancel") return { status: "active", cancelAtPeriodEnd: true };
  if (s === "canceled") return { status: "canceled", cancelAtPeriodEnd: false };
  if (s === "expired") return { status: "expired", cancelAtPeriodEnd: false };
  if (s === "past_due" || s === "unpaid" || s === "paused") return { status: "past_due", cancelAtPeriodEnd: false };
  return null;
}

/** 校验 webhook 签名：HMAC-SHA256(原始请求体, webhook secret)，与 creem-signature 头比较 */
export function verifyCreemSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
