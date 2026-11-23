import "server-only";
import { siteConfig } from "@/config/site";
import { isLocalDev } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { stripeProvider } from "./stripe";
import { creemProvider } from "./creem";
import { waffoProvider } from "./waffo";

/**
 * 当前使用的支付通道：PAYMENT_PROVIDER = stripe | creem | waffo | mock
 * 未配置时：开发环境默认 mock（本地模拟支付，不需要任何密钥），生产环境必须显式配置。
 */
const mockProvider: PaymentProvider = {
  id: "mock",
  async createCheckout({ orderId, successUrl }) {
    const url = new URL("/mock-checkout", siteConfig.url);
    url.searchParams.set("order", orderId);
    url.searchParams.set("next", successUrl);
    return { url: url.toString(), providerRef: `mock_${orderId}` };
  },
};

export function getPaymentProvider(): PaymentProvider {
  const id = process.env.PAYMENT_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "mock");
  switch (id) {
    case "stripe":
      return stripeProvider;
    case "creem":
      return creemProvider;
    case "waffo":
      return waffoProvider;
    case "mock":
      if (process.env.NODE_ENV === "production") throw new Error("Mock payments are disabled in production");
      return mockProvider;
    default:
      throw new Error("PAYMENT_PROVIDER is not configured (stripe | creem | waffo)");
  }
}

/** 按订阅所属通道取对应实现（用户中心「管理订阅」用：订阅可能是切换通道之前开的） */
const providersById: Record<string, PaymentProvider> = { stripe: stripeProvider, creem: creemProvider, waffo: waffoProvider };
export const getProviderById = (id: string): PaymentProvider | undefined => providersById[id];

/** 这个通道的订阅能否在站内跳转到自助管理页 */
export const supportsPortal = (providerId: string) =>
  providerId === "stripe" || (providerId === "waffo" && !!process.env.WAFFO_STORE_ID);

/** 模拟支付只在本机开发可用（见 isLocalDev）：线上误开就是「谁都能给自己充值」 */
export const isMockPayments = () => isLocalDev() && (process.env.PAYMENT_PROVIDER ?? "mock") === "mock";
