import "server-only";
import { and, asc, count, desc, eq, gte, isNull, lt, sql, sum, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { openIssueCounts } from "./issues";
import { JOBS } from "./jobs/registry";
import { jobStates, schedulerHealth } from "./jobs/runner";
import { configErrorCount } from "./system-check";
import type { TableQuery } from "./table";
import { inRange } from "./table-db";

/** 后台「定时任务」「异常与对账」页和概览「待处理」的查询：运行历史、问题列表、每日对账报表。列表都是服务端分页 */
const { generation, jobRun, ledgerIssue, payment, paymentEvent, refundRequest, user } = schema;

const where = (conds: (SQL | undefined)[]) => {
  const list = conds.filter(Boolean) as SQL[];
  return list.length ? and(...list) : undefined;
};

/* ---------------- 运行历史 ---------------- */

export const RUN_FILTERS = { job: JOBS.map((j) => j.name), status: ["running", "success", "failed"], trigger: ["tick", "internal", "manual"] } as const;

export async function listJobRuns(q: TableQuery) {
  const db = await getDb();
  const cond = where([
    q.filters.job ? eq(jobRun.job, q.filters.job) : undefined,
    q.filters.status ? eq(jobRun.status, q.filters.status) : undefined,
    q.filters.trigger ? eq(jobRun.trigger, q.filters.trigger) : undefined,
    inRange(q, jobRun.startedAt),
  ]);
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(jobRun).where(cond).orderBy(desc(jobRun.startedAt), desc(jobRun.id)).limit(q.size).offset(q.offset),
    db.select({ n: count() }).from(jobRun).where(cond),
  ]);
  return { rows, total: n };
}

/* ---------------- 问题 ---------------- */

export async function listIssues(q: TableQuery) {
  const db = await getDb();
  // 分栏上的数字跟着类型、级别、日期筛选走（不跟状态走），和列表对得上。日期 = 这段时间里出现过（首次发现在结束前、最近一次在开始后）
  const byFilter = [
    q.filters.kind ? eq(ledgerIssue.kind, q.filters.kind) : undefined,
    q.filters.severity ? eq(ledgerIssue.severity, q.filters.severity) : undefined,
    inRange(q, ledgerIssue.firstSeenAt, ledgerIssue.lastSeenAt),
  ];
  const cond = where([q.filters.status ? eq(ledgerIssue.status, q.filters.status) : undefined, ...byFilter]);
  const [rows, [{ n }], byStatus] = await Promise.all([
    db
      .select({ i: ledgerIssue, email: user.email })
      .from(ledgerIssue)
      .leftJoin(user, eq(user.id, ledgerIssue.userId))
      .where(cond)
      // 错误排在警告前面，同级按最近一次发现
      .orderBy(sql`case ${ledgerIssue.severity} when 'error' then 0 else 1 end`, desc(ledgerIssue.lastSeenAt))
      .limit(q.size)
      .offset(q.offset),
    db.select({ n: count() }).from(ledgerIssue).where(cond),
    db.select({ status: ledgerIssue.status, n: count() }).from(ledgerIssue).where(where(byFilter)).groupBy(ledgerIssue.status),
  ]);
  return {
    rows: rows.map(({ i, email }) => ({ ...i, email, detail: JSON.parse(i.detail ?? "{}") as Record<string, unknown> })),
    total: n,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number>,
  };
}

/* ---------------- 概览「待处理」 ---------------- */

/**
 * 现在有几件事要人管：退款待审核、退款要到平台后台手动退、待处理的问题（按级别）、拒付中的付款、
 * 最近一次运行失败的定时任务、调度器是否停了、配置错误、今天（UTC）失败的 AI 调用。都是实时数的，处理掉数字就变
 */
