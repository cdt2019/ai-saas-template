import "server-only";
import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPlan } from "@/config/pricing";
import { refundRules } from "@/config/refunds";
import { computeRefund, refundBlock } from "@/lib/credit-math";
import { newId } from "@/lib/ids";
import { notify, notifyAdmins } from "@/lib/notify";
import { logPaymentEvent, type Outcome } from "./events";
import { clawbackGrant, refundHoldRef, restoreClawback } from "./fulfill";
import { cancelStripeRenewal, refundStripePayment } from "./stripe";
import { cancelWaffoRenewal, createWaffoRefundTicket } from "./waffo";

/**
 * 网页自助退款：系统按未用积分算金额 → 用户提交申请 → 管理员在 /admin 审核 → 带着确切的付款 id 去平台退款。
 * - 提交申请时就冻结（扣回）这笔付款里可退的积分：申请时看到的金额就是最终金额，审核期间这部分积分不能再用；
 *   用户撤销、管理员拒绝时立即解冻
 * - 批准后调平台：Stripe 直接退款；Waffo 用商户接口建退款工单（自动通过）；
 *   Creem 没有退款接口，管理员到 Creem 后台按显示的金额退；mock 直接视为到账
 * - 平台退款到账的回调走 clawbackGrant：冻结的积分算作扣回，多退少补，并把申请标记为 refunded
 * - 平台那边没退成（工单被拒、接口报错）：撤回冻结，积分还给用户
 * 规则见 src/config/refunds.ts。
 */

type Payment = typeof schema.payment.$inferSelect;
type Request = typeof schema.refundRequest.$inferSelect;

export type RefundBlock = "requested" | "limit" | "window" | "not_current" | "used" | "nothing" | "frozen";
export type RefundQuote =
  | { ok: true; amount: number; credits: number; currency: string }
  | { ok: false; reason: RefundBlock };

/** 这笔付款现在能退多少：这里查数据，计算规则见 src/lib/credit-math.ts */
async function compute(p: Payment) {
  const db = await getDb();
  const { creditTransaction: tx, user } = schema;
  const [grant] = await db.select().from(tx).where(eq(tx.refId, p.grantRefId));
  if (!grant || grant.delta <= 0) return null;
  const [[{ net }], [{ spent }], [me]] = await Promise.all([
    db.select({ net: sql<number>`coalesce(sum(${tx.delta}), 0)` }).from(tx).where(eq(tx.note, `grant:${p.grantRefId}`)),
    db
      .select({ spent: sql<number>`coalesce(-sum(${tx.delta}), 0)` })
      .from(tx)
      .where(and(eq(tx.userId, p.userId), inArray(tx.reason, ["spend", "refund"]), gte(tx.createdAt, grant.createdAt))),
    db.select({ credits: user.credits }).from(user).where(eq(user.id, p.userId)),
  ]);
  const balance = me?.credits ?? 0;
  return { ...computeRefund({ paid: p.amount, granted: grant.delta, linkedNet: Number(net), spentSinceGrant: Number(spent), balance }), balance };
}

/** 按规则判断这笔付款能不能自助申请退款，能的话给出金额和要扣回的积分 */
export async function refundQuote(p: Payment): Promise<RefundQuote> {
  const db = await getDb();
  const { refundRequest, payment, subscription } = schema;
  const [[existing], [{ n }]] = await Promise.all([
    // 撤销过的申请不算：可以重新申请
    db
      .select({ id: refundRequest.id })
      .from(refundRequest)
      .where(and(eq(refundRequest.paymentId, p.id), ne(refundRequest.status, "canceled"))),
    db
      .select({ n: count() })
      .from(refundRequest)
      .where(and(eq(refundRequest.userId, p.userId), inArray(refundRequest.status, ["pending", "processing", "refunded"]))),
  ]);
  if (existing) return { ok: false, reason: "requested" };
  if (n >= refundRules.perAccount) return { ok: false, reason: "limit" };

  if (getPlan(p.planId)?.mode === "subscription") {
    // 订阅只退当期：这份订阅最新的一笔付款，并且订阅还有效
    const [[latest], [sub]] = await Promise.all([
      db
        .select({ id: payment.id })
        .from(payment)
        .where(eq(payment.providerSubId, p.providerSubId ?? ""))
        .orderBy(desc(payment.createdAt))
        .limit(1),
      db.select({ status: subscription.status }).from(subscription).where(eq(subscription.providerSubId, p.providerSubId ?? "")),
    ]);
    if (latest?.id !== p.id || sub?.status !== "active") return { ok: false, reason: "not_current" };
  } else if (Date.now() - p.createdAt.getTime() > refundRules.packDays * 86_400_000) {
    return { ok: false, reason: "window" };
  }

  const r = await compute(p);
  if (!r) return { ok: false, reason: "nothing" };
  const blocked = refundBlock(r, r.balance, refundRules);
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true, amount: r.amount, credits: r.credits, currency: p.currency };
}

