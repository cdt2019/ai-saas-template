"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { siteConfig, type Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { localePath } from "@/lib/paths";
import { Logo } from "./Logo";

export function NotFoundView({ texts }: { texts: Record<Locale, Dictionary["notFound"]> }) {
  const first = (usePathname() || "/").split("/")[1] as Locale;
  const locale = siteConfig.locales.includes(first) ? first : siteConfig.defaultLocale;
  const t = texts[locale];

  return (
    <main id="main" className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-30%] left-1/2 h-[80vh] w-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,var(--glow-1),var(--glow-2)_40%,transparent_70%)] blur-md" />
        <div className="grid-fade absolute inset-0" />
      </div>
      <header className="container-x flex h-20 items-center">
        <Link href={localePath(locale)} aria-label="Home">
          <Logo />
        </Link>
      </header>
      <section className="container-x grid flex-1 place-items-center pb-24 text-center">
        <div>
          <p className="label-mono">Error 404</p>
          <p className="mt-4 bg-gradient-to-b from-brand-1 via-brand-2 to-brand-3 bg-clip-text text-[clamp(7rem,24vw,14rem)] leading-none font-semibold tracking-[-0.07em] text-transparent">
            404
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{t.title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-fg-2">{t.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={localePath(locale)} className="btn btn-primary">
              <ArrowLeft className="size-4" /> {t.back}
            </Link>
            <Link href={localePath(locale, "/studio")} className="btn btn-secondary">
              <Sparkles className="size-4" /> {t.secondary}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
