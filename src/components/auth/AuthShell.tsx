import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { siteConfig, type Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { localePath } from "@/lib/paths";
import { Logo } from "@/components/Logo";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TickMeter } from "@/components/ui";

/**
 * 登录 / 注册 / 找回密码 / 验证邮箱的统一版式：
 * 左边品牌面板（始终深色：茄紫底 + 极光 + 玻璃卡片），右边表单（跟随深浅色）；手机上只显示表单
 */
export function AuthShell({
  locale,
  dict,
  title,
  lead,
  topLink,
  children,
  footer,
}: {
  locale: Locale;
  dict: Dictionary;
  title: string;
  lead: string;
  topLink?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = dict.auth;
  return (
    <main id="main" className="flex min-h-dvh flex-wrap bg-surface">
      <div className="flex min-h-dvh min-w-0 flex-[1_1_520px] flex-col px-5 py-6 sm:px-10 sm:py-7 lg:order-2">
        <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
          {/* 桌面端 Logo 在左侧品牌面板里 */}
          <Link href={localePath(locale)} aria-label="Home" className="lg:hidden">
            <Logo />
          </Link>
          {topLink && <div className="text-[0.8125rem] text-fg-3">{topLink}</div>}
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[24rem]">
            <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.04em]">{title}</h1>
            <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-fg-2">{lead}</p>
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-center text-[0.8125rem] text-fg-3">{footer}</div>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-3">
          <span>
            © {new Date().getFullYear()} {siteConfig.name}
          </span>
          <div className="flex items-center gap-3">
            <Link href={localePath(locale, "/privacy")} className="hover:text-fg">
              {dict.footer.privacy}
            </Link>
            <Link href={localePath(locale, "/terms")} className="hover:text-fg">
              {dict.footer.terms}
            </Link>
            <LocaleSwitcher current={locale} label={dict.nav.language} side="top" />
            <ThemeToggle label={dict.nav.theme} />
          </div>
        </div>
      </div>

      {/* 品牌面板 */}
      <div className="hidden min-w-0 flex-[1_1_560px] p-3 lg:order-1 lg:flex">
        <div className="theme-dark relative isolate flex flex-1 flex-col justify-between gap-10 overflow-hidden rounded-[1.75rem] bg-canvas p-12 text-fg">
          <div aria-hidden className="absolute -top-52 -left-44 -z-10 size-[720px] rounded-full bg-[radial-gradient(circle,rgb(255_122_89/0.7)_0%,rgb(232_72_138/0.32)_40%,transparent_70%)] blur-xl" />
          <div aria-hidden className="absolute -right-52 -bottom-64 -z-10 size-[620px] rounded-full bg-[radial-gradient(circle,rgb(183_156_255/0.3),transparent_65%)] blur-xl" />
          <div aria-hidden className="grid-fade absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_30%_30%,black,transparent_75%)]" />

          <div className="max-w-md">
            <Link href={localePath(locale)} aria-label="Home" className="mb-12 inline-flex">
              <Logo />
            </Link>
            <p className="label-mono !text-[#ffb59e]">{t.panelEyebrow}</p>
            <p className="text-gradient mt-4 text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.045em]">{t.panelTitle}</p>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-fg-2">{t.panelBody}</p>
          </div>

          <div aria-hidden className="relative h-[400px] w-full max-w-[560px] self-center">
            <div className="absolute top-10 left-0 w-[340px] rounded-[1.1rem] border border-white/15 bg-white/[0.07] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_30px_60px_-20px_rgb(10_4_20/0.6)] backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="label-mono">{dict.account.credits}</span>
                <span className="badge badge-plain bg-brand-gradient text-white">Pro</span>
              </div>
              <p className="mt-4 text-5xl leading-none font-semibold tracking-[-0.05em]">1,240</p>
              <TickMeter value={0.62} count={24} fill="bg-[#ff8a6b]" empty="bg-white/15" className="mt-5 h-8" />
            </div>

            <div className="absolute top-0 right-0 flex w-[280px] items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_30px_60px_-20px_rgb(10_4_20/0.6)] backdrop-blur-xl">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-success/40 bg-success-soft text-success-fg">
                <Check className="size-4" strokeWidth={2.6} />
              </span>
              <span>
                <span className="block text-[0.8125rem] font-semibold">{t.panelPaid}</span>
                <span className="block text-xs text-fg-2">{t.panelPaidSub}</span>
              </span>
            </div>

            <div className="absolute right-5 bottom-0 w-[310px] overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_30px_60px_-20px_rgb(10_4_20/0.6)] backdrop-blur-xl">
              <p className="flex justify-between border-b border-white/10 px-4 py-3 text-[0.8125rem] font-semibold">
                {t.panelRuns} <span className="label-mono">Today</span>
              </p>
              {[
                ["bg-viz-3", "Image · 1:1", "−5"],
                ["bg-viz-1", "Rewrite · 312 words", "−1"],
                ["bg-success", "Starter", "+100"],
              ].map(([dot, label, delta]) => (
                <p key={label} className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-2.5 text-[0.8125rem] last:border-0">
                  <span className={`size-1.5 rounded-full ${dot}`} />
                  {label}
                  <span className={`ml-auto font-mono ${delta.startsWith("+") ? "text-success-fg" : "text-fg-2"}`}>{delta}</span>
                </p>
              ))}
            </div>
          </div>

          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem] text-fg-2">
            {t.panelPoints.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#ff8a6b] shadow-[0_0_8px_#ff8a6b]" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
