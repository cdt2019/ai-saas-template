import "server-only";
import { computeClawback, refundStatus } from "@/lib/credit-math";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPlan } from "@/config/pricing";
import { deductCredits, grantCredits } from "@/lib/credits";
import { newId } from "@/lib/ids";
import { notify } from "@/lib/notify";

/**
 * 支付成功后的发货逻辑（所有通道共用，全部幂等：webhook 重复推送不会重复加积分）
 */

export async function getOrder(orderId: string) {
  const db = await getDb();
  const [ord] = await db.select().from(schema.order).where(eq(schema.order.id, orderId));
  return ord ?? null;
}

/**
 * 回调里这笔付款的平台侧信息，记进 payment 表供退款使用。
 * amount 是实付金额（分）；回调里没有就用订单 / 方案的价格。
 * listAmount 是这一期的标价（折扣前，分），订阅用它认出试用期；拿不到就不判断
 */
export type PaidWith = { providerPaymentId: string; amount?: number | null; currency?: string | null; listAmount?: number | null };

async function recordPayment(row: {
  userId: string;
  provider: string;
  grantRefId: string;
  planId: string;
  providerSubId?: string | null;
  paid: PaidWith;
  fallback: { amount: number; currency: string; listAmount?: number | null };
  orderId?: string | null;
  promoCode?: string | null;
  trial?: boolean;
  creditsGranted: number;
}) {
  const db = await getDb();
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, row.userId));
  const amount = row.paid.amount ?? row.fallback.amount;
  const listAmount = row.paid.listAmount ?? row.fallback.listAmount ?? null;
  const [inserted] = await db
    .insert(schema.payment)
    .values({
      id: newId("pay"),
      userId: row.userId,
      provider: row.provider,
      providerPaymentId: row.paid.providerPaymentId,
      grantRefId: row.grantRefId,
      planId: row.planId,
      providerSubId: row.providerSubId ?? null,
      amount,
      currency: (row.paid.currency ?? row.fallback.currency).toLowerCase(),
      orderId: row.orderId ?? null,
      userEmail: u?.email ?? null,
      listAmount,
      discountAmount: listAmount != null && listAmount > amount ? listAmount - amount : 0,
      promoCode: row.promoCode ?? null,
      trial: row.trial ?? false,
      creditsGranted: row.creditsGranted,
    })
    .onConflictDoNothing()
    .returning({ id: schema.payment.id });
  return inserted?.id ?? null;
}

/**
 * 订单支付成功：标记订单已付；一次性方案发放积分，并记下这笔付款。
 * provider：发来回调的通道，必须和下单时的通道一致（防止拿 A 通道的回调去确认 B 通道的订单）。
 * 发多少积分只看我们数据库里订单的 planId，不看回调里带的任何金额或方案字段。
 * 返回这次实际发了多少积分（重推的回调是 0），给支付流水用
 */
export async function fulfillOrder(orderId: string, provider: string, paid?: PaidWith) {
  const db = await getDb();
  const ord = await getOrder(orderId);
  if (!ord) throw new Error(`Order not found: ${orderId}`);
  if (ord.provider !== provider) throw new Error(`Order ${orderId} belongs to ${ord.provider}, not ${provider}`);
  const plan = getPlan(ord.planId);
  if (!plan) throw new Error(`Unknown plan: ${ord.planId}`);

  // 只从未付款改成已付：退款后平台重推的付款通知不能把 refunded 改回 paid
  if (ord.status === "pending" || ord.status === "failed") {
    await db.update(schema.order).set({ status: "paid" }).where(eq(schema.order.id, orderId));
  }
  // 订单金额改成实付（下单时记的是方案标价）：用了优惠码时，订单列表和后台收入才对得上
  if (paid?.amount != null && paid.amount !== ord.amount) {
    await db.update(schema.order).set({ amount: paid.amount }).where(eq(schema.order.id, orderId));
  }
  let credits = 0;
  if (plan.mode === "one_time") {
    const granted = await grantCredits({ userId: ord.userId, amount: plan.credits, reason: "purchase", refId: `order_${orderId}` });
    credits = granted ? plan.credits : 0;
    if (paid) {
      await recordPayment({
        userId: ord.userId,
        provider,
        grantRefId: `order_${orderId}`,
        planId: plan.id,
        paid,
        fallback: { amount: ord.amount, currency: ord.currency, listAmount: ord.listAmount ?? plan.price },
        orderId,
        promoCode: ord.promoCode,
        creditsGranted: plan.credits,
      });
    }
    if (credits > 0) {
      await notify({
        userId: ord.userId,
        type: "payment_succeeded",
        params: { plan: plan.id, credits, amount: paid?.amount ?? ord.amount, currency: paid?.currency ?? ord.currency },
        link: "/settings?tab=billing",
        refId: orderId,
        email: {
          subject: `Payment received: ${credits.toLocaleString("en")} credits added`,
          title: "Payment received",
          body: `Thanks for your purchase. ${credits.toLocaleString("en")} credits have been added to your account.`,
          action: "View billing",
        },
      });
    }
  }
  return { order: ord, credits };
}

