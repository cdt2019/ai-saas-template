"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile 人机验证（免费、对用户基本无感）
 * 配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY 后显示；未配置时不渲染，表单照常可用。
 * 服务端配合 TURNSTILE_SECRET_KEY（Better Auth captcha 插件校验）。
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/**
 * 返回 [验证组件, 当前 token, 重置函数]；token 只能用一次，提交失败后要 reset。
 * quiet：只在 Cloudflare 判断需要用户操作时才显示（如验证码页的「重新发送」）
 */
export function useTurnstile({ quiet = false }: { quiet?: boolean } = {}): [React.ReactNode, string | null, () => void] {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    if (!loaded && !window.turnstile) return;
    if (widgetId.current) return;
    widgetId.current = window.turnstile!.render(ref.current, {
      sitekey: TURNSTILE_SITE_KEY,
      ...(quiet ? { appearance: "interaction-only" } : {}),
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      callback: (t: string) => setToken(t),
      "expired-callback": () => setToken(null),
      "error-callback": () => setToken(null),
    });
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [loaded, quiet]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  if (!TURNSTILE_SITE_KEY) return [null, null, reset];

  const widget = (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
      />
      <div ref={ref} className={quiet ? "" : "min-h-[65px]"} />
    </>
  );
  return [widget, token, reset];
}

/** 给 Better Auth 请求带上验证码 token 的 fetchOptions */
export const captchaHeaders = (token: string | null) =>
  token ? { headers: { "x-captcha-response": token } } : undefined;
