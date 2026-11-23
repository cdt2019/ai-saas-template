import "server-only";
import { createHash, createSign } from "node:crypto";
import { WaffoPancake } from "@waffo/pancake-ts";
import { isLocalDev } from "@/lib/env";
import { providerFetch, timedFetch } from "./http";
import type { PaymentProvider } from "./types";

/**
 * Waffo Pancake：MoR（代收代缴全球税费），官方 SDK @waffo/pancake-ts 负责请求签名和 webhook 验签
 * - 测试 / 生产由 API Key 决定：控制台测试模式下创建的 key 走测试环境，上线换生产 key（两套 key 不要混用）
 * - 产品在控制台「产品」里创建，把 Product ID 填进 WAFFO_PRODUCT_<方案ID大写>；价格以 Waffo 产品为准，
 *   src/config/pricing.ts 里的 price 只用于页面展示，两边要保持一致
 * - 产品默认建在测试环境，上线前要在控制台发布到生产，否则生产收银台会失败
 * - 测试卡：4576 7500 0000 0110（成功）、4576 7500 0000 0220（拒绝），有效期任意未来日期，CVC 任意
 */
let client: WaffoPancake | null = null;

export function waffoClient(): WaffoPancake {
  const merchantId = process.env.WAFFO_MERCHANT_ID;
  const privateKey = readPrivateKey();
  if (!merchantId || !privateKey) throw new Error("WAFFO_MERCHANT_ID / WAFFO_PRIVATE_KEY is not set");
  // WAFFO_API_BASE_URL 只给本地测试脚本指向假 Waffo 用（scripts/payment-test.mjs），线上一律走官方地址
  const baseUrl = isLocalDev() ? process.env.WAFFO_API_BASE_URL : undefined;
  // 超时 + 重试 2 次：我们对 Waffo 的写都重放安全（建收银台带幂等键、签发令牌、取消订阅本身幂等），查询更不用说
  client ??= new WaffoPancake({ merchantId, privateKey, fetch: timedFetch("Waffo", 2), ...(baseUrl ? { baseUrl } : {}) });
  return client;
}

