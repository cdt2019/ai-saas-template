import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAiFeature } from "@/config/ai";
import { getDictionary, hasLocale } from "@/i18n";
import { buildMetadata } from "@/lib/seo";
import { PageHeader } from "@/components/ui";
import { Studio } from "@/components/studio/Studio";

export async function generateMetadata({ params }: PageProps<"/[lang]/studio">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { studio } = await getDictionary(lang);
  return buildMetadata({ locale: lang, path: "/studio", title: studio.title, description: studio.lead });
}

export default async function StudioPage({ params }: PageProps<"/[lang]/studio">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { studio: t } = await getDictionary(lang);
  const costs = {
    text: getAiFeature("rewrite")?.cost ?? 1,
    image: getAiFeature("image")?.cost ?? 5,
    video: getAiFeature("video")?.cost ?? 50,
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <PageHeader title={t.title} lead={t.lead} />
      <Studio t={t} locale={lang} costs={costs} />
    </div>
  );
}
