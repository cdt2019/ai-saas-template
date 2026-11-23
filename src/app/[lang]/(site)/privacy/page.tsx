import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { buildMetadata } from "@/lib/seo";
import { TextPage } from "@/components/TextPage";

const UPDATED = "2026-09-28";

export async function generateMetadata({ params }: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { legal } = await getDictionary(lang);
  return buildMetadata({
    locale: lang,
    path: "/privacy",
    title: legal.privacy.title,
    description: legal.privacy.description,
  });
}

export default async function Privacy({ params }: PageProps<"/[lang]/privacy">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { legal } = await getDictionary(lang);
  return (
    <TextPage
      eyebrow={legal.privacy.title}
      title={legal.privacy.title}
      lead={legal.privacy.description}
      sections={legal.privacy.sections}
      updated={`${legal.updated}: ${UPDATED}`}
    />
  );
}
