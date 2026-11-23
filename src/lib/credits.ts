import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "./ids";
import { notifyIfLow } from "./notify";

/**
 * 积分：所有增减都走这里，保证 user.credits 与流水表一致。
 * - grantCredits：增加，带幂等键 refId（同一订单 / webhook 事件重复到达只记一次）
 * - spendCredits：扣减，余额不足返回 false，并发安全（条件更新）
 */
export async function grantCredits(opts: {
  userId: string;
  amount: number;
  reason: string;
  refId?: string;
  note?: string;
}): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.creditTransaction)
      .values({
        id: newId("ctx"),
        userId: opts.userId,
        delta: opts.amount,
        reason: opts.reason,
        refId: opts.refId,
        note: opts.note,
      })
      .onConflictDoNothing({ target: schema.creditTransaction.refId })
      .returning({ id: schema.creditTransaction.id });
    if (inserted.length === 0) return false; // 已处理过
    await tx
      .update(schema.user)
      .set({ credits: sql`${schema.user.credits} + ${opts.amount}` })
      .where(eq(schema.user.id, opts.userId));
    return true;
  });
}

export async function spendCredits(opts: {
  userId: string;
  amount: number;
  reason?: string;
  note?: string;
}): Promise<{ ok: boolean; balance: number }> {
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.user)
      .set({ credits: sql`${schema.user.credits} - ${opts.amount}` })
      .where(and(eq(schema.user.id, opts.userId), gte(schema.user.credits, opts.amount)))
      .returning({ credits: schema.user.credits });
    if (updated.length === 0) {
      const [u] = await tx
        .select({ credits: schema.user.credits })
        .from(schema.user)
        .where(eq(schema.user.id, opts.userId));
      return { ok: false, balance: u?.credits ?? 0 };
    }
    await tx.insert(schema.creditTransaction).values({
      id: newId("ctx"),
      userId: opts.userId,
      delta: -opts.amount,
      reason: opts.reason ?? "spend",
      note: opts.note,
    });
    return { ok: true, balance: updated[0].credits };
  });
  // 这次消耗让余额跌破提醒线：通知一次（去充值）
  if (result.ok) await notifyIfLow(opts.userId, result.balance + opts.amount, result.balance);
  return result;
}

/**
 * 退款 / 拒付扣回积分：和 spendCredits 不同，余额不够也照扣（可以变成负数）。
 * 负余额用不了任何付费功能，相当于冻结，直到再次充值补上。refId 保证同一笔退款只扣一次。
 */
export async function deductCredits(opts: {
  userId: string;
  amount: number;
  reason: string;
  refId: string;
  note?: string;
}): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.creditTransaction)
      .values({
        id: newId("ctx"),
        userId: opts.userId,
        delta: -opts.amount,
        reason: opts.reason,
        refId: opts.refId,
        note: opts.note,
      })
      .onConflictDoNothing({ target: schema.creditTransaction.refId })
      .returning({ id: schema.creditTransaction.id });
    if (inserted.length === 0) return false; // 已处理过
    await tx
      .update(schema.user)
      .set({ credits: sql`${schema.user.credits} - ${opts.amount}` })
      .where(eq(schema.user.id, opts.userId));
    return true;
  });
}

export async function getCreditHistory(userId: string, limit = 20) {
  const db = await getDb();
  return db
    .select()
    .from(schema.creditTransaction)
    .where(eq(schema.creditTransaction.userId, userId))
    .orderBy(desc(schema.creditTransaction.createdAt))
    .limit(limit);
}
