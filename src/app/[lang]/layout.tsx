import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { siteConfig } from "@/config/site";
import { getDictionary, hasLocale } from "@/i18n";
import { sidebarInitScript, themeInitScript } from "@/lib/theme";
import { AdSenseScript } from "@/components/Ads";
import { Analytics } from "@/components/Analytics";
import { InlineScript } from "@/components/InlineScript";
import "../globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const dynamicParams = false;

export function generateStaticParams() {
  return siteConfig.locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    metadataBase: new URL(siteConfig.url),
    title: { default: dict.meta.title, template: `%s | ${siteConfig.name}` },
    description: dict.meta.description,
    applicationName: siteConfig.name,
    ...(siteConfig.adsenseClient ? { other: { "google-adsense-account": siteConfig.adsenseClient } } : {}),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1530" },
  ],
};

/**
 * 根布局只放 <html>、字体和全局脚本。三类页面各有自己的外壳：
 *   (site)  营销页：顶部导航 + 页脚
 *   (auth)  登录注册：左右分栏（AuthShell）
 *   (app)   用户中心 / AI 工作台 / 后台：左侧栏应用外壳
 */
export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <html
      lang={lang}
      // 服务端先按默认主题渲染；访客切换过的话，下面的内联脚本在首次绘制前改成他的选择
      data-theme={siteConfig.defaultTheme === "system" ? undefined : siteConfig.defaultTheme}
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        {/* 同步内联脚本：浏览器解析到这里就执行，首次绘制前定好深浅色（next/script 的 beforeInteractive 会排队到运行时，来不及） */}
        <InlineScript html={`${themeInitScript};${sidebarInitScript}`} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg"
        >
          Skip to content
        </a>
        {children}
        <AdSenseScript />
        <Analytics />
      </body>
    </html>
  );
}
