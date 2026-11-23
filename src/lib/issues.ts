import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { siteConfig } from "@/config/site";
import { getDb, schema } from "@/db";
import { adminEmails } from "@/lib/admin-emails";
import { emailLayout, sendEmail } from "@/lib/email";
import { newId } from "@/lib/ids";
import { notifyAdmins } from "@/lib/notify";

/**
 * 问题表（ledger_issue）：需要人看一眼的异常都记在这里，后台「异常与对账」页处理，概览「待处理」计数。
 * 同一个问题按 key（类型:对象）只有一行，有状态：open 待处理 → resolved 已解决 / ignored 忽略。两类来源：
 * - 状态类：按当前数据算出来的（余额对不上、退款失败……）。每次检查重算，条件消失自动解决；
 *   管理员标了已解决但条件还在，下次检查重新打开。不想再看到就「忽略」
 * - 事件类：某件事发生过（回调处理出错、回调被拒、漏单……）。发生了开一个，只有管理员能关；
 *   回调处理出错那次，平台重试成功了会自动解决
 * 新开的问题（包括重新打开的）在铃铛和邮件里提醒管理员一次，不会每次检查都提醒
 */
const { ledgerIssue, paymentEvent, refundRequest, payment } = schema;
const DAY = 86_400_000;

export type IssueRow = typeof ledgerIssue.$inferSelect;
export type FoundIssue = { kind: string; severity: "error" | "warning"; entityId: string; userId?: string | null; detail: Record<string, unknown> };

/** 账务检查（每天，src/lib/jobs/ledger.ts） */
export const LEDGER_KINDS = ["balance_mismatch", "paid_without_credits", "over_refunded", "refund_stuck", "negative_balance"] as const;
/** 支付检查（查漏单任务每 10 分钟跑一次，见 checkPaymentIssues） */
export const PAYMENT_KINDS = ["webhook_error", "refund_failed", "missed_webhook", "webhook_rejected", "reconcile_failed"] as const;
export const ISSUE_KINDS = [...PAYMENT_KINDS, ...LEDGER_KINDS] as const;
export const ISSUE_STATUSES = ["open", "resolved", "ignored"] as const;

/**
 * 写入检查发现的问题，返回新开的：第一次出现的，以及 reopen 为真时「已解决后又出现」的。
 * 已有的只更新详情和最近一次发现时间；忽略的保持忽略。时间都用应用这边的时钟，和 resolveGone 的比较一致
 */
export async function saveIssues(found: FoundIssue[], opts: { reopen: boolean }): Promise<IssueRow[]> {
  if (!found.length) return [];
  const db = await getDb();
  const now = new Date();
  const keyed = found.map((f) => ({ ...f, key: `${f.kind}:${f.entityId}` }));
  const existing = new Map<string, IssueRow>();
  for (let i = 0; i < keyed.length; i += 1000) {
    const rows = await db
      .select()
      .from(ledgerIssue)
      .where(inArray(ledgerIssue.key, keyed.slice(i, i + 1000).map((f) => f.key)));
    for (const r of rows) existing.set(r.key, r);
  }
  const opened: IssueRow[] = [];
  for (const f of keyed) {
    const detail = JSON.stringify(f.detail);
    const old = existing.get(f.key);
    if (!old) {
      const [row] = await db
        .insert(ledgerIssue)
        .values({ id: newId("iss"), key: f.key, kind: f.kind, severity: f.severity, userId: f.userId ?? null, entityId: f.entityId, detail, firstSeenAt: now, lastSeenAt: now })
        .onConflictDoNothing()
        .returning();
      if (row) opened.push(row);
    } else if (old.status === "resolved") {
      if (!opts.reopen) continue;
      // 重新打开：上次的处理备注在操作日志里，这里清掉，免得看起来像已经有人处理过
      const [row] = await db
        .update(ledgerIssue)
        .set({ status: "open", severity: f.severity, detail, firstSeenAt: now, lastSeenAt: now, resolvedAt: null, resolvedBy: null, note: null })
        .where(and(eq(ledgerIssue.id, old.id), eq(ledgerIssue.status, "resolved")))
        .returning();
      if (row) opened.push(row);
    } else {
      await db.update(ledgerIssue).set({ detail, lastSeenAt: now }).where(eq(ledgerIssue.id, old.id));
    }
  }
  return opened;
}

