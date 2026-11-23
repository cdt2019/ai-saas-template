"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Repeat,
  RotateCcw,
  ScrollText,
  Bot,
  Coins,
  Mail,
  Stethoscope,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { siteConfig, type Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { authClient, useSession } from "@/lib/auth-client";
import { localePath } from "@/lib/paths";
import { usePulse } from "@/lib/pulse";
import { useAccountTier } from "@/lib/tier-client";
import { Logo, LogoMark } from "./Logo";
import { Dropdown } from "./Dropdown";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu, Avatar, TierBadge } from "./UserMenu";

export type AppShellLabels = Dictionary["app"] & {
  language: string;
  theme: string;
  menu: string;
  signIn: string;
  getStarted: string;
  signOut: string;
  credits: string;
  planNames: Record<string, string>;
  free: string;
  adminNav: Pick<Dictionary["admin"], "title" | "backToApp" | "groups" | "nav">;
  notifications: Dictionary["notifications"];
};

/** prefix：子页面也算当前（/admin/users/xxx 高亮「用户」） */
type Item = { href: string; label: string; icon: LucideIcon; match?: string; prefix?: boolean; badge?: number };

/** 收起 / 展开侧栏：状态挂在 <html data-sidebar>，配合 Tailwind 的 collapsed: 变体，刷新时由首屏脚本恢复 */
function toggleRail() {
  const root = document.documentElement;
  const collapsed = root.dataset.sidebar !== "collapsed";
  if (collapsed) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
  try {
    localStorage.setItem("sidebar", collapsed ? "collapsed" : "expanded");
  } catch {}
}

/**
 * 用户中心 / AI 工作台 / 管理后台共用的应用外壳：
 * 桌面端左侧栏（可收缩成图标栏）+ 右侧内容面板；手机上变成顶部栏，导航收进菜单。
 * 账单、用量、个人资料都在设置页，从左下角账号菜单进
 */
