import "server-only";
import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import type { ComponentType } from "react";
import { siteConfig, type Locale } from "@/config/site";

/**
 * 文档：src/content/docs/<语言>/<slug>.mdx，每篇顶部导出 meta：
 *   export const meta = { title: "...", description: "...", section: "start", order: 1 };
 * section 决定侧栏分组（名字在字典 docs.sections），order 决定顺序。全部构建时静态生成。
 * 目录和搜索内容从 MDX 原文提取；标题 id 由 rehype-slug 生成，这里用同一个算法，保证目录能跳过去
 */
export type DocMeta = { title: string; description: string; section: string; order: number };
export type DocHeading = { id: string; text: string; level: 2 | 3 };
export type DocPage = DocMeta & { slug: string };
export type DocSearchItem = DocPage & { headings: string[]; text: string };

const ROOT = path.join(process.cwd(), "src/content/docs");

export function getDocSlugs(locale: Locale): string[] {
  const dir = path.join(ROOT, locale);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
}

const raw = (locale: Locale, slug: string) => fs.readFileSync(path.join(ROOT, locale, `${slug}.mdx`), "utf8");
/** 去掉 meta 和代码块，只留正文 */
const prose = (source: string) => source.replace(/^export const meta[\s\S]*?};?\s*$/m, "").replace(/^(```|~~~)[\s\S]*?^\1\s*$/gm, "");
/** 标题里的 Markdown 标记换成纯文字 */
const plain = (s: string) => s.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1").trim();

export function extractHeadings(source: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const out: DocHeading[] = [];
  for (const m of prose(source).matchAll(/^(#{2,3})\s+(.+?)\s*#*\s*$/gm)) {
    const text = plain(m[2]);
    out.push({ id: slugger.slug(text), text, level: m[1].length as 2 | 3 });
  }
  return out;
}

export async function loadDoc(locale: Locale, slug: string) {
  const mod = (await import(`@/content/docs/${locale}/${slug}.mdx`)) as { default: ComponentType; meta: DocMeta };
  return { Content: mod.default, doc: { ...mod.meta, slug } satisfies DocPage, headings: extractHeadings(raw(locale, slug)) };
}

export async function getDocs(locale: Locale): Promise<DocPage[]> {
  const docs = await Promise.all(getDocSlugs(locale).map(async (s) => (await loadDoc(locale, s)).doc));
  return docs.sort((a, b) => a.order - b.order);
}

/** 按 section 分组，组的顺序按组内最靠前的一篇 */
export function groupDocs(docs: DocPage[]) {
  const groups = new Map<string, DocPage[]>();
  for (const d of docs) groups.set(d.section, [...(groups.get(d.section) ?? []), d]);
  return [...groups.entries()].map(([section, items]) => ({ section, items }));
}

/** 浏览器里搜索用的索引：标题、描述、小标题和一段正文 */
export async function getDocSearchIndex(locale: Locale): Promise<DocSearchItem[]> {
  const docs = await getDocs(locale);
  return docs.map((d) => {
    const source = raw(locale, d.slug);
    const text = plain(prose(source).replace(/^#+\s+/gm, "").replace(/[|>*`#-]+/g, " ").replace(/\s+/g, " ")).slice(0, 2000);
    return { ...d, headings: extractHeadings(source).map((h) => h.text), text };
  });
}

/** sitemap 用 */
export async function getAllDocs() {
  const all = await Promise.all(siteConfig.locales.map(async (locale) => (await getDocs(locale)).map((d) => ({ locale, ...d }))));
  return all.flat();
}
