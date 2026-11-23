import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { siteConfig } from "@/config/site";
import { getDictionary, hasLocale } from "@/i18n";
import { getDocs, getDocSlugs, loadDoc } from "@/lib/docs";
import { absoluteUrl, localePath } from "@/lib/paths";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { DocsToc } from "@/components/docs/DocsNav";

export const dynamicParams = false;

export function generateStaticParams() {
  return siteConfig.locales.flatMap((lang) => getDocSlugs(lang).map((slug) => ({ lang, slug })));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/docs/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!hasLocale(lang) || !getDocSlugs(lang).includes(slug)) return {};
  const { doc } = await loadDoc(lang, slug);
  const meta = buildMetadata({ locale: lang, path: `/docs/${slug}`, title: doc.title, description: doc.description, type: "article" });
  // 只有存在对应译文的语言才输出 hreflang
  const languages: Record<string, string> = {};
  for (const l of siteConfig.locales) if (getDocSlugs(l).includes(slug)) languages[l] = absoluteUrl(l, `/docs/${slug}`);
  return { ...meta, alternates: { ...meta.alternates, languages } };
}

export default async function DocPage({ params }: PageProps<"/[lang]/docs/[slug]">) {
  const { lang, slug } = await params;
  if (!hasLocale(lang) || !getDocSlugs(lang).includes(slug)) notFound();
  const [{ docs: t }, { Content, doc, headings }, all] = await Promise.all([getDictionary(lang), loadDoc(lang, slug), getDocs(lang)]);
  const i = all.findIndex((d) => d.slug === slug);
  const prev = all[i - 1];
  const next = all[i + 1];
  const base = localePath(lang, "/docs");

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_200px]">
      <article className="min-w-0 pb-8">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: doc.title,
            description: doc.description,
            inLanguage: lang,
            mainEntityOfPage: absoluteUrl(lang, `/docs/${slug}`),
            publisher: { "@type": "Organization", name: siteConfig.name },
          }}
        />
        <p className="label-mono !text-brand">{t.sections[doc.section] ?? doc.section}</p>
        <h1 className="mt-3 text-[clamp(2rem,4vw,2.75rem)] leading-tight font-semibold tracking-[-0.04em]">{doc.title}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-2">{doc.description}</p>
        <div className="prose-ink docs-prose mt-8 border-t border-line pt-6">
          <Content />
        </div>
        <nav aria-label={t.pager} className="mt-12 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
          {prev ? (
            <Link href={`${base}/${prev.slug}`} className="group rounded-xl border border-line p-4 transition hover:border-line-2">
              <span className="flex items-center gap-1.5 text-xs text-fg-3">
                <ArrowLeft className="size-3.5" /> {t.previous}
              </span>
              <span className="mt-1 block text-sm font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`${base}/${next.slug}`} className="group rounded-xl border border-line p-4 text-right transition hover:border-line-2">
              <span className="flex items-center justify-end gap-1.5 text-xs text-fg-3">
                {t.next} <ArrowRight className="size-3.5" />
              </span>
              <span className="mt-1 block text-sm font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      <aside className="hidden xl:block">
        <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto">
          <DocsToc headings={headings} title={t.onThisPage} />
        </div>
      </aside>
    </div>
  );
}
