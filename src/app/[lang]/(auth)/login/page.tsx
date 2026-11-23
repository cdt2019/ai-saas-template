import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { enabledSocialProviders, getSession } from "@/lib/auth";
import { devMailHint } from "@/lib/email";
import { localePath } from "@/lib/paths";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/AuthForms";

/** 依赖登录状态 / 查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/login">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { auth } = await getDictionary(lang);
  return { title: auth.signIn, robots: { index: false } };
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[lang]/login">) {
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
      title={t.signInTitle}
      lead={t.signInLead}
      topLink={
        <>
          {t.noAccount}{" "}
          <Link href={localePath(lang, "/signup") + (nextPath ? `?next=${encodeURIComponent(nextPath)}` : "")} className="link">
            {t.signUp}
          </Link>
        </>
      }
      footer={t.terms}
    >
      <SignInForm t={t} locale={lang} next={nextPath} providers={enabledSocialProviders()} devMail={devMailHint()} />
    </AuthShell>
  );
}
