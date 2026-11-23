import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Lock, Zap } from "lucide-react";
import { formatPrice, plans } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { buildMetadata } from "@/lib/seo";
import { BuyButton, PromoCodeNotice } from "@/components/account/ClientActions";
import { Faq, SectionHeading } from "@/components/Sections";

export async function generateMetadata({ params }: PageProps<"/[lang]/pricing">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { pricing } = await getDictionary(lang);
  return buildMetadata({ locale: lang, path: "/pricing", title: pricing.title, description: pricing.lead });
}

export default async function PricingPage({ params }: PageProps<"/[lang]/pricing">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.pricing;

  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px]">
        <div className="absolute top-[-360px] left-1/2 h-[820px] w-[min(1200px,160vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,var(--glow-1)_0%,var(--glow-2)_40%,transparent_70%)] blur-md" />
        <div className="grid-fade absolute inset-0" />
      </div>

      <section className="container-x pt-16 sm:pt-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="label-mono !text-brand">{t.eyebrow}</p>
          <h1 className="text-gradient mt-4 text-[clamp(2.6rem,7vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.055em] text-balance">
            {t.title}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-2">{t.lead}</p>
          {/* /pricing?code=XXX：页面保持静态，优惠码在浏览器里读 */}
          <PromoCodeNotice template={t.codeNotice} />
        </div>

        <div className="mx-auto mt-14 grid max-w-[1080px] gap-5 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => {
            const copy = t.plans[plan.id] ?? { name: plan.id, desc: "" };
            const unit = plan.mode === "subscription" ? (plan.interval === "year" ? t.perYear : t.perMonth) : t.oneTime;
            return (
              <div
                key={plan.id}
                className={`relative rounded-[1.4rem] p-[5px] ${
                  plan.highlight
                    ? "bg-gradient-to-b from-brand-1 via-brand-2 to-brand-3 shadow-[0_30px_70px_-30px_var(--glow-1)]"
                    : "border border-line bg-canvas-2/80"
                }`}
              >
                <div className="card flex h-full flex-col rounded-[1.1rem] p-7 sm:p-8">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold tracking-[-0.02em]">{copy.name}</h2>
                    {plan.highlight && <span className="badge badge-brand badge-plain">{t.popular}</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-fg-2">{copy.desc}</p>

                  <p className="mt-8 flex items-baseline gap-2">
                    <span className="text-[3.25rem] leading-none font-semibold tracking-[-0.05em] tabular-nums">
                      {formatPrice(plan.price, plan.currency)}
                    </span>
                    <span className="text-sm text-fg-3">{unit}</span>
                  </p>
                  <p className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">
                    <Zap className="size-4 text-brand" />
                    <span className="font-mono tabular-nums">{plan.credits.toLocaleString()}</span> {t.creditsLabel}
                    {plan.mode === "subscription" && <span className="text-fg-3">{unit}</span>}
                  </p>

                  <ul className="mt-6 flex-1 space-y-3 text-sm text-fg-2">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success-fg">
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8">
                    <BuyButton
                      planId={plan.id}
                      label={plan.mode === "subscription" ? t.subscribe : t.buy}
                      t={t}
                      locale={lang}
                      highlight={plan.highlight}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 flex items-center justify-center gap-2 text-center text-[0.8125rem] text-fg-3">
          <Lock className="size-3.5" /> {t.trust}
        </p>
      </section>

      <section className="container-x pt-28">
        <div className="mx-auto grid max-w-[1080px] gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SectionHeading label={dict.faq.label} title={dict.faq.title} align="left" />
          <Faq items={dict.faq.items} />
        </div>
      </section>
    </>
  );
}
