import "server-only";
import { purgeUnconfirmed } from "@/lib/newsletter";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { plans } from "@/config/pricing";
import { getDb, schema } from "@/db";
import { type FoundIssue, LEDGER_KINDS, resolveGone, saveIssues } from "@/lib/issues";
import type { JobContext } from "./types";

/**
 * 账务一致性检查（每天跑一次）：只读查询找问题，结果写进问题表（src/lib/issues.ts），后台「异常与对账」页处理。
 * - balance_mismatch：用户余额 ≠ 积分流水合计（积分只能经 credits.ts 改，对不上说明有人直接改了库或有 bug）
 * - paid_without_credits：一次性订单已付款，却没有发积分的流水
 * - over_refunded：一笔付款退的比收的多
 * - refund_stuck：退款申请批准后超过 48 小时还没等到平台的退款结果
 * - negative_balance：余额为负（退款 / 拒付扣回后被冻结），提示用，不一定是错误
 * 都是状态类问题：每次检查重算，这次没再发现的自动标为已解决，已解决的又出现会重新打开（管理员忽略的保持忽略）。
 * 新开的问题由调用方（定时任务）统一提醒
 */
const { user, creditTransaction, order, payment, refundRequest } = schema;
const ONE_TIME = plans.filter((p) => p.mode === "one_time").map((p) => p.id);

export async function runLedgerChecks(ctx: JobContext) {
  const db = await getDb();
  const started = new Date();
  const found: FoundIssue[] = [];

  // 1. 余额 ≠ 流水合计
  const ledger = sql<number>`coalesce(sum(${creditTransaction.delta}), 0)::int`;
  const mismatched = await db
    .select({ id: user.id, email: user.email, credits: user.credits, ledger })
    .from(user)
    .leftJoin(creditTransaction, eq(creditTransaction.userId, user.id))
    .groupBy(user.id)
    .having(sql`${user.credits} <> ${ledger}`)
    .limit(500);
  for (const u of mismatched) {
    found.push({ kind: "balance_mismatch", severity: "error", entityId: u.id, userId: u.id, detail: { email: u.email, balance: u.credits, ledger: u.ledger } });
  }
  ctx.log(`balance vs ledger: ${mismatched.length} mismatch(es)`);

  // 2. 已付款的一次性订单没有发积分的流水（"order" 是保留字，关联子查询手写带引号的表名）
  if (ONE_TIME.length) {
    const unpaid = await db
      .select({ id: order.id, userId: order.userId, planId: order.planId, amount: order.amount, currency: order.currency })
      .from(order)
      .where(
        and(
          inArray(order.status, ["paid", "refunded"]),
          inArray(order.planId, ONE_TIME),
          sql`not exists (select 1 from credit_transaction ct where ct.ref_id = 'order_' || ${sql.raw(`"order"."id"`)})`,
        ),
      )
      .limit(500);
    for (const o of unpaid) {
      found.push({ kind: "paid_without_credits", severity: "error", entityId: o.id, userId: o.userId, detail: { plan: o.planId, amount: o.amount, currency: o.currency } });
    }
    ctx.log(`paid orders without credits: ${unpaid.length}`);
  }

  // 3. 退的比收的多
  const over = await db
    .select({ id: payment.id, userId: payment.userId, amount: payment.amount, refunded: payment.refundedAmount, currency: payment.currency, providerPaymentId: payment.providerPaymentId })
    .from(payment)
    .where(sql`${payment.refundedAmount} > ${payment.amount}`)
    .limit(500);
  for (const p of over) {
    found.push({ kind: "over_refunded", severity: "error", entityId: p.id, userId: p.userId, detail: { amount: p.amount, refunded: p.refunded, currency: p.currency, payment: p.providerPaymentId } });
  }
  ctx.log(`over-refunded payments: ${over.length}`);

  // 4. 批准后 48 小时还在处理中的退款
  const stuck = await db
    .select({ id: refundRequest.id, userId: refundRequest.userId, amount: refundRequest.amount, reviewedAt: refundRequest.reviewedAt })
    .from(refundRequest)
    .where(and(eq(refundRequest.status, "processing"), lt(refundRequest.reviewedAt, new Date(Date.now() - 48 * 3600_000))))
    .limit(500);
  for (const r of stuck) {
    found.push({ kind: "refund_stuck", severity: "warning", entityId: r.id, userId: r.userId, detail: { amount: r.amount, approvedAt: r.reviewedAt?.toISOString() } });
  }
  ctx.log(`refunds stuck in processing: ${stuck.length}`);

  // 5. 余额为负
  const negative = await db.select({ id: user.id, email: user.email, credits: user.credits }).from(user).where(lt(user.credits, 0)).limit(500);
  for (const u of negative) {
    found.push({ kind: "negative_balance", severity: "warning", entityId: u.id, userId: u.id, detail: { email: u.email, balance: u.credits } });
  }
  ctx.log(`negative balances: ${negative.length}`);

  const opened = await saveIssues(found, { reopen: true });
  const resolved = await resolveGone(LEDGER_KINDS, started);
  ctx.log(`ledger issues: ${opened.length} new, ${resolved.length} auto-resolved`);
  return {
    checked: { balanceMismatch: mismatched.length, paidWithoutCredits: found.filter((f) => f.kind === "paid_without_credits").length, overRefunded: over.length, refundStuck: stuck.length, negativeBalance: negative.length },
    opened,
    autoResolved: resolved.length,
  };
}

/** 清理：过期的限流记录、验证码、半年前已读的通知、90 天前的任务运行记录 */
export async function runCleanup(ctx: JobContext) {
  const db = await getDb();
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  const [rate, verification, notices, runs, newsletter] = await Promise.all([
    db.delete(schema.rateLimit).where(lt(schema.rateLimit.windowStart, ago(1))).returning({ key: schema.rateLimit.key }),
    db.delete(schema.verification).where(lt(schema.verification.expiresAt, ago(1))).returning({ id: schema.verification.id }),
    db
      .delete(schema.notification)
      .where(and(lt(schema.notification.createdAt, ago(180)), isNotNull(schema.notification.readAt)))
      .returning({ id: schema.notification.id }),
    db.delete(schema.jobRun).where(lt(schema.jobRun.startedAt, ago(90))).returning({ id: schema.jobRun.id }),
    purgeUnconfirmed(),
  ]);
  const summary = { rateLimit: rate.length, verification: verification.length, notifications: notices.length, jobRuns: runs.length, unconfirmedSubscribers: newsletter };
  ctx.log(`deleted ${JSON.stringify(summary)}`);
  return summary;
}
