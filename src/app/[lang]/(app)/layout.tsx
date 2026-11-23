import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { AppProviders } from "@/components/AppProviders";
import { AppShell } from "@/components/AppShell";

/** 用户中心 / AI 工作台 / 管理后台：左侧栏应用外壳（登录态在客户端读，AI 工作台仍可静态生成） */
export default async function AppLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const labels = {
    ...dict.app,
    language: dict.nav.language,
    theme: dict.nav.theme,
    menu: dict.nav.menu,
    signIn: dict.nav.signIn,
    getStarted: dict.nav.getStarted,
    signOut: dict.auth.signOut,
    credits: dict.account.credits,
    planNames: Object.fromEntries(Object.entries(dict.pricing.plans).map(([id, p]) => [id, p.name])),
    free: dict.account.free,
    adminNav: { title: dict.admin.title, backToApp: dict.admin.backToApp, groups: dict.admin.groups, nav: dict.admin.nav },
    notifications: dict.notifications,
  };

  return (
    <AppProviders locale={lang} labels={dict.notifications} planNames={labels.planNames}>
      <AppShell locale={lang} labels={labels}>
        {children}
      </AppShell>
    </AppProviders>
  );
}
