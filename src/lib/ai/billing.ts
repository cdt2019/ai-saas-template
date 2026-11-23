import "server-only";
import { captureError } from "@/lib/monitoring";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AiFeature } from "@/config/ai";
import { grantCredits, spendCredits } from "@/lib/credits";
import { newId } from "@/lib/ids";

/**
 * AI 调用的扣费流程（所有 AI 接口共用）：
 *   1. begin：先扣积分 + 写一条 pending 记录（余额不足直接拒绝，不调模型）
 *   2. 调模型
 *   3. succeed：记录结果；fail：记录错误并**自动退回积分**
 * 先扣后调，避免“并发请求把余额刷成负数”；失败退款保证用户不会白花钱。
 */
const clip = (s: string, n = 2000) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function beginGeneration(userId: string, feature: AiFeature, input: string) {
  const spent = await spendCredits({ userId, amount: feature.cost, reason: "spend", note: `ai:${feature.id}` });
  if (!spent.ok) return { ok: false as const, balance: spent.balance };

  const id = newId("gen");
  const db = await getDb();
  await db.insert(schema.generation).values({
    id,
    userId,
    feature: feature.id,
    model: feature.model,
    cost: feature.cost,
    status: "pending",
    input: clip(input, 500),
  });
  return { ok: true as const, id, balance: spent.balance, startedAt: Date.now() };
}

/** 只更新还在 pending 的记录：轮询和回调同时到达时，只有一方返回 true（用来保证完成邮件只发一次） */
const pending = (id: string) => and(eq(schema.generation.id, id), eq(schema.generation.status, "pending"));

/** 异步任务（视频）提交成功后，保存平台返回的任务信息 */
export async function attachJob(id: string, job: unknown) {
  const db = await getDb();
  await db.update(schema.generation).set({ job: JSON.stringify(job) }).where(eq(schema.generation.id, id));
}

export async function succeedGeneration(id: string, output: string, startedAt: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(schema.generation)
    .set({ status: "succeeded", output: clip(output), durationMs: Date.now() - startedAt })
    .where(pending(id))
    .returning({ id: schema.generation.id });
  return rows.length > 0;
}

export async function failGeneration(id: string, userId: string, cost: number, error: unknown, startedAt: number): Promise<boolean> {
  const db = await getDb();
  const message = error instanceof Error ? error.message : String(error);
  const rows = await db
    .update(schema.generation)
    .set({ status: "failed", error: clip(message, 500), durationMs: Date.now() - startedAt })
    .where(pending(id))
    .returning({ id: schema.generation.id });
  // 只有真的把 pending 改成 failed 的一方才退款：另一边已经成功了就不能再退。refId 再兜底，同一次失败只退一次
  if (rows.length === 0) return false;
  await grantCredits({ userId, amount: cost, reason: "refund", refId: `refund_${id}`, note: "ai failure" });
  console.error(`[ai] generation ${id} failed:`, message);
  void captureError(error, { level: "warning", tags: { area: "ai" } });
  return true;
}
