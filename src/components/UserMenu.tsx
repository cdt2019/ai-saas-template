"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartColumn, CircleArrowUp, CreditCard, House, LayoutDashboard, LogOut, Settings, ShieldCheck, Sparkles } from "lucide-react";
import type { Locale } from "@/config/site";
import { authClient, useSession } from "@/lib/auth-client";
import { localePath } from "@/lib/paths";
import { tierLabel, useAccountTier, type TierInfo } from "@/lib/tier-client";
import { Dropdown } from "./Dropdown";

export type UserMenuLabels = {
  signIn: string;
  getStarted: string;
  dashboard: string;
  studio: string;
  admin: string;
  signOut: string;
  credits: string;
  upgrade: string;
  settings: string;
  billing: string;
  usage: string;
  homepage: string;
  /** 方案 id → 显示名（账户等级用）、免费版的叫法 */
  planNames: Record<string, string>;
  free: string;
};

type SessionUser = { name: string; email: string; image?: string | null; role?: string | null; credits?: number | null };

/** 头像：有第三方头像用头像，否则用首字母 */
export function Avatar({ name, image, size = 32 }: { name: string; image?: string | null; size?: number }) {
  if (image)
    return (
      // 第三方头像域名不固定，用原生 img
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    );
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** 账户等级小标签：订阅 / 积分包用品牌色，免费版用灰色；还没查到时不显示 */
export function TierBadge({ tier, labels }: { tier: TierInfo | null; labels: Pick<UserMenuLabels, "planNames" | "free"> }) {
  const label = tierLabel(tier, labels);
  if (!label) return null;
  return <span className={`badge badge-plain h-5 shrink-0 ${tier?.planId ? "badge-brand" : "badge-neutral"}`}>{label}</span>;
}

/**
 * 账号菜单的内容（页头头像下拉、应用侧栏底部共用）：
 * 头像 + 名字 + 邮箱，升级套餐 / 设置 / 账单 / 用量 / 首页，退出
 * extra：放在「升级套餐」前面的额外入口（页头里放用户中心、AI 工作台）
 */
export function AccountMenu({
  user,
  locale,
  labels,
  extra,
  showHome = true,
}: {
  user: SessionUser;
  locale: Locale;
  labels: UserMenuLabels;
  extra?: React.ReactNode;
  showHome?: boolean;
}) {
  const router = useRouter();
  const tier = useAccountTier();
  const name = user.name || user.email;
  const signOut = async () => {
    await authClient.signOut();
    router.push(localePath(locale));
    router.refresh();
  };
  return (
    <>
      <div className="flex items-center gap-3 px-2.5 py-2.5">
        <Avatar name={name} image={user.image} size={36} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{user.name}</span>
            <TierBadge tier={tier} labels={labels} />
          </p>
          <p className="truncate text-xs text-fg-3">{user.email}</p>
        </div>
      </div>
      {extra && <div className="border-t border-line py-1">{extra}</div>}
      <div className="border-t border-line py-1">
        <Link href={localePath(locale, "/pricing")} className="nav-item">
          <CircleArrowUp className="size-4" /> {labels.upgrade}
        </Link>
        <Link href={localePath(locale, "/settings")} className="nav-item">
          <Settings className="size-4" /> {labels.settings}
        </Link>
        <Link href={`${localePath(locale, "/settings")}?tab=billing`} className="nav-item">
          <CreditCard className="size-4" /> {labels.billing}
        </Link>
        <Link href={`${localePath(locale, "/settings")}?tab=usage`} className="nav-item">
          <ChartColumn className="size-4" /> {labels.usage}
        </Link>
        {(tier?.isAdmin || user.role === "admin") && (
          <Link href={localePath(locale, "/admin")} className="nav-item">
            <ShieldCheck className="size-4" /> {labels.admin}
          </Link>
        )}
        {showHome && (
          <Link href={localePath(locale)} className="nav-item">
            <House className="size-4" /> {labels.homepage}
          </Link>
        )}
      </div>
      <div className="border-t border-line pt-1">
        <button type="button" data-close onClick={signOut} className="nav-item w-full">
          <LogOut className="size-4" /> {labels.signOut}
        </button>
      </div>
    </>
  );
}

/** 手机菜单底部的按钮：未登录「登录」，已登录「用户中心」 */
export function AuthLink({ locale, labels }: { locale: Locale; labels: Pick<UserMenuLabels, "signIn" | "dashboard"> }) {
  const { data: session } = useSession();
  return (
    <Link href={localePath(locale, session ? "/dashboard" : "/login")} className="btn btn-secondary btn-sm ml-auto">
      {session ? labels.dashboard : labels.signIn}
    </Link>
  );
}

/** 页头右上角：未登录显示「登录 / 免费开始」，已登录显示头像 + 积分 + 账号菜单 */
export function UserMenu({ locale, labels }: { locale: Locale; labels: UserMenuLabels }) {
  const { data: session, isPending } = useSession();

  if (isPending) return <span className="h-9 w-24 animate-pulse rounded-full bg-canvas-2" aria-hidden />;

  if (!session)
    return (
      <div className="flex items-center gap-1.5">
        <Link href={localePath(locale, "/login")} className="btn btn-ghost hidden sm:inline-flex">
          {labels.signIn}
        </Link>
        <Link href={localePath(locale, "/signup")} className="btn btn-brand btn-sm h-9 rounded-full px-4">
          {labels.getStarted}
        </Link>
      </div>
    );

  const { user } = session;
  return (
    <Dropdown
      label={labels.dashboard}
      panelClassName="w-64"
      summaryClassName="flex h-9 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 shadow-sm transition hover:border-line-2"
      summary={
        <>
          <Avatar name={user.name || user.email} image={user.image} size={28} />
          <span className="font-mono text-xs tabular-nums">{(user.credits ?? 0).toLocaleString()}</span>
        </>
      }
    >
      <AccountMenu
        user={user}
        locale={locale}
        labels={labels}
        showHome={false}
        extra={
          <>
            <Link href={localePath(locale, "/dashboard")} className="nav-item justify-between">
              <span className="flex items-center gap-2.5">
                <LayoutDashboard className="size-4" /> {labels.dashboard}
              </span>
              <span className="font-mono text-xs text-fg-3 tabular-nums">
                {(user.credits ?? 0).toLocaleString()} {labels.credits}
              </span>
            </Link>
            <Link href={localePath(locale, "/studio")} className="nav-item">
              <Sparkles className="size-4" /> {labels.studio}
            </Link>
          </>
        }
      />
    </Dropdown>
  );
}
