import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { getDocs, getDocSearchIndex, groupDocs } from "@/lib/docs";
import { localePath } from "@/lib/paths";
import { DocsSearch, DocsSidebar } from "@/components/docs/DocsNav";

/** 文档外壳：左边搜索 + 分组目录，右边是内容 */
export default async function DocsLayout({ children, params }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const [{ docs: t }, docs, index] = await Promise.all([getDictionary(lang), getDocs(lang), getDocSearchIndex(lang)]);
  const base = localePath(lang, "/docs");
  const groups = groupDocs(docs).map((g) => ({ section: g.section, label: t.sections[g.section] ?? g.section, items: g.items.map((d) => ({ slug: d.slug, title: d.title })) }));

  return (
    <div className="mx-auto grid w-full max-w-[1320px] gap-8 px-4 pt-28 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1 lg:pb-6">
        <div className="space-y-4">
          <DocsSearch index={index} base={base} labels={{ placeholder: t.search, empty: t.noResults }} />
          <DocsSidebar groups={groups} base={base} menuLabel={t.menu} />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
