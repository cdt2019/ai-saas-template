import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPlan } from "@/config/pricing";
import { getSession } from "@/lib/auth";
import { isMockPayments } from "@/lib/payments";
import { logPaymentEvent } from "@/lib/payments/events";
import { fulfillOrder, grantSubscriptionCredits, upsertSubscription } from "@/lib/payments/fulfill";

/** 本地模拟支付成功（仅开发环境且 PAYMENT_PROVIDER=mock 时可用），走和真实 webhook 相同的发货逻辑 */
export async function POST(request: Request) {
  if (!isMockPayments()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: string };
  const db = await getDb();
  const [ord] = orderId ? await db.select().from(schema.order).where(eq(schema.order.id, orderId)) : [];
  if (!ord || ord.userId !== session.user.id) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { credits } = await fulfillOrder(ord.id, "mock", { providerPaymentId: `mock_${ord.id}` });
  const plan = getPlan(ord.planId);
  if (plan?.mode === "one_time") {
    await logPaymentEvent({ provider: "mock", kind: "paid", outcome: "ok", orderId: ord.id, providerPaymentId: `mock_${ord.id}`, chargedAmount: ord.amount, creditsDelta: credits, message: `mock payment, +${credits} credits` });
  }
  if (plan?.mode === "subscription") {
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + (plan.interval === "year" ? 12 : 1));
    await upsertSubscription({
      userId: ord.userId,
      provider: "mock",
      providerSubId: `mock_${ord.id}`,
      planId: plan.id,
      status: "active",
      currentPeriodEnd: periodEnd,
    });
    const r = await grantSubscriptionCredits({
      userId: ord.userId,
      planId: plan.id,
      refId: `mock_${ord.id}`,
      orderId: ord.id,
      provider: "mock",
      providerSubId: `mock_${ord.id}`,
      paid: { providerPaymentId: `mock_${ord.id}` },
    });
    await logPaymentEvent({ provider: "mock", kind: "period_paid", outcome: "ok", orderId: ord.id, providerPaymentId: `mock_${ord.id}`, providerSubId: `mock_${ord.id}`, creditsDelta: r.credits, message: `mock subscription payment, +${r.credits} credits` });
  }
  return NextResponse.json({ ok: true });
}
