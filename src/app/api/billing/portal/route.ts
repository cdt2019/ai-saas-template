import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { siteConfig } from "@/config/site";
import { getSession } from "@/lib/auth";
import { getProviderById } from "@/lib/payments";

/**
 * 订阅自助管理（改卡、取消）：Stripe Billing Portal、Waffo 客户门户（需配置 WAFFO_STORE_ID）。
 * Creem 用户可在支付邮件里的链接管理。
 * 返回的链接可能带登录令牌，不缓存、不记日志，前端拿到后立刻跳转。
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = await getDb();
  const [sub] = await db
    .select()
    .from(schema.subscription)
    .where(
      and(
        eq(schema.subscription.userId, session.user.id),
        inArray(schema.subscription.provider, ["stripe", "waffo"]),
        isNotNull(schema.subscription.providerCustomerId),
      ),
    )
    .orderBy(desc(schema.subscription.createdAt))
    .limit(1);
  if (!sub?.providerCustomerId) return NextResponse.json({ error: "no_subscription" }, { status: 404 });

  const url = await getProviderById(sub.provider)?.getPortalUrl?.(sub.providerCustomerId, `${siteConfig.url}/dashboard`);
  if (!url) return NextResponse.json({ error: "portal_unavailable" }, { status: 404 });
  return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