/** 用户的付款记录（最近 20 笔），每笔带退款申请状态，没申请过的带系统算好的报价 */
export async function listRefundables(userId: string) {
  const db = await getDb();
  const { payment, refundRequest } = schema;
  const [payments, requests] = await Promise.all([
    db.select().from(payment).where(eq(payment.userId, userId)).orderBy(desc(payment.createdAt)).limit(20),
    db.select().from(refundRequest).where(eq(refundRequest.userId, userId)),
  ]);
  return Promise.all(
    payments.map(async (p) => {
      const found = requests.find((r) => r.paymentId === p.id);
      // 撤销过的申请当作没申请过：重新给出报价，可以再申请
      const req = found?.status === "canceled" ? undefined : found;
      return {
        payment: p,
        request: req ? { id: req.id, status: req.status, amount: req.amount, credits: req.credits } : null,
        quote: req ? null : await refundQuote(p),
      };
    }),
  );
}

/** 用户提交退款申请：金额只由系统计算，请求里只带付款 id 和原因 */
export async function createRefundRequest(userId: string, paymentId: string, reason: string) {
  const db = await getDb();
  const [p] = await db
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.id, paymentId), eq(schema.payment.userId, userId)));
  if (!p) return { error: "not_found" as const };
  const quote = await refundQuote(p);
  if (!quote.ok) return { error: quote.reason };
  // 撤销过的申请（每笔付款只有一行）：改回待审核重新用；否则新建
  const [canceled] = await db
    .select({ id: schema.refundRequest.id })
    .from(schema.refundRequest)
    .where(and(eq(schema.refundRequest.paymentId, p.id), eq(schema.refundRequest.status, "canceled")));
  const values = { reason: reason.slice(0, 500), amount: quote.amount, credits: quote.credits };
  const id = canceled?.id ?? newId("rfd");
  const saved = canceled
    ? await db
        .update(schema.refundRequest)
        .set({ ...values, status: "pending", adminNote: null, reviewedBy: null, reviewedAt: null, providerRefundId: null, createdAt: new Date() })
        .where(and(eq(schema.refundRequest.id, id), eq(schema.refundRequest.status, "canceled")))
        .returning({ id: schema.refundRequest.id })
    : await db
        .insert(schema.refundRequest)
        .values({ id, userId, paymentId, ...values })
        .onConflictDoNothing()
        .returning({ id: schema.refundRequest.id });
  if (saved.length === 0) return { error: "requested" as const };
  // 提交即冻结：这部分积分从余额里扣出来，审核期间不能再用；金额就此定下，批准时不再重算
  const held = await holdCredits(id, p, quote.amount);
  if (held !== quote.credits) await db.update(schema.refundRequest).set({ credits: held }).where(eq(schema.refundRequest.id, id));
  await logRefund("refund_requested", "ok", p, {
    refundedAmount: quote.amount,
    message: `refund requested: ${quote.amount} (${quote.credits} credits), reason: ${reason.slice(0, 200)}`,
  });
  await notify({ userId, type: "refund_requested", params: { amount: quote.amount, currency: quote.currency }, link: "/settings?tab=billing", refId: id });
  await notifyAdmins({
    type: "admin_refund_request",
    params: { email: p.userEmail ?? "", amount: quote.amount, currency: quote.currency },
    link: "/admin",
    refId: id,
  });
  return { id, amount: quote.amount, credits: quote.credits, currency: quote.currency };
}

/** 网页退款流程的支付流水（申请、批准、拒绝、撤回） */
function logRefund(kind: string, outcome: Outcome, p: Payment, extra: { message: string; refundedAmount?: number; creditsDelta?: number; providerRefundId?: string | null }) {
  return logPaymentEvent({
    provider: p.provider,
    kind,
    outcome,
    userId: p.userId,
    orderId: p.orderId,
    planId: p.planId,
    paymentId: p.id,
    providerPaymentId: p.providerPaymentId,
    providerSubId: p.providerSubId,
    currency: p.currency,
    chargedAmount: p.amount,
    ...extra,
  });
}

async function loadRequest(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ r: schema.refundRequest, p: schema.payment })
    .from(schema.refundRequest)
    .innerJoin(schema.payment, eq(schema.refundRequest.paymentId, schema.payment.id))
    .where(eq(schema.refundRequest.id, id));
  return row ?? null;
}

/**
 * 冻结这笔申请要退的积分（扣回流水的 refId 是 refund_hold_<申请号>），已经冻结过就不再扣。
 * 老版本留下的申请（提交时还没冻结）在批准时补冻结
 */