/**
 * 订阅状态 refunded：当期订阅款已全额退回（退款或拒付），Pro 立即结束，不等支付平台到期。
 * 只有新一期付款成功（grantSubscriptionCredits 真的发了新积分）或拒付赢回才能恢复；
 * 支付平台后续的状态通知（更新、恢复、重推的旧扣款通知）都不能把它改回 active。
 */
const keepRefunded = (status: string) =>
  status === "active" ? sql<string>`case when ${schema.subscription.status} = 'refunded' then 'refunded' else 'active' end` : status;

/** 订阅积分流水的 note：记下是哪份订阅发的，退款时据此判断退的是不是当期 */
const SUB_NOTE = "subscription:";

/** 事件比订阅上记的最近事件还旧：这次的状态变化不采用 */
const notStale = (eventAt: Date | undefined) =>
  eventAt ? or(isNull(schema.subscription.statusEventAt), lte(schema.subscription.statusEventAt, eventAt)) : undefined;

type SubState = { userId: string; planId: string; providerSubId: string; status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null };

async function subState(providerSubId: string): Promise<SubState | undefined> {
  const db = await getDb();
  const s = schema.subscription;
  const [row] = await db
    .select({ userId: s.userId, planId: s.planId, providerSubId: s.providerSubId, status: s.status, cancelAtPeriodEnd: s.cancelAtPeriodEnd, currentPeriodEnd: s.currentPeriodEnd })
    .from(s)
    .where(eq(s.providerSubId, providerSubId));
  return row;
}

/**
 * 订阅状态变了就通知用户：扣款失败（同时发邮件）、恢复、到期后取消、已结束。
 * 只在「之前不是、现在是」时发，回调重推不会重复；refId 按小时分桶，防止并发的回调和定时任务各发一条
 */
async function notifySubscriptionChange(before: SubState | undefined, after: SubState | undefined) {
  if (!after) return;
  const hour = new Date().toISOString().slice(0, 13);
  const base = {
    userId: after.userId,
    link: "/settings?tab=billing",
    params: { plan: after.planId, date: after.currentPeriodEnd?.toISOString() ?? null },
  };
  const ref = (kind: string) => `${after.providerSubId}:${kind}:${hour}`;
  if (after.status === "past_due" && before?.status !== "past_due") {
    await notify({
      ...base,
      type: "subscription_past_due",
      refId: ref("past_due"),
      email: {
        subject: "Your subscription payment failed",
        title: "We couldn't charge your card",
        body: "The latest payment for your subscription didn't go through. Update your payment method to keep your plan and monthly credits.",
        action: "Update payment method",
      },
    });
  } else if (after.status === "active" && before?.status === "past_due") {
    await notify({ ...base, type: "subscription_recovered", refId: ref("recovered") });
  } else if ((after.status === "canceled" || after.status === "expired") && (before?.status === "active" || before?.status === "past_due")) {
    await notify({ ...base, type: "subscription_ended", refId: ref("ended") });
  }
  if (after.status === "active" && after.cancelAtPeriodEnd && before && !before.cancelAtPeriodEnd) {
    await notify({ ...base, type: "subscription_canceling", refId: ref("canceling") });
  }
}

/** 旧事件不改状态，但带来的到期时间更晚（或本地还没有）就补上：到期时间只会往后走 */
async function fillPeriodEnd(providerSubId: string, periodEnd: Date | null | undefined) {
  if (!periodEnd) return;
  const db = await getDb();
  await db
    .update(schema.subscription)
    .set({ currentPeriodEnd: periodEnd })
    .where(
      and(
        eq(schema.subscription.providerSubId, providerSubId),
        or(isNull(schema.subscription.currentPeriodEnd), lte(schema.subscription.currentPeriodEnd, periodEnd)),
      ),
    );
}

