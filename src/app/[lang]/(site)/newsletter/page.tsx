import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { getDictionary, hasLocale } from "@/i18n";
import { NewsletterAction, NewsletterForm } from "@/components/NewsletterForm";

export async function generateMetadata({ params }: PageProps<"/[lang]/newsletter">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { newsletter } = await getDictionary(lang);
  // 地址里可能带令牌：不收录，也不通过 Referer 传给外站
  return { title: newsletter.title, description: newsletter.lead, robots: { index: false }, referrer: "no-referrer" };
}

/** Newsletter 页：默认是订阅表单；邮件里的链接带 ?action=confirm|unsubscribe&token=，这里显示按钮让人确认 */
export default async function NewsletterPage({ params, searchParams }: PageProps<"/[lang]/newsletter">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const sp = await searchParams;
  const { newsletter: t } = await getDictionary(lang);
  const token = typeof sp.token === "string" ? sp.token : "";
  const action = token && (sp.action === "confirm" || sp.action === "unsubscribe") ? sp.action : null;
  const head = action === "confirm" ? t.confirm : action === "unsubscribe" ? t.unsubscribe_ : { title: t.title, body: t.lead };

  return (
    <section className="container-x grid min-h-[60vh] place-items-center pt-32 pb-10 text-center">
      <div className="w-full max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Mail className="size-5" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em]">{head.title}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-2">{head.body}</p>
        <div className="mt-7">
          {action ? <NewsletterAction action={action} token={token} t={t} /> : <NewsletterForm locale={lang} t={t} className="text-left" />}
        </div>
      </div>
    </section>
  );
}
