import { Mail } from "lucide-react";
import { siteConfig } from "@/config/site";

/** 关于 / 隐私 / 条款 等纯文本页面的统一版式 */
export function TextPage({
  eyebrow,
  title,
  lead,
  sections,
  paragraphs,
  updated,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  sections?: { h: string; p: string }[];
  paragraphs?: string[];
  updated?: string;
}) {
  return (
    <section className="container-x pt-16 sm:pt-24">
      <div className="mx-auto max-w-3xl">
        <p className="label-mono !text-brand">{eyebrow}</p>
        <h1 className="text-gradient mt-4 text-[clamp(2.5rem,6vw,4rem)] leading-[1.04] font-semibold tracking-[-0.05em]">{title}</h1>
        <p className="mt-5 text-lg leading-relaxed text-fg-2">{lead}</p>
        {updated && <p className="label-mono mt-6">{updated}</p>}

        <div className="bezel mt-12">
          <div className="card prose-ink px-6 py-8 sm:px-10 sm:py-10">
            {paragraphs?.map((p) => <p key={p}>{p}</p>)}
            {sections?.map((s) => (
              <div key={s.h}>
                <h2>{s.h}</h2>
                <p>{s.p}</p>
              </div>
            ))}
            <p className="flex items-center gap-2 border-t border-line pt-6">
              <Mail className="size-4 text-fg-3" />
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
