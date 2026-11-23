import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/** 营销页外壳：悬浮导航 + 页脚 */
export default async function SiteLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <Header locale={lang} dict={dict} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer locale={lang} dict={dict} />
    </div>
  );
}
