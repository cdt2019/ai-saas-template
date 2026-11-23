import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowRight, ChevronRight, CircleCheck, Clock, Film, ImageIcon, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import { getDb, schema } from "@/db";
import { getAiFeature } from "@/config/ai";
import { formatPrice, getPlan } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { getAdminSession } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { localePath } from "@/lib/paths";
import { PaymentPending } from "@/components/account/PaymentPending";
import { reconcileOnReturn } from "@/lib/payments/reconcile";
import { getAccountTier } from "@/lib/tier";
import { getUsage } from "@/lib/usage";
import { Bezel, PageHeader, StatusBadge, TickMeter } from "@/components/ui";
import { fmtDate, UsageHeatmap } from "@/components/account/AccountViews";
import { SpendDemo } from "@/components/account/ClientActions";

/** 依赖登录状态 / 查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/dashboard">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { account } = await getDictionary(lang);
  return { title: account.dashboard, robots: { index: false } };
}

const DAY = 86_400_000;
/** 本期已过去的比例（订阅只存了到期时间，按方案周期倒推开始时间） */
const periodElapsed = (end: Date | null | undefined, days: number) => (end ? 1 - (end.getTime() - Date.now()) / (days * DAY) : 0);

/**
 * 用户中心概览：积分、套餐、近 28 天用量三张卡片 + AI 工具入口。
 * 订单和退款在 设置 → 账单，用量明细和积分记录在 设置 → 用量，个人资料在 设置 → 账号
 */