/**
 * 创建或更新订阅记录。eventAt 是平台事件的时间：比上一次采用的事件旧（重推、乱序到达）就不改状态，
 * 返回 false；不传 eventAt 则总是更新
 */
export async function upsertSubscription(input: {
  userId: string;
  provider: string;
  providerSubId: string;
  providerCustomerId?: string | null;
  planId: string;
  status: string;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  eventAt?: Date;
}) {
  const db = await getDb();
  const { eventAt, ...values } = input;
  const before = await subState(input.providerSubId);
  const rows = await db
    .insert(schema.subscription)
    .values({ id: `sub_${input.providerSubId}`, ...values, statusEventAt: eventAt ?? null })
    .onConflictDoUpdate({
      target: schema.subscription.providerSubId,
      set: {
        status: keepRefunded(input.status),
        planId: input.planId,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        ...(input.providerCustomerId ? { providerCustomerId: input.providerCustomerId } : {}),
        ...(eventAt ? { statusEventAt: eventAt } : {}),
      },
      setWhere: notStale(eventAt),
    })
    .returning({ id: schema.subscription.id });
  if (rows.length === 0) await fillPeriodEnd(input.providerSubId, input.currentPeriodEnd);
  else await notifySubscriptionChange(before, await subState(input.providerSubId));
  return rows.length > 0;
}

/**
 * 订阅续费成功：按周期发放积分（refId 用账单/事件 id 保证幂等）并记下这笔付款；
 * 新的一期到账会恢复因全额退款结束的 Pro
 */
export async function grantSubscriptionCredits(opts: {
  userId: string;
  planId: string;
  refId: string;
  provider: string;
  providerSubId: string;
  paid: PaidWith;
  /** 平台明确说这一期是试用（如 Creem 的 trialing）；不传就按标价判断 */
  trial?: boolean;
  /** 下单时我们的订单号（回调 metadata 里带的）：首期付款把实付写回订单 */
  orderId?: string | null;
}) {
  const plan = getPlan(opts.planId);
  if (!plan || plan.mode !== "subscription") return { credits: 0, trial: false, granted: false };
  const db = await getDb();
  // 这份订阅的第一笔付款：下单时订单金额记的是方案标价，这里改成首期实付（试用 0、优惠码打折价），
  // 订单列表和后台收入才对。订单必须是同一个用户、同一个通道的
  const [prior] = await db
    .select({ id: schema.payment.id })
    .from(schema.payment)
    .where(and(eq(schema.payment.providerSubId, opts.providerSubId), sql`${schema.payment.grantRefId} <> ${opts.refId}`))
    .limit(1);
  const firstOrderId = !prior && opts.orderId ? opts.orderId : null;
  if (firstOrderId && opts.paid.amount != null) {
    await db
      .update(schema.order)
      .set({ amount: opts.paid.amount })
      .where(and(eq(schema.order.id, firstOrderId), eq(schema.order.userId, opts.userId), eq(schema.order.provider, opts.provider)));
  }
  // 试用期（这一期标价低于正价）只发 trialCredits，默认 0；优惠券打折标价不变，照发整期积分。
  // 回调里拿不到标价时，实付 0 也按试用算（宁可少发：0 元的一期要么是试用、要么是 100% 折扣，后者少见）
  const { listAmount, amount: charged } = opts.paid;
  const trial = opts.trial ?? (listAmount != null ? listAmount < plan.price : charged === 0);
  const credits = trial ? (plan.trialCredits ?? 0) : plan.credits;
  const granted =
    credits > 0 &&
    (await grantCredits({
      userId: opts.userId,
      amount: credits,
      reason: trial ? "trial" : "subscription",
      refId: opts.refId,
      note: SUB_NOTE + opts.providerSubId,
    }));
  await recordPayment({
    userId: opts.userId,
    provider: opts.provider,
    grantRefId: opts.refId,
    planId: plan.id,
    providerSubId: opts.providerSubId,
    paid: opts.paid,
    fallback: { amount: plan.price, currency: plan.currency, listAmount: trial ? null : plan.price },
    trial,
    creditsGranted: credits,
    orderId: firstOrderId,
  });
  if (granted) {
    await db
      .update(schema.subscription)
      .set({ status: "active" })
      .where(and(eq(schema.subscription.providerSubId, opts.providerSubId), eq(schema.subscription.status, "refunded")));
  }
  // 这一期的通知（refId 用这一期的付款 id，回调重推不会重复）：第一期是「已生效」，之后是「已续费」
  const type = trial ? "subscription_trial" : prior ? "subscription_renewed" : "subscription_started";
  await notify({
    userId: opts.userId,
    type,
    params: { plan: plan.id, credits: granted ? credits : 0 },
    link: "/settings?tab=billing",
    refId: opts.refId,
    ...(type === "subscription_started"
      ? {
          email: {
            subject: "Your subscription is active",
            title: "Welcome aboard",
            body: `Your subscription is active and ${credits.toLocaleString("en")} credits have been added. They refill every billing period.`,
            action: "View billing",
          },
        }
      : {}),
  });
  return { credits: granted ? credits : 0, trial, granted };
}