async function holdCredits(id: string, p: Payment, amount: number) {
  const db = await getDb();
  const hold = refundHoldRef(id);
  const [existing] = await db.select({ delta: schema.creditTransaction.delta }).from(schema.creditTransaction).where(eq(schema.creditTransaction.refId, hold));
  if (existing) return -existing.delta;
  return clawbackGrant({ grantRefId: p.grantRefId, clawbackRefId: hold, ratio: amount / p.amount, settle: false });
}

/** 解冻：把冻结的积分还回去，并归档冻结记录（空出 refId，之后可以重新冻结） */
async function unhold(id: string) {
  const hold = refundHoldRef(id);
  await restoreClawback({ clawbackRefId: hold, restoreRefId: `${hold}_release` });
  await archiveReleasedHold(id);
}

/** 把申请从 from 状态改成新状态；返回 false 说明已经被别人处理过（防止两个管理员同时点批准退两次钱） */
async function transition(id: string, from: string, patch: Partial<Request>) {
  const db = await getDb();
  const done = await db
    .update(schema.refundRequest)
    .set(patch)
    .where(and(eq(schema.refundRequest.id, id), eq(schema.refundRequest.status, from)))
    .returning({ id: schema.refundRequest.id });
  return done.length > 0;
}

/** 到平台执行退款，返回平台侧的退款 / 工单号；订阅同时关掉平台的自动续费 */
async function execute(p: Payment, r: Request, amount: number): Promise<{ providerRefundId: string | null; note?: string }> {
  const isSub = getPlan(p.planId)?.mode === "subscription" && !!p.providerSubId;
  let providerRefundId: string | null = null;
  switch (p.provider) {
    case "stripe":
      providerRefundId = await refundStripePayment(p, amount, r.id);
      break;
    case "waffo":
      providerRefundId = await createWaffoRefundTicket(p, amount, r);
      break;
    case "mock":
      // 本地模拟：直接当作平台退款到账
      providerRefundId = `mock_refund_${r.id}`;
      await clawbackGrant({ grantRefId: p.grantRefId, clawbackRefId: providerRefundId, ratio: amount / p.amount });
      break;
    // creem：没有退款接口，管理员到 Creem 后台手动退，回调到了再结单
  }
  if (!isSub || p.provider === "mock" || p.provider === "creem") return { providerRefundId };
  try {
    if (p.provider === "stripe") await cancelStripeRenewal(p.providerSubId!);
    if (p.provider === "waffo") await cancelWaffoRenewal(p.providerSubId!);
    return { providerRefundId };
  } catch (e) {
    // 退款已经发出去了，取消续费失败不回滚，留言让管理员到平台后台手动取消
    console.error("[refund] cancel renewal failed", p.providerSubId, e);
    return { providerRefundId, note: `cancel renewal failed: ${(e as Error).message}` };
  }
}

/**
 * 管理员批准：按申请时定下的金额（积分在提交时已冻结）到平台退款。
 * 平台调用失败就解冻，申请标记为 failed；failed 的申请可以再批准一次（修好平台配置之后）。
 * 解冻期间用户可能用掉了积分，所以重试时按现在的未用积分重算，金额只会变少，余额不会被扣成负数；一点都不剩就不退。
 */
export async function approveRefundRequest(id: string, adminEmail: string) {
  const row = await loadRequest(id);
  if (!row) return { error: "not_found" as const };
  const { r, p } = row;
  if (r.status !== "pending" && r.status !== "failed") return { error: "not_pending" as const };
  let amount = r.amount;
  if (r.status === "failed") {
    const now = await compute(p);
    amount = Math.min(r.amount, now?.amount ?? 0);
    if (amount < refundRules.minAmount) return { error: "nothing_left" as const, message: "the released credits have been used, so there is nothing left to refund" };
  }

  if (!(await transition(id, r.status, { status: "processing", reviewedBy: adminEmail, reviewedAt: new Date() }))) {
    return { error: "not_pending" as const };
  }
  if (r.status === "failed") await archiveReleasedHold(id);
  const credits = await holdCredits(id, p, amount);
  const db = await getDb();
  await db.update(schema.refundRequest).set({ credits, amount }).where(eq(schema.refundRequest.id, id));

  // 只有平台调用本身失败才撤回冻结；平台已经受理之后，后面记账出错也不能把积分还回去（钱已经在退了）
  let result: Awaited<ReturnType<typeof execute>>;
  try {
    result = await execute(p, r, amount);
  } catch (e) {
    const message = (e as Error).message;
    console.error("[refund] provider refund failed", id, e);
    await logRefund("refund_approved", "error", p, { refundedAmount: amount, message: `approved by ${adminEmail}, but the provider call failed: ${message}` });
    await releaseHold(id, `provider error: ${message}`);
    return { error: "provider_failed" as const, message };
  }
  await db
    .update(schema.refundRequest)
    .set({ providerRefundId: result.providerRefundId ?? null, ...(result.note ? { adminNote: result.note } : {}) })
    .where(eq(schema.refundRequest.id, id));
  await logRefund("refund_approved", "ok", p, {
    refundedAmount: amount,
    creditsDelta: -credits,
    providerRefundId: result.providerRefundId,
    message: `approved by ${adminEmail}: refund ${amount}, ${credits} credits held${result.providerRefundId ? `, provider ref ${result.providerRefundId}` : " — refund it in the provider dashboard"}${result.note ? ` (${result.note})` : ""}`,
  });
  await notify({
    userId: r.userId,
    type: "refund_approved",
    params: { amount, currency: p.currency, credits },
    link: "/settings?tab=billing",
    refId: `${id}:${Date.now()}`,
  });
  return { ok: true as const, amount, credits, provider: p.provider, providerRefundId: result.providerRefundId };
}

