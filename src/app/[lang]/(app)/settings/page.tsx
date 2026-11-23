import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowRight, Bell, ChartColumn, CreditCard, Mail, Settings2, Sparkles, UserRound, Zap } from "lucide-react";
import { getDb, schema } from "@/db";
import { formatPrice, getPlan } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { getAuth, getSession } from "@/lib/auth";
import { getCreditHistoryPage } from "@/lib/credit-history";
import { renderNotification } from "@/lib/notification-text";
import { listNotifications } from "@/lib/notify";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { supportsPortal } from "@/lib/payments";
import { listRefundables } from "@/lib/payments/refunds";
import { getAccountTier } from "@/lib/tier";
import { getUsage } from "@/lib/usage";
import { PageHeader, StatusBadge } from "@/components/ui";
import { Avatar } from "@/components/UserMenu";
import { GitHubIcon, GoogleIcon } from "@/components/icons";
import { LanguageSelect, ThemeSelect } from "@/components/account/Preferences";
import { fmtDate, OrdersTable, RefundEntry, UsageHeatmap } from "@/components/account/AccountViews";
import { CreditHistoryFeed } from "@/components/account/CreditHistoryFeed";
import { MarkAllRead } from "@/components/account/MarkAllRead";
import { StatusTabs } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { listUserOrders, USER_ORDER_FILTERS } from "@/lib/account-lists";
import { NotificationIcon } from "@/components/NotificationBell";
import { ChangePasswordForm, ManageSubscriptionButton, ProfileForm, SignOutButton } from "@/components/account/ClientActions";

/** 依赖登录状态 / 查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/settings">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { settings } = await getDictionary(lang);
  return { title: settings.title, robots: { index: false } };
}

const TABS = [
  { id: "general", icon: Settings2 },
  { id: "account", icon: UserRound },
  { id: "billing", icon: CreditCard },
  { id: "usage", icon: ChartColumn },
  { id: "notifications", icon: Bell },
] as const;
type Tab = (typeof TABS)[number]["id"];

const PROVIDERS: Record<string, { name: string; icon: ReactNode }> = {
  google: { name: "Google", icon: <GoogleIcon className="size-4" /> },
  github: { name: "GitHub", icon: <GitHubIcon className="size-4" /> },
};

/** 一行设置：左边标题 + 说明，右边控件；手机上上下排 */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line py-5 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[0.8125rem] text-fg-3">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="[&+&]:mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * 设置页（参考 Claude 的设置弹窗）：左侧分类、右侧一行一项。
 * 通用：主题、语言；账号：昵称、邮箱、登录方式、密码、退出；
 * 账单：套餐、积分、订单（含申请退款）；用量：近 28 天用量、积分记录
 */