/** 某笔发放已被净扣回多少（扣回为负、拒付赢回为正，都用 note 关联到这笔发放） */
async function netClawedBack(grantRefId: string): Promise<number> {
  const db = await getDb();
  const [{ net }] = await db
    .select({ net: sql<number>`coalesce(sum(${schema.creditTransaction.delta}), 0)` })
    .from(schema.creditTransaction)
    .where(eq(schema.creditTransaction.note, `grant:${grantRefId}`));
  return -Number(net);
}

/**
 * 退款 / 拒付 / 拒付赢回之后，同步这份订阅的 Pro 状态：
 * 只看这份订阅最新一期发的积分 —— 全额扣回就结束 Pro（refunded），赢回到不再是全额就恢复；
 * 退的是更早的月份不影响当期，部分退款保留 Pro。
 */
async function syncRefundedSubscription(grant: typeof schema.creditTransaction.$inferSelect) {
  if (!["subscription", "trial"].includes(grant.reason) || !grant.refId || !grant.note?.startsWith(SUB_NOTE)) return;
  const db = await getDb();
  const [latest] = await db
    .select({ refId: schema.creditTransaction.refId })
    .from(schema.creditTransaction)
    .where(and(inArray(schema.creditTransaction.reason, ["subscription", "trial"]), eq(schema.creditTransaction.note, grant.note)))
    .orderBy(desc(schema.creditTransaction.createdAt))
    .limit(1);
  if (latest?.refId !== grant.refId) return;
  const fullyRefunded = (await netClawedBack(grant.refId)) >= grant.delta;
  const [from, to] = fullyRefunded ? ["active", "refunded"] : ["refunded", "active"];
  await db
    .update(schema.subscription)
    .set({ status: to })
    .where(and(eq(schema.subscription.providerSubId, grant.note.slice(SUB_NOTE.length)), eq(schema.subscription.status, from)));
}

/**
 * 退款 / 拒付：按「当初发放的那一笔积分」扣回。
 * - grantRefId：当初发积分时的 refId —— 一次性订单 order_<订单号>，订阅按期发放 stripe_<账单号> /
 *   creem_tx_<交易号> / waffo_<支付号>。找不到这笔发放就什么都不做（不能凭回调里的数字扣）
 * - clawbackRefId：这次退款 / 拒付的唯一 id，重复推送只扣一次
 * - ratio：退款比例，部分退款按比例扣（向上取整）
 *   cumulative=true：ratio 是「累计已退比例」（Stripe 的 amount_refunded），补扣到目标总额
 *   cumulative=false：ratio 是「这一笔退款的比例」（Creem、Waffo 每笔退款单独推送）
 * 同一笔发放累计扣回不超过当初发的数量；余额不够也照扣（变成负数 = 冻结）。
 * 一次性订单全部扣回后，订单标记为 refunded。
 */