/** 私钥两种写法：WAFFO_PRIVATE_KEY（PEM，换行写成 \n）或 WAFFO_PRIVATE_KEY_BASE64（整段 PEM 的 base64，适合 CI） */
function readPrivateKey(): string | undefined {
  const b64 = process.env.WAFFO_PRIVATE_KEY_BASE64;
  if (b64) return Buffer.from(b64, "base64").toString("utf-8");
  return process.env.WAFFO_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

export const waffoProvider: PaymentProvider = {
  id: "waffo",

  async createCheckout({ orderId, plan, user, successUrl, promoCode }) {
    const productId = process.env[`WAFFO_PRODUCT_${plan.id.toUpperCase()}`];
    if (!productId) throw new Error(`WAFFO_PRODUCT_${plan.id.toUpperCase()} is not set`);

    type SessionParams = Parameters<ReturnType<typeof waffoClient>["checkout"]["authenticated"]["create"]>[0];
    const create = (code?: string) =>
      waffoClient().checkout.authenticated.create(
        {
          productId,
          currency: plan.currency.toUpperCase(),
          // 用我们自己的用户 id 作为客户身份：订单挂在这个身份下，客户门户也按它登录
          buyerIdentity: user.id,
          buyerEmail: user.email,
          successUrl,
          // 原样透传到 webhook 的 data.orderMetadata，回调靠它找到订单和用户
          metadata: { orderId, userId: user.id, planId: plan.id },
          orderMerchantExternalId: orderId,
          // 用 API Key 建的收银台默认不显示优惠码输入框（哪怕店铺有券），要显式打开；
          // 链接带的码用 promotionCode 预填，用户还能改或去掉。SDK 0.26 的类型里还没有这两个字段
          allowPromotionCodes: true,
          ...(code ? { promotionCode: code } : {}),
        } as SessionParams,
        { idempotencyKey: orderId },
      );
    try {
      const session = await create(promoCode);
      return { url: session.checkoutUrl, providerRef: session.sessionId };
    } catch (e) {
      // 码不能用（过期、不适用这个产品等）建单时就会 409：去掉码重来，用户照常付款（失败的请求不占幂等键）
      if (!promoCode || (e as { status?: number }).status !== 409) throw e;
      const reason = (e as { errors?: { message: string }[] }).errors?.map((x) => x.message).join("; ") ?? "409";
      console.warn(`[checkout] waffo rejected promo code ${promoCode} (${reason}), continuing without it`);
      const session = await create();
      return { url: session.checkoutUrl, providerRef: session.sessionId, promoDropped: `Waffo rejected "${promoCode}": ${reason}` };
    }
  },

  /**
   * 客户门户（改卡、取消订阅、看订单）：用 WAFFO_STORE_ID，customerId 是下单时的 buyerIdentity（我们的用户 id）。
   * 返回的链接带登录令牌，只能即时生成后马上跳转，不要记日志或保存。
   */
  async getPortalUrl(customerId) {
    const storeId = process.env.WAFFO_STORE_ID;
    if (!storeId) return null;
    const { portalUrl } = await waffoClient().auth.createCustomerPortalLink({ storeId, buyerIdentity: customerId });
    return portalUrl;
  },
};

/**
 * 自己签名时用的私钥：和 SDK 一样兼容几种写法 —— 完整 PEM、压成一行的 PEM、不带头尾的 base64（按 PKCS#8 处理）。
 * 控制台下载的私钥常常只有 base64，直接交给 node:crypto 会报 DECODER routines::unsupported
 */
function signingKey(): string {
  const raw = readPrivateKey()?.replace(/\r\n/g, "\n").trim();
  if (!raw) throw new Error("WAFFO_PRIVATE_KEY is not set");
  const label = raw.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const base64 = raw.replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END ${label}-----`;
}

/**
 * 商户签名的 POST，给 SDK 还没封装的接口用。签名和 SDK 内部一致：
 * RSA-SHA256( "POST\n<路径>\n<秒级时间戳>\n<base64(sha256(请求体))>" )，放在 X-Merchant-Id / X-Timestamp / X-Signature 里
 */
async function merchantPost<T>(apiPath: string, body: unknown, idempotencyKey: string): Promise<T> {
  const merchantId = process.env.WAFFO_MERCHANT_ID;
  const privateKey = signingKey();
  if (!merchantId) throw new Error("WAFFO_MERCHANT_ID is not set");
  const base = (isLocalDev() && process.env.WAFFO_API_BASE_URL) || "https://api.waffo.ai";
  const bodyStr = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(bodyStr).digest("base64");
  const signature = createSign("sha256").update(`POST\n${apiPath}\n${timestamp}\n${bodyHash}`).sign(privateKey, "base64");
  const res = await providerFetch(
    base.replace(/\/+$/, "") + apiPath,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Merchant-Id": merchantId,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        // 网关按它去重 24 小时：重试不会建出两张退款工单
        "X-Idempotency-Key": idempotencyKey,
      },
      body: bodyStr,
    },
    { retries: 2, label: `Waffo ${apiPath}` },
  );
  const envelope = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!envelope) throw new Error(`Waffo ${apiPath}: non-JSON response (${res.status})`);
  if (envelope.errors?.length || !res.ok) {
    throw new Error(`Waffo ${apiPath}: ${envelope.errors?.map((e) => e.message).join("; ") || res.status}`);
  }
  return envelope.data as T;
}

/**
 * 退款申请批准后：用商户 API Key 建退款工单（绑定这笔付款、金额由我们算好），Waffo 交给支付通道去退，结果走 refund.* 回调。
 * - SDK 0.26 的 customer.createRefundTicket 是买家侧接口，Waffo 现在不让买家建工单了（网关直接 403 Access denied），
 *   商户侧接口 SDK 还没封装，所以这里自己签名调 REST（文档：Refund Endpoints → Create Refund Ticket）
 * - 文档说订阅不走退款工单，但控制台退订阅付款实际也是商户工单；接口不支持的话批准会报错，积分还回去，改到后台手动退
 */
export async function createWaffoRefundTicket(
  p: { providerPaymentId: string; currency: string },
  amount: number,
  req: { id: string; reason: string },
): Promise<string> {
  // 字段以接口实际要求为准（文档写的是 amount，接口要 requestedAmount，和买家侧接口同形）；
  // 商户建的工单自动通过、直接进入 processing，结果走 refund.* 回调
  const data = await merchantPost<{ ticketId?: string; id?: string; ticket?: { id?: string } }>(
    "/v1/actions/refund-ticket/create-ticket",
    {
      paymentId: p.providerPaymentId,
      reason: req.reason,
      requestedAmount: { amount: (amount / 100).toFixed(2), currency: p.currency.toUpperCase() },
    },
    `refund_${req.id}`,
  );
  // 返回结构和文档不完全一致，几种写法都认；拿不到工单号也不影响退款本身（回调按付款 id 结单）
  return data?.ticketId ?? data?.ticket?.id ?? data?.id ?? "waffo_ticket";
}

/** 订阅退款后关掉自动续费（Waffo 侧变成 canceling，本期到期后结束） */
export async function cancelWaffoRenewal(orderId: string) {
  await waffoClient().orders.cancelSubscription({ orderId });
}

/** Waffo 的展示金额字符串（"19.00"）→ 分；模板的价格都是两位小数的美元 */
export const waffoCents = (s?: string | null) => (s && Number.isFinite(Number(s)) ? Math.round(Number(s) * 100) : null);

/** Waffo 订阅订单状态 → 本站状态；pending（还没付款）返回 null */
export function waffoSubStatus(s: string | null | undefined): { status: string; cancelAtPeriodEnd: boolean } | null {
  switch (s) {
    case "active":
    case "trialing":
      return { status: "active", cancelAtPeriodEnd: false };
    case "canceling": // 用户取消了，本期结束前仍然有效
      return { status: "active", cancelAtPeriodEnd: true };
    case "past_due":
      return { status: "past_due", cancelAtPeriodEnd: false };
    case "canceled":
    case "closed":
      return { status: "canceled", cancelAtPeriodEnd: false };
    case "expired":
      return { status: "expired", cancelAtPeriodEnd: false };
    default:
      return null;
  }
}

/** 只读 GraphQL 查询（主动查单、对账用）；有 errors 就抛出，不把半截结果当真 */
export async function waffoQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await waffoClient().graphql.query<T>({ query, variables });
  if (r.errors?.length || !r.data) throw new Error(`Waffo GraphQL: ${r.errors?.map((e) => e.message).join("; ") || "empty response"}`);
  return r.data;
}
