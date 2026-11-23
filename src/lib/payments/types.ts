import type { Plan } from "@/config/pricing";

/**
 * 支付通道统一接口：新增通道（如 Paddle、PayPal）时实现这个接口并在 index.ts 注册即可
 */
export type CheckoutInput = {
  orderId: string;
  plan: Plan;
  user: { id: string; email: string };
  successUrl: string;
  cancelUrl: string;
  /** 优惠码（来自 /pricing?code=XXX，已校验格式）：预填到收银台；平台不认就当没有，照常下单 */
  promoCode?: string;
};

export interface PaymentProvider {
  id: "stripe" | "creem" | "waffo" | "mock";
  /** 创建收银台，返回跳转地址和平台侧会话 id；带的优惠码被平台拒了就在 promoDropped 里说明原因（记进支付流水） */
  createCheckout(input: CheckoutInput): Promise<{ url: string; providerRef: string; promoDropped?: string }>;
  /** 订阅自助管理页（改卡、取消），不支持则返回 null */
  getPortalUrl?(customerId: string, returnUrl: string): Promise<string | null>;
}