export async function clawbackGrant(opts: {
  grantRefId: string | null;
  clawbackRefId: string;
  ratio?: number;
  cumulative?: boolean;
  /** false：这不是平台发来的退款，而是批准退款申请时先冻结积分（见 refunds.ts），不去结退款申请 */
  settle?: boolean;
  /** 平台这次退了多少钱（分）；cumulative 表示是累计已退（Stripe）。写进 payment 汇总 */
  refunded?: { amount: number; cumulative?: boolean };
  /** 拒付：payment 汇总标成 disputed */
  dispute?: boolean;
}): Promise<number> {
  // 对不上发放记录的退款 / 拒付要留痕，否则线上漏扣了也没人知道
  if (!opts.grantRefId) {
    console.warn(`[clawback] ${opts.clawbackRefId}: no grant ref, nothing clawed back`);
    return 0;
  }
  const db = await getDb();
  const [grant] = await db.select().from(schema.creditTransaction).where(eq(schema.creditTransaction.refId, opts.grantRefId));
  if (!grant || grant.delta <= 0) {
    console.warn(`[clawback] ${opts.clawbackRefId}: grant ${opts.grantRefId} not found, nothing clawed back`);
    return 0;
  }
  // 同一笔退款重推：已经处理过
  const [seen] = await db
    .select({ id: schema.creditTransaction.id })
    .from(schema.creditTransaction)
    .where(eq(schema.creditTransaction.refId, opts.clawbackRefId));
  if (seen) return 0;
  if (opts.refunded || opts.dispute) await updatePaymentRefundSummary(opts.grantRefId, opts.refunded, opts.dispute);

  // 平台退款到账：结掉这笔付款上的退款申请；批准时冻结的积分算作这次扣回的一部分，下面多退少补
  const held = opts.settle === false ? 0 : await settleRefundRequest(opts.grantRefId, opts.clawbackRefId);
  const link = `grant:${opts.grantRefId}`;
  const alreadyClawed = (await netClawedBack(opts.grantRefId)) - held;
  const { amount, change } = computeClawback({ granted: grant.delta, ratio: opts.ratio, alreadyClawed, held, cumulative: opts.cumulative });
  // 冻结记录已改名为 clawbackRefId（见 settleRefundRequest），多退少补用另一个 refId
  const refId = held ? `${opts.clawbackRefId}_adj` : opts.clawbackRefId;

  let done = false;
  if (change > 0) {
    done = await deductCredits({ userId: grant.userId, amount: change, reason: "clawback", refId, note: link });
  } else if (change < 0) {
    done = await grantCredits({ userId: grant.userId, amount: -change, reason: "restore", refId, note: link });
  }
  if (!done && !held) return 0;
  if (opts.grantRefId.startsWith("order_") && alreadyClawed + amount >= grant.delta) {
    await db.update(schema.order).set({ status: "refunded" }).where(eq(schema.order.id, opts.grantRefId.slice("order_".length)));
  }
  await syncRefundedSubscription(grant);
  // 平台退款到账（不是批准申请时的冻结、也不是拒付）：通知用户，同时发邮件
  if (opts.settle !== false && !opts.dispute) {
    await notify({
      userId: grant.userId,
      type: "refund_completed",
      params: { credits: amount },
      link: "/settings?tab=billing",
      refId: opts.clawbackRefId,
      email: {
        subject: "Your refund has been processed",
        title: "Refund processed",
        body: `Your refund has been processed and ${amount.toLocaleString("en")} credits from that purchase were removed from your balance. It can take 5–10 business days to show on your statement.`,
        action: "View billing",
      },
    });
  }
  return change;
}

/** payment 汇总：累计已退金额和状态（paid / partially_refunded / refunded / disputed） */
async function updatePaymentRefundSummary(grantRefId: string, refunded?: { amount: number; cumulative?: boolean }, dispute?: boolean) {
  const db = await getDb();
  const [p] = await db.select().from(schema.payment).where(eq(schema.payment.grantRefId, grantRefId));
  if (!p) return;
  const refundedAmount = refunded ? (refunded.cumulative ? refunded.amount : p.refundedAmount + refunded.amount) : p.refundedAmount;
  await db
    .update(schema.payment)
    .set({ refundedAmount, status: dispute ? "disputed" : refundStatus(refundedAmount, p.amount) })
    .where(eq(schema.payment.id, p.id));
}

/**
 * 付款汇总的累计已退金额跟支付平台对齐（对账用）：只往上调，只改汇总、不动积分（积分按退款单扣）。
 * 用在 payment 表上线前的老付款、或汇总因故没记上的退款。改了返回改之前的那行
 */
export async function syncPaymentRefunded(providerPaymentId: string, refundedAtProvider: number) {
  const db = await getDb();
  const [p] = await db.select().from(schema.payment).where(eq(schema.payment.providerPaymentId, providerPaymentId));
  if (!p || p.status === "disputed" || p.refundedAmount >= refundedAtProvider) return null;
  await db
    .update(schema.payment)
    .set({ refundedAmount: refundedAtProvider, status: refundStatus(refundedAtProvider, p.amount) })
    .where(eq(schema.payment.id, p.id));
  return p;
}

/** 批准退款申请时冻结积分用的 refId；平台退款到账后改名为那次退款的 refId */
export const refundHoldRef = (requestId: string) => `refund_hold_${requestId}`;