export function AppShell({ locale, labels, children }: { locale: Locale; labels: AppShellLabels; children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const user = session?.user;
  const tier = useAccountTier();
  // 积分、等级、未读数、后台待办都来自心跳轮询（/api/me/pulse），付款到账、退款、管理员调整后不用刷新页面
  const pulse = usePulse();

  // 去掉语言前缀，按与语言无关的路径判断当前页
  const prefix = `/${locale}`;
  const path = locale !== siteConfig.defaultLocale && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;
  const onAdmin = path === "/admin" || path.startsWith("/admin/");
  // 后台页面本身在服务端校验了管理员；入口按 /api/account/tier 返回的 isAdmin 显示（含 ADMIN_EMAILS 里的管理员）
  const isAdmin = tier?.isAdmin || user?.role === "admin";
  const A = labels.adminNav;

  const workspace: Item[] = [
    { href: "/dashboard", label: labels.overview, icon: LayoutDashboard, match: "/dashboard" },
    { href: "/studio", label: labels.studio, icon: Sparkles, match: "/studio" },
    { href: "/pricing", label: labels.pricing, icon: Tag },
  ];
  // 后台按模块分组：收入是日常要看的业务数据，系统是配置和排查用的（定时任务、支付日志）
  const adminGroups: { label: string; items: Item[] }[] = [
    { label: A.groups.overview, items: [{ href: "/admin", label: A.nav.overview, icon: LayoutDashboard, match: "/admin" }] },
    { label: A.groups.users, items: [{ href: "/admin/users", label: A.nav.users, icon: Users, match: "/admin/users", prefix: true }] },
    {
      label: A.groups.revenue,
      items: [
        { href: "/admin/payments", label: A.nav.payments, icon: ReceiptText, match: "/admin/payments" },
        { href: "/admin/subscriptions", label: A.nav.subscriptions, icon: Repeat, match: "/admin/subscriptions" },
        { href: "/admin/refunds", label: A.nav.refunds, icon: RotateCcw, match: "/admin/refunds", badge: pulse?.data?.admin?.pendingRefunds },
        { href: "/admin/reconciliation", label: A.nav.reconciliation, icon: ClipboardCheck, match: "/admin/reconciliation", badge: pulse?.data?.admin?.openIssues },
      ],
    },
    {
      label: A.groups.operations,
      items: [
        { href: "/admin/credits", label: A.nav.credits, icon: Coins, match: "/admin/credits" },
        { href: "/admin/ai", label: A.nav.ai, icon: Bot, match: "/admin/ai" },
        { href: "/admin/newsletter", label: A.nav.newsletter, icon: Mail, match: "/admin/newsletter" },
      ],
    },
    {
      label: A.groups.system,
      items: [
        { href: "/admin/jobs", label: A.nav.jobs, icon: Clock3, match: "/admin/jobs" },
        { href: "/admin/payment-log", label: A.nav.paymentLog, icon: ScrollText, match: "/admin/payment-log" },
        { href: "/admin/system", label: A.nav.system, icon: Stethoscope, match: "/admin/system" },
      ],
    },
  ];
  const isCurrent = (i: Item) => !!i.match && (path === i.match || (!!i.prefix && path.startsWith(`${i.match}/`)));
  const current = [
    ...adminGroups.flatMap((g) => g.items),
    ...workspace,
    { href: "/settings", label: labels.settings, icon: Settings2, match: "/settings" },
  ].find(isCurrent);
  const crumb = onAdmin ? A.title : labels.workspace;

  const menuLabels = { ...labels, dashboard: labels.overview };

  const signOut = async () => {
    await authClient.signOut();
    router.push(localePath(locale));
    router.refresh();
  };

  const groupLabel = (label: string, rail: boolean, first: boolean) => (
    <>
      <p className={`label-mono px-2.5 pb-1.5 ${first ? "" : "pt-5"} ${rail ? "collapsed:hidden" : ""}`}>{label}</p>
      {rail && !first && <span aria-hidden className="mx-3 my-2 hidden h-px bg-line collapsed:block" />}
    </>
  );

  /** rail：桌面侧栏里的那份，收起时只显示图标；手机菜单里的那份不受影响 */
  const nav = (rail: boolean) =>
    onAdmin ? (
      <nav className="grid gap-0.5">
        <NavLink item={{ href: "/dashboard", label: A.backToApp, icon: ArrowLeft }} locale={locale} current={false} rail={rail} />
        <span aria-hidden className="mx-2.5 my-3 h-px bg-line" />
        {adminGroups.map((g, gi) => (
          <div key={g.label} className="grid gap-0.5">
            {groupLabel(g.label, rail, gi === 0)}
            {g.items.map((i) => (
              <NavLink key={i.href} item={i} locale={locale} current={isCurrent(i)} rail={rail} />
            ))}
          </div>
        ))}
      </nav>
    ) : (
      <nav className="grid gap-0.5">
        {groupLabel(labels.workspace, rail, true)}
        {workspace.map((i) => (
          <NavLink key={i.href} item={i} locale={locale} current={isCurrent(i)} rail={rail} />
        ))}
        {isAdmin && (
          <>
            {groupLabel(labels.admin, rail, false)}
            <NavLink item={{ href: "/admin", label: A.title, icon: ShieldCheck }} locale={locale} current={false} rail={rail} />
          </>
        )}
      </nav>
    );

  const credits = (pulse?.data?.credits ?? user?.credits ?? 0).toLocaleString();
  const creditsCard = user && (
    <>
      <div className="hero-card p-3.5 collapsed:hidden">
        <div aria-hidden className="grid-fine absolute inset-0" />
        <p className="relative flex items-center justify-between">
          <span className="label-mono !text-white/80">{labels.credits}</span>
          <Zap className="size-3.5 text-white/80" />
        </p>
        <p className="relative mt-1.5 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{credits}</p>
        <Link href={localePath(locale, "/pricing")} className="btn btn-white btn-sm relative mt-3 w-full">
          {labels.getCredits}
        </Link>
      </div>
      {/* 收起时的积分：小方块，点了去买积分 */}
      <Link
        href={localePath(locale, "/pricing")}
        title={`${labels.credits} ${credits} · ${labels.getCredits}`}
        className="hero-card hidden flex-col items-center gap-0.5 rounded-xl py-2 collapsed:flex"
      >
        <Zap className="relative size-4" />
        <span className="relative font-mono text-[0.6875rem] font-semibold tabular-nums">{credits}</span>
      </Link>
    </>
  );

  const account = (rail: boolean) =>
    isPending ? (
      <div className="h-12 animate-pulse rounded-xl bg-canvas-2" />
    ) : user ? (
      <Dropdown
        side="top"
        align="left"
        className="w-full"
        panelClassName="w-full min-w-60"
        summaryClassName={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-surface/70 ${
          rail ? "collapsed:justify-center collapsed:px-0" : ""
        }`}
        summary={
          <>
            <Avatar name={user.name || user.email} image={user.image} size={32} />
            <span className={`min-w-0 flex-1 text-left ${rail ? "collapsed:hidden" : ""}`}>
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[0.8125rem] font-medium">{user.name}</span>
                <TierBadge tier={tier} labels={labels} />
              </span>
              <span className="block truncate text-xs text-fg-3">{user.email}</span>
            </span>
            <ChevronsUpDown className={`size-4 shrink-0 text-fg-3 ${rail ? "collapsed:hidden" : ""}`} />
          </>
        }
      >
        <AccountMenu user={user} locale={locale} labels={menuLabels} />
      </Dropdown>
    ) : (
      <div className={`grid gap-2 ${rail ? "collapsed:hidden" : ""}`}>
        <Link href={`${localePath(locale, "/login")}?next=${encodeURIComponent(pathname)}`} className="btn btn-secondary w-full">
          {labels.signIn}
        </Link>
        <Link href={localePath(locale, "/signup")} className="btn btn-brand w-full">
          {labels.getStarted}
        </Link>
      </div>
    );

  return (
    // 后台是数据页：平铺布局（侧栏贴边、内容区不做悬浮圆角面板）；工作台保留悬浮面板
    <div className={`min-h-dvh bg-canvas lg:flex ${onAdmin ? "" : "lg:gap-2 lg:p-2"}`}>
      {/* 桌面端侧栏：展开 248px，收起 64px 只剩图标 */}
      <aside
        className={`sticky hidden w-[248px] shrink-0 flex-col gap-5 transition-[width] duration-200 lg:flex collapsed:w-16 ${
          onAdmin ? "top-0 h-dvh border-r border-line px-2.5 py-3.5" : "top-2 h-[calc(100dvh-1rem)] px-1.5 py-2.5"
        }`}
      >
        <Link href={localePath(locale)} className="flex items-center gap-2.5 px-2 pt-1 collapsed:justify-center collapsed:px-0" aria-label="Home">
          <LogoMark />
          <span className="truncate text-[1.02rem] font-semibold tracking-[-0.02em] collapsed:hidden">{siteConfig.name}</span>
        </Link>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{nav(true)}</div>
        {!onAdmin && creditsCard}
        {account(true)}
      </aside>

      <div
        className={`flex min-w-0 flex-1 flex-col ${
          onAdmin
            ? "lg:bg-surface"
            : "lg:rounded-[1.15rem] lg:border lg:border-line lg:bg-surface lg:shadow-[0_1px_2px_rgb(var(--shadow)/0.05),inset_0_1px_0_var(--highlight)]"
        }`}
      >
        <header
          className={`sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-xl sm:px-6 lg:static lg:h-[3.75rem] lg:bg-transparent lg:backdrop-blur-none ${
            onAdmin ? "" : "lg:rounded-t-[1.15rem]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Link href={localePath(locale)} className="lg:hidden" aria-label="Home">
              <Logo size={26} className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
            </Link>
            <button
              type="button"
              onClick={toggleRail}
              aria-label={labels.toggleSidebar}
              title={labels.toggleSidebar}
              className="icon-btn -ml-2 hidden size-8 border-transparent shadow-none lg:inline-grid"
            >
              <PanelLeftClose className="size-4 collapsed:hidden" />
              <PanelLeftOpen className="hidden size-4 collapsed:block" />
            </button>
            <p className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-fg-3">
              <span className="hidden sm:inline">{crumb}</span>
              <ChevronRight className="hidden size-3.5 sm:block" />
              <span className="truncate font-medium text-fg">{current?.label ?? labels.overview}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {user && <NotificationBell locale={locale} labels={labels.notifications} planNames={labels.planNames} />}
            <div className="hidden items-center gap-1.5 sm:flex">
              <LocaleSwitcher current={locale} label={labels.language} />
              <ThemeToggle label={labels.theme} />
            </div>
            {user && !onAdmin && (
              <Link href={localePath(locale, "/pricing")} className="btn btn-primary btn-sm h-9">
                <Zap className="size-3.5" />
                <span className="font-mono tabular-nums lg:hidden">{credits}</span>
                <span className="hidden lg:inline">{labels.getCredits}</span>
              </Link>
            )}
            <Dropdown
              label={labels.menu}
              className="lg:hidden"
              summaryClassName="icon-btn"
              panelClassName="w-[min(18rem,calc(100vw-1.5rem))] p-2"
              summary={<Menu className="size-4" />}
            >
              {nav(false)}
              <div className="mt-3 flex items-center gap-2 border-t border-line px-1 pt-3 sm:hidden">
                <LocaleSwitcher current={locale} label={labels.language} align="left" side="top" />
                <ThemeToggle label={labels.theme} />
              </div>
              <div className="mt-3 border-t border-line pt-3">
                {user ? (
                  <button type="button" data-close onClick={signOut} className="nav-item w-full">
                    <LogOut className="size-4" /> {labels.signOut}
                  </button>
                ) : (
                  account(false)
                )}
              </div>
            </Dropdown>
          </div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({ item, locale, current, rail }: { item: Item; locale: Locale; current: boolean; rail: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={localePath(locale, item.href)}
      aria-current={current ? "page" : undefined}
      title={rail ? item.label : undefined}
      className={`nav-item ${rail ? "collapsed:justify-center collapsed:px-0" : ""}`}
    >
      <Icon className={`size-4 shrink-0 ${current ? "text-brand" : ""}`} />
      <span className={`truncate ${rail ? "collapsed:hidden" : ""}`}>{item.label}</span>
      {!!item.badge && <span className={`tag tag-warning ml-auto tabular-nums ${rail ? "collapsed:hidden" : ""}`}>{item.badge}</span>}
    </Link>
  );
}
