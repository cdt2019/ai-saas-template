import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { ArrowRight, Bot, ChevronRight, CircleCheck, Eye, ReceiptText, TriangleAlert, Users, Zap } from "lucide-react";
import { getDb, schema } from "@/db";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { attentionSummary } from "@/lib/admin-ops";
import { localePath } from "@/lib/paths";
import { fmtTime, Panel, PanelHead, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { AreaChart, PageHeader } from "@/components/ui";

/** 依赖登录状态，每次请求实时渲染 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const DAY = 86_400_000;
const CHART_DAYS = 14;
const since = (days: number) => new Date(Date.now() - days * DAY);
/** 最近 n 天的 UTC 日期（YYYY-MM-DD，旧的在前） */
const lastDays = (n: number) => {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY).toISOString().slice(0, 10));
};

/**
 * 后台概览（仅管理员）：最上面是「待处理」——现在有几件事要人管，每类一行，点进去是过滤好的列表；
 * 下面是收入和核心指标、新注册用户、最近到账。具体的处理都在各自的页面（退款、异常与对账、交易、定时任务）
 */
export default async function AdminPage({ params }: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  // 非管理员一律 404，不暴露后台的存在
  await requireAdmin();
  const dict = await getDictionary(lang);
  const t = dict.admin.overview;

  const db = await getDb();
  const { user, subscription, generation, creditTransaction, payment } = schema;
  const day = sql`now() - interval '1 day'`;
  const payDay = sql<string>`to_char(${payment.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

  const [attention, [users], [users24h], [revenue], [activeSubs], [gens24h], [failed24h], [spent24h], recentUsers, recentPayments, revenueRows] = await Promise.all([
    attentionSummary(),
    db.select({ n: count() }).from(user),
    db.select({ n: count() }).from(user).where(gte(user.createdAt, day)),
    // 收入按实际到账算：每一笔付款（含订阅续费）的实付，减去已退的；试用 0 元、优惠码打折都按真实金额
    db.select({ gross: sum(payment.amount), refunded: sum(payment.refundedAmount) }).from(payment),
    db.select({ n: count() }).from(subscription).where(eq(subscription.status, "active")),
    db.select({ n: count() }).from(generation).where(gte(generation.createdAt, day)),
    db.select({ n: count() }).from(generation).where(and(gte(generation.createdAt, day), eq(generation.status, "failed"))),
    db
      .select({ total: sum(creditTransaction.delta) })
      .from(creditTransaction)
      .where(and(gte(creditTransaction.createdAt, day), lt(creditTransaction.delta, 0))),
    db.select().from(user).orderBy(desc(user.createdAt)).limit(6),
    db.select().from(payment).orderBy(desc(payment.createdAt)).limit(6),
    // 近 14 天每天的净收入（实付 − 已退），只用来画趋势图
    db
      .select({ day: payDay, net: sql<number>`coalesce(sum(${payment.amount} - ${payment.refundedAmount}), 0)::int` })
      .from(payment)
      .where(gte(payment.createdAt, since(CHART_DAYS)))
      .groupBy(payDay),
  ]);

  const gross = Number(revenue.gross ?? 0);
  const refunded = Number(revenue.refunded ?? 0);
  const netByDay = new Map(revenueRows.map((r) => [r.day, Number(r.net)]));
  const series = lastDays(CHART_DAYS).map((d) => netByDay.get(d) ?? 0);
  const href = (path: string) => localePath(lang, path);
  const usersHref = href("/admin/users");
  const plan = (id: string | null) => (id ? (dict.pricing.plans[id]?.name ?? id) : "—");

  // 待处理：「要处理」排前面，「关注」在后；数量为 0 的不显示
  const a = attention;
  const todo = [
    { n: a.pendingRefunds, label: t.attn.pendingRefunds, to: "/admin/refunds?status=pending", act: true },
    { n: a.manualRefunds, label: t.attn.manualRefunds, to: "/admin/refunds?status=processing", act: true },
    { n: a.issueErrors, label: t.attn.issueErrors, to: "/admin/reconciliation?severity=error", act: true },
    { n: a.disputes, label: t.attn.disputes, to: "/admin/payments?status=disputed&range=all", act: true },
    { n: a.failedJobs, label: t.attn.failedJobs, to: "/admin/jobs", act: true },
    { n: a.schedulerStale ? 1 : 0, label: t.attn.schedulerStale, to: "/admin/jobs", act: true },
    { n: a.configErrors, label: t.attn.configErrors, to: "/admin/system", act: true },
    { n: a.issueWarnings, label: t.attn.issueWarnings, to: "/admin/reconciliation?severity=warning", act: false },
    { n: a.aiFailedToday, label: t.attn.aiFailed, to: "/admin/ai?status=failed&range=today", act: false },
  ].filter((i) => i.n > 0);

  const stats = [
    { k: t.users, v: users.n.toLocaleString(), sub: t.usersToday.replace("{n}", String(users24h.n)), icon: Users, tone: "text-success-fg" },
    { k: t.activeSubs, v: activeSubs.n.toLocaleString(), sub: t.subscriptions, icon: CircleCheck, tone: "text-fg-3" },
    { k: t.aiCalls, v: gens24h.n.toLocaleString(), sub: t.failed.replace("{n}", String(failed24h.n)), icon: Bot, tone: failed24h.n ? "text-danger-fg" : "text-fg-3" },
    { k: t.creditsSpent, v: Math.abs(Number(spent24h.total ?? 0)).toLocaleString(), sub: t.credits, icon: Zap, tone: "text-fg-3" },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={
          <Link href={href("/admin/payments")} className="btn btn-secondary btn-sm">
            <ReceiptText className="size-3.5" /> {dict.admin.nav.payments}
          </Link>
        }
      />

      {todo.length === 0 ? (
        <Panel className="flex items-center gap-3 px-4 py-3">
          <CircleCheck className="size-4 shrink-0 text-success-fg" />
          <p className="text-sm">
            <span className="font-medium">{t.attn.allClear}</span> <span className="text-fg-3">{t.attn.allClearBody}</span>
          </p>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <PanelHead
            title={
              <>
                <TriangleAlert className="size-4 text-warning-fg" /> {t.attn.title}
              </>
            }
            count={todo.filter((i) => i.act).length || undefined}
          />
          <ul className="grid lg:grid-cols-2">
            {todo.map((i) => (
              <li key={i.label} className="border-b border-line/60 lg:odd:border-r">
                <Link href={href(i.to)} className="group flex items-center gap-3 px-4 py-3 text-[0.8125rem] transition hover:bg-canvas-2/60">
                  {i.act ? <TriangleAlert className="size-4 shrink-0 text-danger-fg" /> : <Eye className="size-4 shrink-0 text-fg-3" />}
                  <span className="min-w-0 flex-1">{i.label.replace("{n}", i.n.toLocaleString())}</span>
                  <span className={`tag shrink-0 ${i.act ? "tag-danger" : ""}`}>{i.act ? t.attn.act : t.attn.watch}</span>
                  <ChevronRight className="size-4 shrink-0 text-fg-3 transition group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr] [&>*]:min-w-0">
        <Panel className="flex flex-col gap-2 p-5 md:col-span-2 xl:col-span-1 xl:row-span-2">
          <p className="flex items-center justify-between text-xs text-fg-3">
            <span className="font-medium text-fg-2">{t.revenue}</span>
            <span>{t.allTime}</span>
          </p>
          <p className="text-[2.5rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">{formatPrice(gross - refunded)}</p>
          <p className="font-mono text-xs text-fg-3">
            {t.paidMinusRefunded.replace("{paid}", formatPrice(gross)).replace("{refunded}", formatPrice(refunded))}
          </p>
          <div className="mt-auto pt-4">
            <AreaChart id="rev" values={series} height={96} />
            <p className="mt-2 flex justify-between text-[0.6875rem] text-fg-3">
              <span>{t.daysAgo.replace("{n}", String(CHART_DAYS))}</span>
              <span>{t.today}</span>
            </p>
          </div>
        </Panel>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Panel key={s.k} className="flex flex-col gap-2.5 p-4">
              <p className="flex items-center justify-between text-xs text-fg-3">
                <span className="font-medium text-fg-2">{s.k}</span>
                <Icon className="size-4" />
              </p>
              <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">{s.v}</p>
              <p className={`text-xs ${s.tone}`}>{s.sub}</p>
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel className="overflow-hidden">
          <PanelHead
            title={t.newUsers}
            action={
              <Link href={usersHref} className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg">
                {t.allUsers} <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <ul>
            {recentUsers.map((u) => (
              <li key={u.id} className="border-b border-line/60 last:border-0">
                <Link href={`${usersHref}/${u.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[0.8125rem] transition hover:bg-canvas-2/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{u.email}</span>
                    <span className="block font-mono text-[0.6875rem] text-fg-3">{fmtTime(u.createdAt)}</span>
                  </span>
                  {!u.emailVerified && <StatusTag status="unverified">{dict.admin.users.status.unverified}</StatusTag>}
                  <span className="font-mono text-xs tabular-nums text-fg-2">{u.credits}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="overflow-hidden">
          <PanelHead
            title={t.recentPayments}
            action={
              <Link href={href("/admin/payments")} className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg">
                {t.allPayments} <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {recentPayments.length === 0 && <TableEmpty title={t.noPayments} />}
          <ul>
            {recentPayments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 text-[0.8125rem] last:border-0">
                <span className="min-w-0 flex-1">
                  <Link href={`${usersHref}/${p.userId}`} className="block truncate font-medium hover:underline">
                    {p.userEmail ?? p.userId}
                  </Link>
                  <span className="block font-mono text-[0.6875rem] text-fg-3">
                    {plan(p.planId)} · {p.provider} · {fmtTime(p.createdAt)}
                  </span>
                </span>
                <span className="font-mono tabular-nums">{formatPrice(p.amount, p.currency)}</span>
                <StatusTag status={p.status}>{dict.admin.statuses[p.status] ?? p.status}</StatusTag>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
