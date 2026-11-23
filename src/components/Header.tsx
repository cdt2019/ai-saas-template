import Link from "next/link";
import { Menu } from "lucide-react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n";
import { localePath } from "@/lib/paths";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { AuthLink, UserMenu } from "./UserMenu";
import { Dropdown } from "./Dropdown";

/** 营销页顶部：悬浮的玻璃胶囊导航；手机上收进右侧菜单 */
export function Header({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const nav = [
    { href: localePath(locale, "/#features"), label: dict.nav.features },
    { href: localePath(locale, "/studio"), label: dict.nav.studio },
    { href: localePath(locale, "/pricing"), label: dict.nav.pricing },
    { href: localePath(locale, "/docs"), label: dict.nav.docs },
    { href: localePath(locale, "/blog"), label: dict.nav.blog },
  ];
  const labels = {
    signIn: dict.nav.signIn,
    getStarted: dict.nav.getStarted,
    dashboard: dict.nav.dashboard,
    studio: dict.nav.studio,
    admin: dict.nav.admin,
    signOut: dict.auth.signOut,
    credits: dict.account.credits,
    upgrade: dict.app.upgrade,
    settings: dict.app.settings,
    billing: dict.app.billing,
    usage: dict.app.usage,
    homepage: dict.app.homepage,
    planNames: Object.fromEntries(Object.entries(dict.pricing.plans).map(([id, p]) => [id, p.name])),
    free: dict.account.free,
  };

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 rounded-full border border-line bg-surface/75 pr-2 pl-4 shadow-[inset_0_1px_0_var(--highlight),0_18px_40px_-24px_rgb(var(--shadow)/0.45)] backdrop-blur-xl">
        <Link href={localePath(locale)} aria-label="Home" className="shrink-0">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-0.5 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-sm text-fg-2 transition hover:bg-canvas-2 hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 sm:flex">
            <LocaleSwitcher current={locale} label={dict.nav.language} />
            <ThemeToggle label={dict.nav.theme} />
          </div>
          <UserMenu locale={locale} labels={labels} />
          <Dropdown
            label={dict.nav.menu}
            className="md:hidden"
            summaryClassName="icon-btn rounded-full"
            panelClassName="w-[min(20rem,calc(100vw-1.5rem))] p-2"
            summary={<Menu className="size-4" />}
          >
            <nav className="grid">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2.5 text-[0.9375rem] text-fg-2 hover:bg-canvas-2 hover:text-fg">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-line px-1 pt-3">
              <LocaleSwitcher current={locale} label={dict.nav.language} align="left" />
              <ThemeToggle label={dict.nav.theme} />
              <AuthLink locale={locale} labels={labels} />
            </div>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
