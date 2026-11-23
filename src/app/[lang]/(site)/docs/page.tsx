import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getDictionary, hasLocale } from "@/i18n";
import { getDocs, groupDocs } from "@/lib/docs";
import { localePath } from "@/lib/paths";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[lang]/docs">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { docs } = await getDictionary(lang);
  return buildMetadata({ locale: lang, path: "/docs", title: docs.title, description: docs.lead });
}

/** 文档首页：按分组列出所有文章 */
export default async function DocsIndex({ params }: PageProps<"/[lang]/docs">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const [{ docs: t }, docs] = await Promise.all([getDictionary(lang), getDocs(lang)]);
  const base = localePath(lang, "/docs");

  return (
    <div className="pb-8">
      <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-tight font-semibold tracking-[-0.04em]">{t.title}</h1>
      <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-fg-2">{t.lead}</p>
      <div className="mt-10 space-y-10">
        {groupDocs(docs).map((g) => (
          <section key={g.section}>
            <h2 className="label-mono">{t.sections[g.section] ?? g.section}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((d) => (
                <Link key={d.slug} href={`${base}/${d.slug}`} className="group rounded-xl border border-line bg-surface p-4 transition hover:border-line-2">
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    {d.title} <ArrowRight className="size-3.5 shrink-0 text-fg-3 transition group-hover:translate-x-0.5 group-hover:text-fg" />
                  </span>
                  <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-fg-3">{d.description}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