export async function attentionSummary() {
  const db = await getDb();
  const [[pending], [manual], issues, [disputed], jobs, scheduler, configErrors, [aiFailed]] = await Promise.all([
    db.select({ n: count() }).from(refundRequest).where(eq(refundRequest.status, "pending")),
    // 处理中、又没有平台退款号的：Creem、Waffo 订阅这类没有退款接口的，要管理员到平台后台手动退
    db
      .select({ n: count() })
      .from(refundRequest)
      .where(and(eq(refundRequest.status, "processing"), isNull(refundRequest.providerRefundId))),
    openIssueCounts(),
    db.select({ n: count() }).from(payment).where(eq(payment.status, "disputed")),
    jobStates(),
    schedulerHealth(),
    configErrorCount(),
    db
      .select({ n: count() })
      .from(generation)
      .where(and(eq(generation.status, "failed"), gte(generation.createdAt, utcDay(new Date())))),
  ]);
  return {
    pendingRefunds: pending.n,
    manualRefunds: manual.n,
    issueErrors: issues.errors,
    issueWarnings: issues.warnings,
    disputes: disputed.n,
    failedJobs: jobs.filter((j) => j.enabled && j.lastStatus === "failed").length,
    configErrors,
    aiFailedToday: aiFailed.n,
    // 本地开发通常不跑定时任务：从没被触发过就不算（线上照常提醒）
    schedulerStale: scheduler.stale && (process.env.NODE_ENV === "production" || !!scheduler.lastTickAt),
  };
}

/* ---------------- 每日对账报表 ---------------- */

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * 按天（UTC）、支付通道、币种汇总本地记下的钱：笔数、收入、退款、净额，以及那天定时任务补上的漏单数
 * （missed_webhook：平台收了钱但回调没到，对账补上的）。范围默认从第一笔付款那天到今天，选了日期就按选的（不超过今天）；
 * 一页 size 天，从后往前
 */
export async function dailyReport(q: Pick<TableQuery, "page" | "size" | "from" | "to">) {
  const db = await getDb();
  const tomorrow = new Date(utcDay(new Date()).getTime() + DAY);
  const [first] = q.from ? [] : await db.select({ at: payment.createdAt }).from(payment).orderBy(asc(payment.createdAt)).limit(1);
  const rangeStart = q.from ?? (first ? utcDay(first.at) : new Date(tomorrow.getTime() - DAY));
  const rangeEnd = q.to && q.to < tomorrow ? q.to : tomorrow;
  const totalDays = Math.max(0, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY));
  const end = new Date(rangeEnd.getTime() - (q.page - 1) * q.size * DAY);
  const start = new Date(Math.max(rangeStart.getTime(), end.getTime() - q.size * DAY));
  const day = sql<string>`to_char(${payment.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const evDay = sql<string>`to_char(${paymentEvent.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [money, missed] = await Promise.all([
    db
      .select({ day, provider: payment.provider, currency: payment.currency, n: count(), gross: sum(payment.amount), refunded: sum(payment.refundedAmount) })
      .from(payment)
      .where(and(gte(payment.createdAt, start), lt(payment.createdAt, end)))
      .groupBy(day, payment.provider, payment.currency),
    db
      .select({ day: evDay, provider: paymentEvent.provider, n: count() })
      .from(paymentEvent)
      .where(and(eq(paymentEvent.kind, "missed_webhook"), gte(paymentEvent.createdAt, start), lt(paymentEvent.createdAt, end)))
      .groupBy(evDay, paymentEvent.provider),
  ]);
  const days: { day: string; rows: { provider: string; currency: string; count: number; gross: number; refunded: number; net: number; missed: number }[] }[] = [];
  for (let t = end.getTime() - DAY; t >= start.getTime(); t -= DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    const rows = money
      .filter((m) => m.day === d)
      .map((m) => {
        const gross = Number(m.gross ?? 0);
        const refunded = Number(m.refunded ?? 0);
        return { provider: m.provider, currency: m.currency, count: m.n, gross, refunded, net: gross - refunded, missed: missed.find((x) => x.day === d && x.provider === m.provider)?.n ?? 0 };
      });
    // 只有漏单、没有当天付款的通道也列出来
    for (const x of missed.filter((x) => x.day === d && !rows.some((r) => r.provider === x.provider))) {
      rows.push({ provider: x.provider, currency: "", count: 0, gross: 0, refunded: 0, net: 0, missed: x.n });
    }
    days.push({ day: d, rows });
  }
  return { days, totalDays };
}