/** 撤回冻结：平台那边没退成（Waffo 工单被拒、退款失败），把冻结的积分还给用户，申请标记为 failed */
async function releaseHold(id: string, note: string) {
  if (!(await transition(id, "processing", { status: "failed", adminNote: note }))) return false;
  await unhold(id);
  const row = await loadRequest(id);
  if (row) {
    await logRefund("refund_released", "ok", row.p, { creditsDelta: row.r.credits, message: `held ${row.r.credits} credits returned: ${note}` });
    await notify({ userId: row.r.userId, type: "refund_failed", params: { credits: row.r.credits }, link: "/settings?tab=billing" });
  }
  return true;
}

/**
 * 已经还回去的冻结：把「冻结」和「还回」两条流水改名归档，空出冻结用的 refId，重试批准时才能再冻结一次。
 * 只在还回记录存在时动手，不会碰到还在生效的冻结
 */
async function archiveReleasedHold(id: string) {
  const db = await getDb();
  const hold = refundHoldRef(id);
  const [released] = await db
    .select({ id: schema.creditTransaction.id })
    .from(schema.creditTransaction)
    .where(eq(schema.creditTransaction.refId, `${hold}_release`));
  if (!released) return;
  const archived = `${hold}_released_${Date.now()}`;
  await db.update(schema.creditTransaction).set({ refId: archived }).where(eq(schema.creditTransaction.refId, hold));
  await db.update(schema.creditTransaction).set({ refId: `${archived}_restore` }).where(eq(schema.creditTransaction.refId, `${hold}_release`));
}

/** 平台回调说这笔付款的退款失败：撤回它上面处理中的申请（冻结的积分还给用户） */
export async function releaseRefundForPayment(providerPaymentId: string, note: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.refundRequest.id })
    .from(schema.refundRequest)
    .innerJoin(schema.payment, eq(schema.refundRequest.paymentId, schema.payment.id))
    .where(and(eq(schema.payment.providerPaymentId, providerPaymentId), eq(schema.refundRequest.status, "processing")));
  return row ? releaseHold(row.id, note) : false;
}

export async function releaseRefundRequest(id: string, by: string, note?: string) {
  return (await releaseHold(id, `released by ${by}${note ? `: ${note}` : ""}`)) ? { ok: true as const } : { error: "not_processing" as const };
}

/** 用户撤销自己还在审核中的申请：立即解冻积分；之后这笔付款还能重新申请 */
export async function cancelRefundRequest(userId: string, id: string) {
  const row = await loadRequest(id);
  if (!row || row.r.userId !== userId) return { error: "not_found" as const };
  if (!(await transition(id, "pending", { status: "canceled" }))) return { error: "not_pending" as const };
  await unhold(id);
  await logRefund("refund_canceled", "ok", row.p, { creditsDelta: row.r.credits, message: `canceled by the user, ${row.r.credits} held credits returned` });
  return { ok: true as const };
}

export async function rejectRefundRequest(id: string, adminEmail: string, note?: string) {
  const ok = await transition(id, "pending", { status: "rejected", reviewedBy: adminEmail, reviewedAt: new Date(), adminNote: note ?? null });
  if (!ok) return { error: "not_pending" as const };
  await unhold(id);
  const row = await loadRequest(id);
  if (row) {
    await logRefund("refund_rejected", "ok", row.p, { message: `rejected by ${adminEmail}${note ? `: ${note}` : ""}` });
    await notify({ userId: row.r.userId, type: "refund_rejected", params: { note: note ?? null }, link: "/settings?tab=billing", refId: id });
  }
  return { ok: true as const };
}