export default async function SettingsPage({ params, searchParams }: PageProps<"/[lang]/settings">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const session = await getSession();
  if (!session) redirect(`${localePath(lang, "/login")}?next=${encodeURIComponent(localePath(lang, "/settings"))}`);

  const sp = await searchParams;
  const rawTab = sp.tab;
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "general";
  const dict = await getDictionary(lang);
  const t = dict.settings;
  const a = dict.account;
  const planNames = Object.fromEntries(Object.entries(dict.pricing.plans).map(([id, p]) => [id, p.name]));
  const userId = session.user.id;
  const db = await getDb();

  // 每个分类只查自己要的数据
  const notifyPage = parseTableQuery(sp, { filters: { view: ["unread"] } });
  const orderPage = parseTableQuery(sp, { filters: USER_ORDER_FILTERS });
  const orderFiltered = !!(orderPage.filters.status || orderPage.from || orderPage.to);
  const [[me], [sub], accounts, orders, refundables, usage, history, tier, notices] = await Promise.all([
    db.select({ name: schema.user.name, credits: schema.user.credits }).from(schema.user).where(eq(schema.user.id, userId)),
    tab === "billing"
      ? db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId)).orderBy(desc(schema.subscription.createdAt)).limit(1)
      : Promise.resolve([]),
    tab === "account" ? getAuth().then(async (auth) => auth.api.listUserAccounts({ headers: await headers() })) : Promise.resolve([]),
    tab === "billing" ? listUserOrders(userId, orderPage) : Promise.resolve({ rows: [], total: 0 }),
    tab === "billing" ? listRefundables(userId) : Promise.resolve([]),
    tab === "usage" ? getUsage(userId) : Promise.resolve(null),
    tab === "usage" ? getCreditHistoryPage(userId) : Promise.resolve(null),
    tab === "billing" ? getAccountTier(userId) : Promise.resolve(null),
    tab === "notifications" ? listNotifications(userId, notifyPage) : Promise.resolve(null),
  ]);
  const name = me?.name ?? session.user.name;
  const providerIds = accounts.map((acc) => acc.providerId);
  const hasPassword = providerIds.includes("credential");
  const socials = providerIds.filter((p) => p !== "credential");
  const activeSub = sub && sub.status === "active" ? sub : null;
  // 没有订阅但买过积分包：按积分包显示等级（Starter pack），不是 Free
  const pack = !activeSub && tier?.kind === "pack" ? tier : null;
  const tierPlanId = activeSub?.planId ?? pack?.planId;
  const plan = tierPlanId ? getPlan(tierPlanId) : undefined;
  const planName = tierPlanId
    ? `${dict.pricing.plans[tierPlanId]?.name ?? tierPlanId} ${activeSub ? t.planSuffix : t.packSuffix}`.trim()
    : t.freePlan;
  const planUnit = plan?.mode === "subscription" ? (plan.interval === "year" ? dict.pricing.perYear : dict.pricing.perMonth) : dict.pricing.oneTime;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader title={t.title} lead={t.lead} />

      <div className="bezel">
        <div className="card grid overflow-hidden md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="flex gap-1 overflow-x-auto border-b border-line p-2 md:flex-col md:border-r md:border-b-0 md:p-3 [scrollbar-width:none]">
            {TABS.map(({ id, icon: Icon }) => (
              <Link
                key={id}
                href={`${localePath(lang, "/settings")}?tab=${id}`}
                aria-current={tab === id ? "page" : undefined}
                className="nav-item shrink-0"
              >
                <Icon className={`size-4 ${tab === id ? "text-brand" : ""}`} />
                {t.nav[id]}
              </Link>
            ))}
          </nav>

          <div className="min-w-0 px-5 py-6 sm:px-8 sm:py-8">
            {tab === "general" && (
              <Section title={t.appearance}>
                <Row label={t.theme} hint={t.themeHint}>
                  <ThemeSelect labels={t.themes} />
                </Row>
                <Row label={t.language} hint={t.languageHint}>
                  <LanguageSelect current={lang} label={t.language} />
                </Row>
              </Section>
            )}

            {tab === "account" && (
              <>
                <Section title={t.profile}>
                  <div className="flex items-center gap-4 border-b border-line py-5">
                    <Avatar name={name || session.user.email} image={session.user.image} size={48} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{name}</p>
                      <p className="truncate text-sm text-fg-3">{session.user.email}</p>
                    </div>
                  </div>
                  <Row label={t.name} hint={t.nameHint}>
                    <div className="w-full sm:w-80">
                      <ProfileForm name={name} t={a} />
                    </div>
                  </Row>
                  <Row label={t.email} hint={t.emailHint}>
                    <span className="text-sm text-fg-2">{session.user.email}</span>
                    {session.user.emailVerified ? (
                      <span className="badge badge-success">{t.verified}</span>
                    ) : (
                      <span className="badge badge-neutral">{t.unverified}</span>
                    )}
                  </Row>
                  <Row label={t.methods} hint={t.methodsHint}>
                    {hasPassword && (
                      <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-[0.8125rem]">
                        <Mail className="size-4 text-fg-3" /> {t.emailPassword}
                      </span>
                    )}
                    {socials.map((p) => (
                      <span key={p} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-[0.8125rem]">
                        {PROVIDERS[p]?.icon} {PROVIDERS[p]?.name ?? p}
                        <span className="badge badge-success badge-plain h-5">{t.connected}</span>
                      </span>
                    ))}
                  </Row>
                </Section>

                <Section title={t.password}>
                  {hasPassword ? (
                    <div className="py-5">
                      <p className="mb-4 text-[0.8125rem] text-fg-3">{t.passwordHint}</p>
                      <div className="max-w-xl">
                        <ChangePasswordForm t={a} auth={dict.auth} />
                      </div>
                    </div>
                  ) : (
                    <p className="py-5 text-sm text-fg-2">
                      {t.noPassword.replace("{providers}", socials.map((p) => PROVIDERS[p]?.name ?? p).join(" / "))}
                    </p>
                  )}
                </Section>

                <Section title={t.session}>
                  <Row label={dict.auth.signOut} hint={t.sessionHint}>
                    <SignOutButton label={dict.auth.signOut} locale={lang} />
                  </Row>
                </Section>
              </>
            )}

            {tab === "billing" && (
              <>
                {/* 套餐：参考 Claude 账单页，图标 + 名称 + 说明 + 续费日期，右边调整 / 管理 */}
                <div className="flex flex-col gap-5 border-b border-line pb-7 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-4">
                    <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-[0_12px_28px_-12px_var(--glow-1),inset_0_1px_0_rgb(255_255_255/0.35)]">
                      <Sparkles className="size-6" />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
                        {planName}
                        {activeSub && <StatusBadge status={activeSub.status} />}
                        {pack && <span className="badge badge-brand badge-plain">{a.pack}</span>}
                      </p>
                      <p className="text-sm text-fg-2">
                        {tierPlanId ? (dict.pricing.plans[tierPlanId]?.desc ?? "") : a.freeLead}
                        {plan && (
                          <span className="ml-2 font-mono text-xs text-fg-3">
                            {formatPrice(plan.price, plan.currency)} {planUnit}
                          </span>
                        )}
                      </p>
                      {activeSub && (
                        <p className="text-[0.8125rem] text-fg-3">
                          {(activeSub.cancelAtPeriodEnd ? t.endsOn : t.renewsOn).replace("{date}", fmtDate(activeSub.currentPeriodEnd, lang))}
                        </p>
                      )}
                      {pack && <p className="text-[0.8125rem] text-fg-3">{t.purchasedOn.replace("{date}", fmtDate(pack.purchasedAt, lang))}</p>}
                      {/* 订阅只退当期，入口挂在套餐上 */}
                      {sub && <RefundEntry item={refundables.find((i) => i.payment.providerSubId === sub.providerSubId)} t={a} />}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {activeSub && supportsPortal(activeSub.provider) && <ManageSubscriptionButton label={a.manage} />}
                    <Link href={localePath(lang, "/pricing")} className={`btn btn-sm ${activeSub ? "btn-secondary" : "btn-brand"}`}>
                      {activeSub ? t.adjustPlan : dict.app.upgrade}
                    </Link>
                  </div>
                </div>

                <Row label={t.credits} hint={t.creditsHint}>
                  <span className="flex items-center gap-1.5 font-mono text-lg font-semibold tabular-nums">
                    <Zap className="size-4 text-brand" /> {(me?.credits ?? 0).toLocaleString()}
                  </span>
                  <Link href={localePath(lang, "/pricing")} className="btn btn-secondary btn-sm">
                    {a.buyMore} <ArrowRight className="size-3.5" />
                  </Link>
                </Row>

                <section className="mt-8">
                  <h2 className="text-lg font-semibold tracking-[-0.02em]">{t.orders}</h2>
                  <div className="mt-3 overflow-hidden rounded-xl border border-line">
                    {(orders.total > 0 || orderFiltered) && (
                      <div className="border-b border-line p-3">
                        <TableToolbar
                          anyLabel={dict.admin.users.any}
                          clearLabel={dict.admin.table.clear}
                          dates={dict.admin.table.dates}
                          filters={[{ key: "status", label: a.status, options: USER_ORDER_FILTERS.status.map((v) => ({ value: v, label: dict.admin.statuses[v] ?? v })) }]}
                        />
                      </div>
                    )}
                    <OrdersTable orders={orders.rows} refundables={refundables} dict={dict} lang={lang} />
                    {orders.total > 0 && (
                      <div className="border-t border-line px-3 py-2.5">
                        <Pagination total={orders.total} page={orderPage.page} size={orderPage.size} labels={dict.admin.table} />
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {tab === "usage" && usage && (
              <>
                <Section title={t.nav.usage}>
                  <p className="text-[0.8125rem] text-fg-3">{t.usageLead}</p>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-md">
                    <div className="rounded-xl border border-line bg-surface-2 p-4">
                      <p className="label-mono">{t.credits}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{(me?.credits ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-2 p-4">
                      <p className="label-mono">{t.usedTotal}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{usage.total.toLocaleString()}</p>
                    </div>
                  </div>
                  <UsageHeatmap days={usage.days} cols={14} className="mt-6 max-w-2xl" />
                  <p className="mt-3 flex items-center justify-between text-xs text-fg-3 sm:max-w-2xl">
                    <span>{a.usageHint}</span>
                    <span className="flex items-center gap-1">
                      <span className="size-3 rounded-[3px] bg-viz-muted" />
                      <span className="size-3 rounded-[3px] bg-brand-1/30" />
                      <span className="size-3 rounded-[3px] bg-brand-1/55" />
                      <span className="size-3 rounded-[3px] bg-brand-1/80" />
                      <span className="size-3 rounded-[3px] bg-brand-2" />
                    </span>
                  </p>
                </Section>

                <Section title={t.history}>
                  <div className="mt-3 overflow-hidden rounded-xl border border-line">
                    <CreditHistoryFeed
                      initial={history?.items ?? []}
                      next={history?.next ?? null}
                      t={a}
                      features={{ rewrite: dict.studio.tabs.text, image: dict.studio.tabs.image, video: dict.studio.tabs.video }}
                    />
                  </div>
                </Section>
              </>
            )}

            {tab === "notifications" && notices && (
              <Section
                title={t.nav.notifications}
                aside={<MarkAllRead label={dict.notifications.markAllRead} disabled={notices.unread === 0} />}
              >
                {notices.all > 0 && (
                  <div className="mt-3">
                    <StatusTabs
                      pathname={localePath(lang, "/settings")}
                      sp={sp}
                      param="view"
                      current={notifyPage.filters.view ?? ""}
                      items={[
                        { value: "", label: dict.admin.users.any, count: notices.all },
                        { value: "unread", label: dict.notifications.unread, count: notices.unread },
                      ]}
                    />
                  </div>
                )}
                {notices.total === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-line px-6 py-10 text-center">
                    <p className="text-sm font-medium">{dict.notifications.empty}</p>
                    <p className="mt-1 text-[0.8125rem] text-fg-3">{dict.notifications.emptyBody}</p>
                  </div>
                ) : (
                  <div className="mt-4 overflow-hidden rounded-xl border border-line">
                    <ul className="divide-y divide-line">
                      {notices.rows.map((n) => {
                        const { title, body } = renderNotification(n, dict.notifications, planNames, lang);
                        const inner = (
                          <>
                            <span
                              className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${n.read ? "bg-canvas-2 text-fg-3" : "bg-brand-soft text-brand"}`}
                            >
                              <NotificationIcon type={n.type} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-sm ${n.read ? "text-fg-2" : "font-semibold"}`}>{title}</span>
                              {body && <span className="mt-0.5 block text-[0.8125rem] [overflow-wrap:anywhere] text-fg-3">{body}</span>}
                              {/* 手机上时间放到正文下面，不占一列 */}
                              <span className="mt-1 block font-mono text-xs text-fg-3 sm:hidden">{fmtTime(n.createdAt, lang)}</span>
                            </span>
                            <span className="hidden shrink-0 text-right sm:block">
                              <span className="block font-mono text-xs text-fg-3">{fmtTime(n.createdAt, lang)}</span>
                              {!n.read && <span className="mt-1 inline-block size-2 rounded-full bg-brand" aria-label={dict.notifications.unread} />}
                            </span>
                          </>
                        );
                        return (
                          <li key={n.id}>
                            {n.link ? (
                              <Link href={localePath(lang, n.link)} className="flex gap-3 px-4 py-3 transition hover:bg-canvas-2/50">
                                {inner}
                              </Link>
                            ) : (
                              <div className="flex gap-3 px-4 py-3">{inner}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="border-t border-line px-3 py-2.5">
                      <Pagination total={notices.total} page={notifyPage.page} size={notifyPage.size} labels={dict.admin.table} />
                    </div>
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 通知时间：按用户的语言显示，精确到秒 */
const fmtTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));
