import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { siteConfig } from "@/config/site";

/**
 * 1) 语言路由（as-needed 前缀）：
 *   /            -> 内部改写到 /en        （默认语言不带前缀，对 SEO 更友好）
 *   /en/xxx      -> 308 重定向到 /xxx     （避免重复内容）
 *   /zh/xxx      -> 直接放行
 * 2) 登录保护：访问 /dashboard、/settings、/admin 且没有登录 cookie → 跳到对应语言的 /login?next=...
 *    这里只做“乐观检查”（看 cookie 是否存在），页面里还会在服务端再校验一次 session。
 */
const PROTECTED = ["/dashboard", "/settings", "/admin"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const [, first] = pathname.split("/");
  const locales = siteConfig.locales as readonly string[];
  const def = siteConfig.defaultLocale;

  const hasPrefix = locales.includes(first);
  const locale = hasPrefix ? first : def;
  const rest = hasPrefix ? pathname.slice(first.length + 1) || "/" : pathname;

  if (PROTECTED.some((p) => rest === p || rest.startsWith(`${p}/`)) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = locale === def ? "/login" : `/${locale}/login`;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (first === def) {
    // OG 图片等元数据路由由 Next 生成带默认语言前缀的地址，不做重定向
    if (pathname.includes("opengraph-image")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = rest;
    return NextResponse.redirect(url, 308);
  }

  if (hasPrefix) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${def}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // 跳过 Next 内部资源、API、favicon、以及带扩展名的静态文件（sitemap.xml / robots.txt / 图片等）
  matcher: ["/((?!_next|api|icon|apple-icon|.*\\..*).*)"],
};