/** 状态类检查收尾：这些类型里这次没再发现的（最近一次发现早于 started），自动标为已解决 */
export async function resolveGone(kinds: readonly string[], started: Date) {
  const db = await getDb();
  return db
    .update(ledgerIssue)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: "system" })
    .where(and(eq(ledgerIssue.status, "open"), inArray(ledgerIssue.kind, [...kinds]), lt(ledgerIssue.lastSeenAt, started)))
    .returning({ id: ledgerIssue.id });
}

/* ---------------- 支付检查 ---------------- */

/**
 * 事件类信号：按通道汇总最近 24 小时（或上次处理之后）的次数，到了门槛开一个问题。
 * - missed_webhook：平台收了钱、回调没到，靠定时任务补的单。钱已经补上，要查的是 webhook 地址 / 密钥配置
 * - webhook_rejected：签名对但不是我们的单（别的店铺的事件），有人在伪造回调，或者密钥配错了
 * - reconcile_failed：去平台查单失败。偶尔一次是网络抖动（会自动重试），连续多次才提醒
 */
const SIGNALS = [
  { kind: "missed_webhook", threshold: 1, match: (e: { kind: string; outcome: string }) => e.kind === "missed_webhook" },
  { kind: "webhook_rejected", threshold: 1, match: (e: { kind: string; outcome: string }) => e.outcome === "rejected" },
  { kind: "reconcile_failed", threshold: 3, match: (e: { kind: string; outcome: string }) => e.kind === "reconcile_failed" },
] as const;

/**
 * 支付相关的问题，查漏单、对账、账务检查任务跑完都会调一次：
 * - webhook_error：回调处理出错（订单不存在、退款对应的付款本站没记过、代码异常……），同一个平台事件重试多次只算一个
 * - refund_failed：退款申请处于失败状态（平台退款接口报错、平台通知退款失败），要重试或联系用户
 * - 以及上面 SIGNALS 里的三种信号
 */