/**
 * 这笔付款的退款到账：把它上面没结的退款申请标记为已退款。
 * 处理中的申请批准时已冻结积分，返回冻结的数量，并把冻结记录的 refId 改成这次退款的 refId（重推时据此去重）。
 * 待审核的申请说明管理员直接在支付平台后台退了款；失败的申请说明平台其实受理了（或管理员手动退了），
 * 这两种冻结已不在（或从没冻结），按普通退款扣回，申请一并结掉，免得之后再批准一次重复退钱。
 */
async function settleRefundRequest(grantRefId: string, clawbackRefId: string): Promise<number> {
  const db = await getDb();
  const [req] = await db
    .select({ id: schema.refundRequest.id, status: schema.refundRequest.status })
    .from(schema.refundRequest)
    .innerJoin(schema.payment, eq(schema.refundRequest.paymentId, schema.payment.id))
    .where(and(eq(schema.payment.grantRefId, grantRefId), inArray(schema.refundRequest.status, ["pending", "processing", "failed"])));
  if (!req) return 0;
  let held = 0;
  if (req.status === "processing" || req.status === "pending") {
    const [hold] = await db
      .update(schema.creditTransaction)
      .set({ refId: clawbackRefId })
      .where(eq(schema.creditTransaction.refId, refundHoldRef(req.id)))
      .returning({ delta: schema.creditTransaction.delta });
    held = hold ? -hold.delta : 0;
  }
  await db.update(schema.refundRequest).set({ status: "refunded" }).where(eq(schema.refundRequest.id, req.id));
  return held;
}

/** 拒付赢回：把那笔拒付扣掉的积分还回去（restoreRefId 保证只还一次） */
export async function restoreClawback(opts: { clawbackRefId: string; restoreRefId: string }): Promise<boolean> {
  const db = await getDb();
  const [cb] = await db.select().from(schema.creditTransaction).where(eq(schema.creditTransaction.refId, opts.clawbackRefId));
  if (!cb || cb.delta >= 0) return false;
  const done = await grantCredits({ userId: cb.userId, amount: -cb.delta, reason: "restore", refId: opts.restoreRefId, note: cb.note ?? undefined });
  if (done && cb.note?.startsWith("grant:order_")) {
    await db.update(schema.order).set({ status: "paid" }).where(eq(schema.order.id, cb.note.slice("grant:order_".length)));
  }
  if (done && cb.note?.startsWith("grant:")) {
    const grantRefId = cb.note.slice("grant:".length);
    const [grant] = await db.select().from(schema.creditTransaction).where(eq(schema.creditTransaction.refId, grantRefId));
    if (grant) await syncRefundedSubscription(grant);
    // 拒付赢回：payment 汇总从 disputed 改回按已退金额算的状态
    const [p] = await db.select().from(schema.payment).where(eq(schema.payment.grantRefId, grantRefId));
    if (p?.status === "disputed") {
      await db.update(schema.payment).set({ status: refundStatus(p.refundedAmount, p.amount) }).where(eq(schema.payment.id, p.id));
    }
  }
  return done;
}

/** 支付平台的状态通知：refunded 不会被改回 active（见 keepRefunded） */
export async function updateSubscriptionStatus(
  provider: string,
  providerSubId: string,
  patch: { status?: string; currentPeriodEnd?: Date | null; cancelAtPeriodEnd?: boolean },
  eventAt?: Date,
): Promise<"applied" | "stale" | "missing"> {
  const db = await getDb();
  const { status, ...rest } = patch;
  const target = and(eq(schema.subscription.provider, provider), eq(schema.subscription.providerSubId, providerSubId));
  const before = await subState(providerSubId);
  const done = await db
    .update(schema.subscription)
    .set({ ...rest, ...(status ? { status: keepRefunded(status) } : {}), ...(eventAt ? { statusEventAt: eventAt } : {}) })
    .where(and(target, notStale(eventAt)))
    .returning({ id: schema.subscription.id });
  if (done.length > 0) {
    await notifySubscriptionChange(before, await subState(providerSubId));
    return "applied";
  }
  // 没更新到：要么本站没有这份订阅，要么事件比上一次采用的旧（乱序、重推）
  const [exists] = await db.select({ id: schema.subscription.id }).from(schema.subscription).where(target);
  if (!exists) return "missing";
  await fillPeriodEnd(providerSubId, patch.currentPeriodEnd);
  return "stale";
}

export async function findSubscription(provider: string, providerSubId: string) {
  const db = await getDb();
  const [sub] = await db
    .select()
    .from(schema.subscription)
    .where(and(eq(schema.subscription.provider, provider), eq(schema.subscription.providerSubId, providerSubId)));
  return sub ?? null;
}
