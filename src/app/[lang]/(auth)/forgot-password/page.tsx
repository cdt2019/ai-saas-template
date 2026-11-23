import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDictionary, hasLocale } from "@/i18n";
import { devMailHint } from "@/lib/email";
import { localePath } from "@/lib/paths";
import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/AuthForms";

export async function generateMetadata({ params }: PageProps<"/[lang]/forgot-password">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { auth } = await getDictionary(lang);
  return { title: auth.forgotTitle, robots: { index: false } };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[lang]/forgot-password">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.auth;

  return (
    <AuthShell
      locale={lang}
      dict={dict}
      title={t.forgotTitle}
      lead={t.forgotLead}
      footer={
        <Link href={localePath(lang, "/login")} className="inline-flex items-center gap-1.5 font-medium text-fg-2 hover:text-fg">
          <ArrowLeft className="size-3.5" /> {t.backToSignIn}
        </Link>
      }
    >
      <ForgotPasswordForm t={t} locale={lang} devMail={devMailHint()} />
    </AuthShell>
  );
}
