"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Globe } from "lucide-react";
import { siteConfig, localeLabels, type Locale } from "@/config/site";
import { localePath } from "@/lib/paths";
import { Dropdown } from "./Dropdown";

export function LocaleSwitcher({
  current,
  label,
  side = "bottom",
  align = "right",
}: {
  current: Locale;
  label: string;
  side?: "top" | "bottom";
  align?: "left" | "right";
}) {
  const pathname = usePathname() || "/";
  // 去掉当前语言前缀，得到与语言无关的路径
  const prefix = `/${current}`;
  const base =
    current !== siteConfig.defaultLocale && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;

  return (
    <Dropdown
      label={label}
      side={side}
      align={align}
      summaryClassName="icon-btn inline-flex w-auto items-center gap-1.5 px-2.5"
      panelClassName="min-w-40"
      summary={
        <>
          <Globe className="size-4" />
          <span className="font-mono text-[0.6875rem] uppercase">{current}</span>
        </>
      }
    >
      <ul>
        {siteConfig.locales.map((l) => (
          <li key={l}>
            <Link
              href={localePath(l, base)}
              hrefLang={l}
              className={`flex items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm transition hover:bg-canvas-2 ${
                l === current ? "text-fg" : "text-fg-2"
              }`}
            >
              {localeLabels[l]}
              {l === current && <Check className="size-3.5 text-brand" />}
            </Link>
          </li>
        ))}
      </ul>
    </Dropdown>
  );
}
