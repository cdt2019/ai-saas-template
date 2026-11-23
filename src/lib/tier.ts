import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPlan } from "@/config/pricing";

/**
 * 账户等级（只读，用于展示）：
 *   subscription：有生效中的订阅 → 显示订阅方案（Pro）
 *   pack：没有订阅，但买过积分包且没退款 → 显示买过的最高档积分包（Starter / Max）
 *   free：都没有
 * 只决定界面上叫什么，积分、权限都不看它
 */
export type AccountTier =
  | { kind: "subscription"; planId: string; subscription: typeof schema.subscription.$inferSelect }
  | { kind: "pack"; planId: string; purchasedAt: Date }
  | { kind: "free"; planId: null };

type Sub = typeof schema.subscription.$inferSelect;

/** sub：这个用户最新的一份订阅；paid：已付款的订单（新的在前） */
function pickTier(sub: Sub | undefined, paid: { planId: string; createdAt: Date }[]): AccountTier {
  if (sub && sub.status === "active") return { kind: "subscription", planId: sub.planId, subscription: sub };

  // 积分包：取标价最高的那一档；同一档买过多次，显示最近一次的购买时间
  let best: { planId: string; price: number; purchasedAt: Date } | null = null;
  for (const o of paid) {
    const plan = getPlan(o.planId);
    if (plan?.mode !== "one_time") continue;
    if (!best || plan.price > best.price) best = { planId: o.planId, price: plan.price, purchasedAt: o.createdAt };
  }
  return best ? { kind: "pack", planId: best.planId, purchasedAt: best.purchasedAt } : { kind: "free", planId: null };
}

export async function getAccountTier(userId: string): Promise<AccountTier> {
  const db = await getDb();
  const [[sub], paid] = await Promise.all([
    db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.userId, userId))
      .orderBy(desc(schema.subscription.createdAt))
      .limit(1),
    db
      .select({ planId: schema.order.planId, createdAt: schema.order.createdAt })
      .from(schema.order)
      .where(and(eq(schema.order.userId, userId), eq(schema.order.status, "paid")))
      .orderBy(desc(schema.order.createdAt))
      .limit(50),
  ]);
  return pickTier(sub, paid);
}

/** 一批用户的等级（后台列表一页最多 100 人，两次查询算完，不按人逐个查） */
export async function getAccountTiers(userIds: string[]): Promise<Map<string, AccountTier>> {
  const result = new Map<string, AccountTier>();
  if (userIds.length === 0) return result;
  const db = await getDb();
  const [subs, paid] = await Promise.all([
    db.select().from(schema.subscription).where(inArray(schema.subscription.userId, userIds)).orderBy(desc(schema.subscription.createdAt)),
    db
      .select({ userId: schema.order.userId, planId: schema.order.planId, createdAt: schema.order.createdAt })
      .from(schema.order)
      .where(and(inArray(schema.order.userId, userIds), eq(schema.order.status, "paid")))
      .orderBy(desc(schema.order.createdAt)),
  ]);
  for (const id of userIds) {
    result.set(
      id,
      pickTier(
        subs.find((s) => s.userId === id),
        paid.filter((o) => o.userId === id),
      ),
    );
  }
  return result;
}
