import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Globe, KeyRound, RotateCcw, Sparkles, Wallet } from "lucide-react";
import { siteConfig } from "@/config/site";
import { getAiFeature } from "@/config/ai";
import { formatPrice, plans } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { buildMetadata } from "@/lib/seo";
import { absoluteUrl, localePath } from "@/lib/paths";
import { Tool } from "@/tool/Tool";
import { AdSlot } from "@/components/Ads";
import { JsonLd } from "@/components/JsonLd";
import { Faq, SectionHeading } from "@/components/Sections";
import { GitHubIcon, GoogleIcon } from "@/components/icons";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return buildMetadata({
    locale: lang,
    path: "/",
    title: dict.meta.title,
    description: dict.meta.description,
    absoluteTitle: true,
  });
}

/** 功能卡上的小图：纯装饰 */
const BARS = [40, 55, 70, 45, 85, 100, 60, 50, 30, 75, 90, 65, 40, 80, 95, 70, 55, 85, 100, 60];
const BAR_TONE = ["bg-viz-muted", "bg-viz-muted", "bg-viz-1", "bg-viz-muted", "bg-viz-1", "bg-viz-2", "bg-viz-1", "bg-viz-muted", "bg-viz-4", "bg-viz-1"];

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const { hero, how, features, faq, cta } = dict;
  const costs = {
    text: getAiFeature("rewrite")?.cost ?? 1,
    image: getAiFeature("image")?.cost ?? 5,
    video: getAiFeature("video")?.cost ?? 50,
  };
  const [billing, signin, ai, refunds, global] = features.items;
  const unit = (p: (typeof plans)[number]) =>
    p.mode === "subscription" ? (p.interval === "year" ? dict.pricing.perYear : dict.pricing.perMonth) : dict.pricing.oneTime;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: siteConfig.name,
      url: absoluteUrl(lang),
      description: dict.meta.description,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any",
      inLanguage: lang,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.items.map((i) => ({
        "@type": "Question",
        name: i.q,
        acceptedAnswer: { "@type": "Answer", text: i.a },
      })),
    },
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      {/* 背景光晕 + 网格 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px]">
        <div className="absolute top-[-320px] left-1/2 h-[860px] w-[min(1300px,160vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,var(--glow-1)_0%,var(--glow-2)_38%,transparent_70%)] blur-md" />
        <div className="absolute top-[420px] -left-64 size-[720px] rounded-full bg-[radial-gradient(circle,var(--glow-3),transparent_65%)]" />
        <div className="grid-fade absolute inset-0" />
      </div>

      {/* ---------------- Hero ---------------- */}
      <section className="container-x flex flex-col items-center pt-16 text-center sm:pt-24">
        <Link
          href={localePath(lang, "/signup")}
          className="animate-rise inline-flex h-8 items-center gap-2.5 rounded-full border border-brand-1/30 bg-surface/60 pr-3 pl-1 text-[0.8125rem] text-fg-2 shadow-[0_0_24px_-6px_var(--glow-1),inset_0_1px_0_var(--highlight)] backdrop-blur"
        >
          <span className="inline-flex h-6 items-center rounded-full bg-gradient-to-r from-[#ffb59e] to-[#ff8a6b] px-2.5 text-xs font-semibold text-brand-ink">
            {hero.badge}
          </span>
          {hero.eyebrow}
          <ArrowRight className="size-3.5" />
        </Link>
        <h1 className="text-gradient animate-rise mt-7 max-w-5xl text-[clamp(2.75rem,8vw,5.5rem)] leading-[1.02] font-semibold tracking-[-0.055em] text-balance [animation-delay:60ms]">
          {hero.title}
        </h1>
        <p className="animate-rise mt-6 max-w-2xl text-[clamp(1.05rem,1.6vw,1.2rem)] leading-relaxed text-fg-2 [animation-delay:120ms]">
          {hero.subtitle}
        </p>
        <div className="animate-rise mt-9 flex flex-wrap justify-center gap-3 [animation-delay:180ms]">
          <Link href={localePath(lang, "/signup")} className="btn btn-brand btn-lg">
            {hero.primary} <ArrowRight className="size-4" />
          </Link>
          <Link href={localePath(lang, "/pricing")} className="btn btn-secondary btn-lg">
            {hero.secondary}
          </Link>
        </div>
        <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.8125rem] text-fg-3">
          {hero.badges.map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <Check className="size-3.5 text-brand-1" strokeWidth={2.6} />
              {b}
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- Tool（产品框） ---------------- */}
      <section id="tool" className="container-x relative mt-14 scroll-mt-28 sm:mt-20">
        <div aria-hidden className="absolute inset-x-[8%] top-[10%] -bottom-[8%] rounded-full bg-[radial-gradient(ellipse_at_center,var(--glow-1),var(--glow-2)_45%,transparent_70%)] blur-3xl" />
        <div className="relative mx-auto max-w-[1080px] rounded-[1.6rem] border border-line bg-canvas-2/60 p-1.5 shadow-[0_50px_100px_-40px_rgb(var(--shadow)/0.6)] backdrop-blur">
          <div className="card rounded-[1.25rem]">
            <Tool t={dict.tool} locale={lang} costs={costs} />
          </div>
        </div>
        <AdSlot slot="home-below-tool" className="mx-auto mt-10 max-w-[1080px]" />
      </section>

      {/* ---------------- Features（不规则格子） ---------------- */}
      <section id="features" className="container-x scroll-mt-28 pt-32">
        <SectionHeading label={features.label} title={features.title} lead={features.lead} />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <div className="bezel md:col-span-2">
            <div className="card flex flex-wrap gap-8 p-7">
              <div className="flex min-w-56 flex-1 flex-col gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-brand">
                  <Wallet className="size-[18px]" />
                </span>
                <p className="label-mono mt-2">{billing.tag}</p>
                <h3 className="text-lg font-semibold tracking-[-0.015em]">{billing.title}</h3>
                <p className="text-sm leading-relaxed text-fg-2">{billing.body}</p>
              </div>
              <div className="flex min-w-64 flex-1 flex-col gap-2.5">
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                      p.highlight
                        ? "border-brand-1/45 bg-gradient-to-r from-brand-1/15 to-brand-2/5 shadow-[0_0_30px_-12px_var(--glow-1)]"
                        : "border-line bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{dict.pricing.plans[p.id]?.name ?? p.id}</span>
                      <span className="block font-mono text-[0.6875rem] text-fg-3">
                        {p.credits.toLocaleString()} {dict.pricing.creditsLabel}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-sm tabular-nums">{formatPrice(p.price, p.currency)}</span>
                      <span className="block text-[0.6875rem] text-fg-3">{unit(p)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bezel">
            <div className="card flex flex-col gap-2.5 p-7">
              <span className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-brand">
                <KeyRound className="size-[18px]" />
              </span>
              <p className="label-mono mt-2">{signin.tag}</p>
              <h3 className="text-lg font-semibold tracking-[-0.015em]">{signin.title}</h3>
              <p className="text-sm leading-relaxed text-fg-2">{signin.body}</p>
              <div aria-hidden className="mt-3 grid gap-2">
                <span className="btn btn-secondary w-full">
                  <GoogleIcon className="size-4" /> Google
                </span>
                <span className="btn btn-secondary w-full">
                  <GitHubIcon className="size-4" /> GitHub
                </span>
              </div>
            </div>
          </div>

          <div className="bezel">
            <div className="card flex flex-col gap-2.5 p-7">
              <span className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-brand">
                <Sparkles className="size-[18px]" />
              </span>
              <p className="label-mono mt-2">{ai.tag}</p>
              <h3 className="text-lg font-semibold tracking-[-0.015em]">{ai.title}</h3>
              <p className="text-sm leading-relaxed text-fg-2">{ai.body}</p>
              <div aria-hidden className="mt-auto flex h-12 items-end gap-[3px] pt-4">
                {BARS.map((h, i) => (
                  <span key={i} className={`tick ${BAR_TONE[i % BAR_TONE.length]}`} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="bezel">
            <div className="card flex flex-col gap-2.5 p-7">
              <span className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-brand">
                <RotateCcw className="size-[18px]" />
              </span>
              <p className="label-mono mt-2">{refunds.tag}</p>
              <h3 className="text-lg font-semibold tracking-[-0.015em]">{refunds.title}</h3>
              <p className="text-sm leading-relaxed text-fg-2">{refunds.body}</p>
              <ol aria-hidden className="mt-auto grid gap-2.5 pt-4 text-[0.8125rem]">
                {features.refundSteps.map((s, i) => (
                  <li key={s} className="flex items-center gap-2.5">
                    <span className={`size-2 rounded-full ${["bg-brand-1 shadow-[0_0_8px_var(--brand-1)]", "bg-viz-4", "bg-success"][i]}`} />
                    {s}
                    <span className="ml-auto h-px flex-1 bg-line" />
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="bezel">
            <div className="card flex flex-col gap-2.5 p-7">
              <span className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-brand">
                <Globe className="size-[18px]" />
              </span>
              <p className="label-mono mt-2">{global.tag}</p>
              <h3 className="text-lg font-semibold tracking-[-0.015em]">{global.title}</h3>
              <p className="text-sm leading-relaxed text-fg-2">{global.body}</p>
              <div aria-hidden className="seg mt-auto w-fit">
                <span className="seg-item" aria-selected="true">
                  English
                </span>
                <span className="seg-item">简体中文</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="container-x scroll-mt-28 pt-32">
        <SectionHeading label={how.label} title={how.title} />
        <ol className="relative mt-14 grid gap-4 md:grid-cols-3">
          {how.steps.map((s, i) => (
            <li key={s.title} className="bezel">
              <div className="card h-full p-7">
                <span className="grid size-10 place-items-center rounded-full bg-brand-gradient font-mono text-sm font-semibold text-white shadow-[0_8px_20px_-8px_var(--glow-1),inset_0_1px_0_rgb(255_255_255/0.35)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-6 text-lg font-semibold tracking-[-0.015em]">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="container-x scroll-mt-28 pt-32">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SectionHeading label={faq.label} title={faq.title} align="left" />
          <Faq items={faq.items} />
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="container-x pt-32">
        <div className="hero-card px-6 py-16 text-center sm:px-12 sm:py-20">
          <div aria-hidden className="grid-fine absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_70%)]" />
          <h2 className="relative text-[clamp(2rem,5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">{cta.title}</h2>
          <p className="relative mx-auto mt-4 max-w-md text-white/90">{cta.body}</p>
          <div className="relative mt-9 flex flex-wrap justify-center gap-3">
            <Link href={localePath(lang, "/signup")} className="btn btn-white btn-lg">
              {cta.button} <ArrowRight className="size-4" />
            </Link>
            <Link href={localePath(lang, "/pricing")} className="btn btn-glass btn-lg">
              {cta.secondary}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
