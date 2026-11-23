import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, FileText } from "lucide-react";
import { getDictionary, hasLocale } from "@/i18n";
import { buildMetadata } from "@/lib/seo";
import { localePath } from "@/lib/paths";
import { getPosts } from "@/lib/blog";
import { EmptyState } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/[lang]/blog">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { blog } = await getDictionary(lang);
  return buildMetadata({ locale: lang, path: "/blog", title: blog.title, description: blog.description });
}

export default async function BlogIndex({ params }: PageProps<"/[lang]/blog">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { blog } = await getDictionary(lang);
  const posts = await getPosts(lang);

  return (
    <section className="container-x pt-16 sm:pt-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="label-mono !text-brand">{blog.index}</p>
        <h1 className="text-gradient mt-4 text-[clamp(2.5rem,6vw,4rem)] leading-[1.04] font-semibold tracking-[-0.05em] text-balance">
          {blog.title}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-fg-2">{blog.description}</p>
      </div>

      <div className="mx-auto mt-14 grid max-w-[1080px] gap-4 md:grid-cols-2">
        {posts.length === 0 && (
          <div className="card md:col-span-2">
            <EmptyState icon={FileText} title={blog.empty} />
          </div>
        )}
        {posts.map((p) => (
          <Link key={p.slug} href={localePath(lang, `/blog/${p.slug}`)} className="group bezel transition hover:border-line-2">
            <article className="card flex h-full flex-col p-6 sm:p-7">
              <div aria-hidden className="relative mb-6 h-36 overflow-hidden rounded-xl bg-brand-gradient">
                <div className="grid-fine absolute inset-0 [mask-image:none] opacity-60" />
                <span className="absolute bottom-3 left-3 rounded-full bg-black/25 px-2.5 py-1 font-mono text-[0.6875rem] text-white backdrop-blur">
                  {p.date}
                </span>
              </div>
              <h2 className="text-xl leading-snug font-semibold tracking-[-0.025em]">{p.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-2">{p.description}</p>
              <p className="mt-6 flex items-center justify-between text-[0.8125rem] text-fg-3">
                <span>
                  {p.readingMinutes} {blog.minRead}
                </span>
                <span className="flex items-center gap-1 font-medium text-fg transition group-hover:text-brand">
                  {blog.readMore} <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </p>
            </article>
          </Link>
        ))}
      </div>
    </section>
  );
}
