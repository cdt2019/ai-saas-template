import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPlan } from "@/config/pricing";
import { siteConfig } from "@/config/site";
import { getSession } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { localePath } from "@/lib/paths";
import { hasLocale } from "@/i18n";
import { getPaymentProvider } from "@/lib/payments";
import { logPaymentEvent } from "@/lib/payments/events";

/**
 * 创建订单并跳转收银台：POST { planId, locale, code? } → { url }
 * code 是 /pricing?code=XXX 带来的优惠码：只做格式校验后交给支付平台预填，折扣多少、能不能用都由平台判断，
 * 我们这边不根据它改价格或积分（发多少积分只看方案）
 */
const PROMO_CODE = /^[A-Za-z0-9-]{3,32}$/;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { planId?: string; locale?: string; code?: unknown };
  const plan = body.planId ? getPlan(body.planId) : undefined;
  if (!plan) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  const locale = body.locale && hasLocale(body.locale) ? body.locale : siteConfig.defaultLocale;
  const promoCode = typeof body.code === "string" && PROMO_CODE.test(body.code) ? body.code.toUpperCase() : undefined;

  const provider = getPaymentProvider();
  const orderId = newId("ord");
  const db = await getDb();
  await db.insert(schema.order).values({
    id: orderId,
    userId: session.user.id,
    provider: provider.id,
    planId: plan.id,
    amount: plan.price,
    listAmount: plan.price,
    currency: plan.currency,
    promoCode,
  });
  // 支付流水的第一行：下了什么单、标价多少、带了什么码、平台收银台 id
  const event = { provider: provider.id, orderId, userId: session.user.id, planId: plan.id, currency: plan.currency, listAmount: plan.price, promoCode };

  try {
    const { url, providerRef, promoDropped } = await provider.createCheckout({
      orderId,
      plan,
      user: { id: session.user.id, email: session.user.email },
      successUrl: `${siteConfig.url}${localePath(locale, "/dashboard")}?paid=${orderId}`,
      cancelUrl: `${siteConfig.url}${localePath(locale, "/pricing")}`,
      promoCode,
    });
    await db.update(schema.order).set({ providerRef }).where(eq(schema.order.id, orderId));
    await logPaymentEvent({ ...event, kind: "checkout_created", outcome: "ok", providerOrderId: providerRef, message: `checkout opened${promoCode ? ` with code ${promoCode}` : ""}` });
    if (promoDropped) {
      await logPaymentEvent({ ...event, kind: "promo_dropped", outcome: "ignored", providerOrderId: providerRef, message: `${promoDropped} — checkout continued without the code` });
    }
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[checkout]", e);
    await logPaymentEvent({ ...event, kind: "checkout_created", outcome: "error", message: (e as Error).message });
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