export async function checkPaymentIssues(log: (m: string) => void = () => {}) {
  const db = await getDb();
  const started = new Date();
  const weekAgo = new Date(started.getTime() - 7 * DAY);
  const dayAgo = new Date(started.getTime() - DAY);
  const found: FoundIssue[] = [];

  // 1. 回调处理出错。批准退款时平台接口报错的那条（refund_approved）由 refund_failed 覆盖
  const errors = await db
    .select()
    .from(paymentEvent)
    .where(
      and(
        eq(paymentEvent.outcome, "error"),
        gte(paymentEvent.createdAt, weekAgo),
        notInArray(paymentEvent.kind, ["reconcile_failed", "refund_approved"]),
        ne(paymentEvent.provider, "system"),
      ),
    )
    .orderBy(asc(paymentEvent.createdAt))
    .limit(1000);
  const byEvent = new Map<string, { last: (typeof errors)[number]; attempts: number; first: Date }>();
  for (const e of errors) {
    const id = e.providerEventId ?? e.id;
    const g = byEvent.get(id);
    byEvent.set(id, { last: e, attempts: (g?.attempts ?? 0) + 1, first: g?.first ?? e.createdAt });
  }
  const eventIds = errors.map((e) => e.providerEventId).filter((v): v is string => !!v);
  const retriedOk = new Set(
    eventIds.length
      ? (
          await db
            .select({ id: paymentEvent.providerEventId })
            .from(paymentEvent)
            .where(and(eq(paymentEvent.outcome, "ok"), inArray(paymentEvent.providerEventId, [...new Set(eventIds)])))
        ).map((r) => r.id)
      : [],
  );
  for (const [id, { last: e, attempts, first }] of byEvent) {
    if (retriedOk.has(id)) continue;
    found.push({
      kind: "webhook_error",
      severity: "error",
      entityId: id,
      userId: e.userId,
      detail: { provider: e.provider, event: e.providerEventType ?? e.kind, message: e.message, email: e.userEmail, order: e.orderId, payment: e.providerPaymentId, attempts, first: first.toISOString() },
    });
  }
  const webhookOpened = await saveIssues(found.splice(0), { reopen: false });
  // 平台重试成功了（同一个平台事件后来有一条 ok）：自动解决
  const retried = await db
    .update(ledgerIssue)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: "system" })
    .where(
      and(
        eq(ledgerIssue.kind, "webhook_error"),
        eq(ledgerIssue.status, "open"),
        sql`exists (select 1 from payment_event e where e.provider_event_id = ${sql.raw(`"ledger_issue"."entity_id"`)} and e.outcome = 'ok')`,
      ),
    )
    .returning({ id: ledgerIssue.id });
  log(`webhook errors: ${byEvent.size} event(s), ${webhookOpened.length} new, ${retried.length} fixed by a retry`);

  // 2. 退款失败（状态类）
  const failed = await db
    .select({ r: refundRequest, p: { providerPaymentId: payment.providerPaymentId, provider: payment.provider, currency: payment.currency } })
    .from(refundRequest)
    .innerJoin(payment, eq(refundRequest.paymentId, payment.id))
    .where(eq(refundRequest.status, "failed"))
    .limit(500);
  for (const { r, p } of failed) {
    found.push({
      kind: "refund_failed",
      severity: "error",
      entityId: r.id,
      userId: r.userId,
      detail: { provider: p.provider, payment: p.providerPaymentId, amount: r.amount, currency: p.currency, message: r.adminNote },
    });
  }
  const refundOpened = await saveIssues(found.splice(0), { reopen: true });
  const refundFixed = await resolveGone(["refund_failed"], started);
  log(`failed refunds: ${failed.length}, ${refundOpened.length} new, ${refundFixed.length} no longer failed`);

  // 3. 信号：只数上次处理之后的（已解决的问题再有新情况才重新打开；忽略的不再提醒）
  const recent = await db
    .select({ provider: paymentEvent.provider, kind: paymentEvent.kind, outcome: paymentEvent.outcome, orderId: paymentEvent.orderId, message: paymentEvent.message, createdAt: paymentEvent.createdAt })
    .from(paymentEvent)
    .where(and(gte(paymentEvent.createdAt, dayAgo), or(inArray(paymentEvent.kind, ["missed_webhook", "reconcile_failed"]), eq(paymentEvent.outcome, "rejected"))))
    .orderBy(desc(paymentEvent.createdAt))
    .limit(2000);
  const signalRows = await db
    .select()
    .from(ledgerIssue)
    .where(inArray(ledgerIssue.kind, SIGNALS.map((s) => s.kind)));
  const prev = new Map(signalRows.map((r) => [r.key, r]));
  for (const s of SIGNALS) {
    for (const provider of new Set(recent.filter(s.match).map((e) => e.provider))) {
      const old = prev.get(`${s.kind}:${provider}`);
      if (old?.status === "ignored") continue;
      const since = old?.status === "resolved" && old.resolvedAt && old.resolvedAt > dayAgo ? old.resolvedAt : dayAgo;
      const evs = recent.filter((e) => s.match(e) && e.provider === provider && e.createdAt > since);
      if (evs.length < s.threshold) continue;
      found.push({
        kind: s.kind,
        severity: "warning",
        entityId: provider,
        detail: { provider, count: evs.length, last: evs[0].createdAt.toISOString(), orders: [...new Set(evs.map((e) => e.orderId).filter(Boolean))].slice(0, 5), message: evs[0].message },
      });
    }
  }
  const signalOpened = await saveIssues(found, { reopen: true });
  log(`signals: ${found.length} active, ${signalOpened.length} new`);

  return { opened: [...webhookOpened, ...refundOpened, ...signalOpened], autoResolved: retried.length + refundFixed.length };
}

