"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Monitor, Moon, Sun } from "lucide-react";
import { siteConfig, localeLabels, type Locale } from "@/config/site";
import { localePath } from "@/lib/paths";
import { Select } from "@/components/Select";
import { setThemePref, useThemePref, type ThemePref } from "@/lib/theme-client";

const THEMES: { id: ThemePref; icon: typeof Sun }[] = [
  { id: "system", icon: Monitor },
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
];

/** 设置页：主题三选一（跟随系统 / 浅色 / 深色） */
export function ThemeSelect({ labels }: { labels: Record<string, string> }) {
  const pref = useThemePref();
  return (
    <div role="radiogroup" className="seg">
      {THEMES.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={pref === id}
          aria-label={labels[id]}
          title={labels[id]}
          onClick={() => setThemePref(id)}
          className="seg-item px-2.5"
        >
          <Icon className="size-4" />
          <span className="hidden sm:inline">{labels[id]}</span>
        </button>
      ))}
    </div>
  );
}

/** 设置页：切换语言（保留当前页面和 ?tab=） */
export function LanguageSelect({ current, label }: { current: Locale; label: string }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const search = useSearchParams().toString();
  const prefix = `/${current}`;
  const base =
    current !== siteConfig.defaultLocale && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;

  return (
    <Select
      label={label}
      value={current}
      onChange={(l) => router.push(localePath(l, base) + (search ? `?${search}` : ""))}
      options={siteConfig.locales.map((l) => ({ value: l, label: localeLabels[l] }))}
      className="w-44"
      align="right"
    />
  );
}