export default async function DashboardPage({ params, searchParams }: PageProps<"/[lang]/dashboard">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  // proxy 只做了 cookie 的乐观检查，这里在服务端再确认一次
  const session = await getSession();
  if (!session) redirect(`${localePath(lang, "/login")}?next=${encodeURIComponent(localePath(lang, "/dashboard"))}`);

  const dict = await getDictionary(lang);
  const t = dict.account;
  const { paid } = await searchParams;
  const db = await getDb();
  const userId = session.user.id;
  // 付完跳回来时回调可能还没到（或者丢了）：订单还是 pending 就主动去支付平台查一次，付了当场补单（幂等，和回调不会重复发）
  if (typeof paid === "string") await reconcileOnReturn(paid, userId);

  const [[me], tier, [paidOrder], usage, admin] = await Promise.all([
    db.select({ credits: schema.user.credits, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)),
    // 账户等级：订阅 / 积分包 / 免费
    getAccountTier(userId),
    typeof paid === "string"
      ? db
          .select({ status: schema.order.status })
          .from(schema.order)
          .where(and(eq(schema.order.id, paid), eq(schema.order.userId, userId)))
      : Promise.resolve([]),
    getUsage(userId),
    // 管理员（含 ADMIN_EMAILS 里已验证的邮箱）在这里看到后台入口；侧栏只能按 role 判断
    getAdminSession(),
  ]);

  const activeSub = tier.kind === "subscription" ? tier.subscription : null;
  const pack = tier.kind === "pack" ? tier : null;
  const planName = tier.planId ? (dict.pricing.plans[tier.planId]?.name ?? tier.planId) : t.free;
  const activePlan = activeSub ? getPlan(activeSub.planId) : undefined;
  const elapsed = periodElapsed(activeSub?.currentPeriodEnd, activePlan?.interval === "year" ? 365 : 30);
  const name = me?.name ?? session.user.name;
  const billingHref = `${localePath(lang, "/settings")}?tab=billing`;
  const tools = [
    { tab: "text", icon: PenLine, cost: getAiFeature("rewrite")?.cost ?? 1 },
    { tab: "image", icon: ImageIcon, cost: getAiFeature("image")?.cost ?? 5 },
    { tab: "video", icon: Film, cost: getAiFeature("video")?.cost ?? 50 },
  ];

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <PageHeader
        title={`${t.hello}, ${name}`}
        lead={t.lead}
        actions={
          <>
            {admin && (
              <Link href={localePath(lang, "/admin")} className="btn btn-secondary btn-sm">
                <ShieldCheck className="size-3.5" /> {dict.app.admin}
              </Link>
            )}
            <Link href={localePath(lang, "/studio")} className="btn btn-secondary btn-sm">
              <Sparkles className="size-3.5" /> {dict.app.studio}
            </Link>
          </>
        }
      />

      {/* 还没确认的订单：前端每 2 秒追问一次，到账自动变成「支付成功」，不用手动刷新 */}
      {paidOrder && paidOrder.status === "pending" && typeof paid === "string" && (
        <PaymentPending orderId={paid} pending={t.pendingBanner} slow={t.pendingSlow} />
      )}
      {paidOrder && paidOrder.status !== "pending" && (
        <div
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
            paidOrder.status === "paid"
              ? "border-success/30 bg-success-soft text-success-fg"
              : "border-warning/30 bg-warning-soft text-warning-fg"
          }`}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current/20 bg-surface">
            {paidOrder.status === "paid" ? <CircleCheck className="size-4" /> : <Clock className="size-4" />}
          </span>
          <p>{paidOrder.status === "paid" ? t.paidBanner : t.pendingBanner}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr_1fr] [&>*]:min-w-0">
        {/* 积分 */}
        <div className="hero-card flex flex-col gap-5 p-6">
          <div aria-hidden className="grid-fine absolute inset-0" />
          <div className="relative flex items-center justify-between gap-3">
            <span className="label-mono !text-white/80">
              {t.credits} · {t.available}
            </span>
            <span className="badge badge-plain border border-white/25 bg-white/15 text-white">{t.neverExpire}</span>
          </div>
          <p className="relative text-[clamp(3rem,6vw,4rem)] leading-none font-semibold tracking-[-0.055em] tabular-nums">
            {(me?.credits ?? 0).toLocaleString()}
          </p>
          <div className="relative mt-auto flex flex-wrap items-center gap-2">
            <Link href={localePath(lang, "/pricing")} className="btn btn-white btn-sm">
              {t.buyMore} <ArrowRight className="size-3.5" />
            </Link>
            <SpendDemo t={t} />
          </div>
        </div>

        {/* 套餐：管理、订单、退款都在 设置 → 账单 */}
        <Bezel innerClassName="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="label-mono">{t.plan}</span>
            {activeSub && <StatusBadge status={activeSub.status} />}
            {pack && <span className="badge badge-brand badge-plain">{t.pack}</span>}
          </div>
          <p className="flex items-baseline gap-2.5">
            <span className="text-[2rem] leading-none font-semibold tracking-[-0.04em]">{planName}</span>
            {activePlan && (
              <span className="font-mono text-xs text-fg-3">
                {formatPrice(activePlan.price, activePlan.currency)} {activePlan.interval === "year" ? dict.pricing.perYear : dict.pricing.perMonth}
              </span>
            )}
          </p>
          {activeSub ? (
            <div className="space-y-2">
              <TickMeter value={elapsed} count={30} fill="bg-brand-1" />
              <p className="text-xs text-fg-3">
                {activeSub.cancelAtPeriodEnd ? t.cancels : t.renews}: {fmtDate(activeSub.currentPeriodEnd, lang)}
              </p>
            </div>
          ) : pack ? (
            <p className="text-sm leading-relaxed text-fg-2">
              {dict.pricing.plans[pack.planId]?.desc}
              <span className="mt-1 block text-xs text-fg-3">
                {t.lastPurchase} · {fmtDate(pack.purchasedAt, lang)}
              </span>
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-fg-2">{t.freeLead}</p>
          )}
          <div className="mt-auto flex flex-wrap gap-2">
            <Link href={billingHref} className="btn btn-secondary btn-sm">
              {t.viewBilling} <ChevronRight className="size-3.5" />
            </Link>
            {!activeSub && (
              <Link href={localePath(lang, "/pricing")} className="btn btn-brand btn-sm">
                {dict.app.upgrade}
              </Link>
            )}
          </div>
        </Bezel>

        {/* 用量：明细和积分记录在 设置 → 用量 */}
        <Bezel innerClassName="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="label-mono">{t.usage}</span>
            <span className="font-mono text-xs text-fg-3">{t.usageUsed.replace("{n}", usage.total.toLocaleString())}</span>
          </div>
          <UsageHeatmap days={usage.days} />
          <Link href={`${localePath(lang, "/settings")}?tab=usage`} className="btn btn-secondary btn-sm mt-auto w-fit">
            {t.viewUsage} <ChevronRight className="size-3.5" />
          </Link>
        </Bezel>
      </div>

      {/* AI 工具入口 */}
      <section>
        <h2 className="label-mono mb-3">{t.quickStart}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {tools.map(({ tab, icon: Icon, cost }) => (
            <Link
              key={tab}
              href={`${localePath(lang, "/studio")}?tab=${tab}`}
              className="group bezel transition hover:border-line-2"
            >
              <span className="card flex items-center gap-4 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-brand">
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{dict.studio.tabs[tab]}</span>
                  <span className="block font-mono text-xs text-fg-3">
                    {cost} {cost === 1 ? dict.studio.costOne : dict.studio.cost}
                  </span>
                </span>
                <ChevronRight className="size-4 text-fg-3 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