/* ---------------- 提醒 ---------------- */

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** 邮件里的一行说明（英文，给管理员看）；后台页面按语言另外拼 */
function describe(i: IssueRow) {
  const d = JSON.parse(i.detail ?? "{}") as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) && v.length ? ` (${v.join(", ")})` : "");
  switch (i.kind) {
    case "webhook_error":
      return `${d.provider} ${d.event} ${i.entityId}${d.email ? ` · ${d.email}` : ""}: ${d.message}`;
    case "refund_failed":
      return `refund ${i.entityId} for ${d.provider} payment ${d.payment}: ${d.message ?? "failed"}`;
    case "missed_webhook":
      return `${d.provider}: ${d.count} payment(s) filled in by reconciliation because the webhook never arrived${list(d.orders)}`;
    case "webhook_rejected":
      return `${d.provider}: ${d.count} rejected webhook(s) — ${d.message}`;
    case "reconcile_failed":
      return `${d.provider}: ${d.count} failed provider queries — ${d.message}`;
    default:
      return `${i.entityId} · ${JSON.stringify(d)}`;
  }
}

const MAX_LINES = 50;

/** 新开的问题：铃铛提醒管理员一次，并发邮件给 ADMIN_EMAILS（逐条列出）。没有新问题什么都不做 */
export async function announceIssues(opened: IssueRow[]) {
  if (!opened.length) return { sentTo: 0 };
  const n = opened.length;
  const errors = opened.filter((i) => i.severity === "error").length;
  await notifyAdmins({ type: "admin_issues", params: { count: n, errors }, link: "/admin/reconciliation", refId: `issues_${Date.now()}_${opened[0].id}` });
  const to = adminEmails();
  if (!to.length) {
    console.warn(`[issues] ${n} new issue(s) but ADMIN_EMAILS is empty — no email sent`);
    return { sentTo: 0 };
  }
  // 错误排前面
  const sorted = [...opened].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const lines = sorted.slice(0, MAX_LINES).map((i) => `<b>${esc(i.severity)} · ${esc(i.kind)}</b><br>${esc(describe(i))}`);
  const more = n > MAX_LINES ? `<br><br>…and ${n - MAX_LINES} more in the admin.` : "";
  const site = (process.env.NEXT_PUBLIC_SITE_URL || siteConfig.url).replace(/\/$/, "");
  const html = emailLayout({
    title: `${n} new issue${n === 1 ? "" : "s"} to look at`,
    body: lines.join("<br><br>") + more,
    action: { label: "Open issues", url: `${site}/admin/reconciliation` },
  });
  for (const addr of to) await sendEmail({ to: addr, subject: `[${siteConfig.name}] ${n} new issue(s)${errors ? `, ${errors} error(s)` : ""}`, html });
  return { sentTo: to.length };
}

/** 支付检查 + 提醒，给定时任务用；extra 是同一个任务里别的检查（账务检查）新开的，一起提醒 */
export async function runIssueChecks(log: (m: string) => void, extra: IssueRow[] = []) {
  const pay = await checkPaymentIssues(log);
  const opened = [...extra, ...pay.opened];
  const { sentTo } = await announceIssues(opened);
  const db = await getDb();
  const [{ open }] = await db.select({ open: count() }).from(ledgerIssue).where(eq(ledgerIssue.status, "open"));
  return { new: opened.length, autoResolved: pay.autoResolved, open, sentTo };
}

/** 待处理的问题数（按级别），概览和导航角标用 */
export async function openIssueCounts() {
  const db = await getDb();
  const rows = await db.select({ severity: ledgerIssue.severity, n: count() }).from(ledgerIssue).where(eq(ledgerIssue.status, "open")).groupBy(ledgerIssue.severity);
  const by = Object.fromEntries(rows.map((r) => [r.severity, r.n])) as Record<string, number>;
  return { errors: by.error ?? 0, warnings: by.warning ?? 0 };
}
