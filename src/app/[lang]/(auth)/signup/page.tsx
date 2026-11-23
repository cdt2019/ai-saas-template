import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { enabledSocialProviders, getSession } from "@/lib/auth";
import { devMailHint } from "@/lib/email";
import { localePath } from "@/lib/paths";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/AuthForms";

/** 依赖登录状态 / 查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/signup">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { auth } = await getDictionary(lang);
  return { title: auth.signUp, robots: { index: false } };
}

export default async function SignUpPage({ params, searchParams }: PageProps<"/[lang]/signup">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { next } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  if (await getSession()) redirect(nextPath ?? localePath(lang, "/dashboard"));
  const dict = await getDictionary(lang);
  const t = dict.auth;

  return (
    <AuthShell
      locale={lang}
      dict={dict}
      title={t.signUpTitle}
      lead={t.signUpLead}
      topLink={
        <>
          {t.haveAccount}{" "}
          <Link href={localePath(lang, "/login") + (nextPath ? `?next=${encodeURIComponent(nextPath)}` : "")} className="link">
            {t.signIn}
          </Link>
        </>
      }
    >
      <SignUpForm t={t} locale={lang} next={nextPath} providers={enabledSocialProviders()} devMail={devMailHint()} />
    </AuthShell>
  );
}
