"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { RotateCcw, TriangleAlert } from "lucide-react";

const TEXT = {
  en: { title: "Something went wrong", body: "This page hit an error. Try again, and if it keeps happening, contact support.", retry: "Try again", home: "Back to home", ref: "Reference" },
  zh: { title: "页面出错了", body: "这个页面遇到了错误。请重试，如果一直这样，请联系客服。", retry: "重试", home: "回到首页", ref: "错误编号" },
};

/** 页面渲染出错时的兜底界面：上报错误监控（配了才发），用户可以重试 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useParams<{ lang?: string }>()?.lang;
  const t = lang === "zh" ? TEXT.zh : TEXT.en;

  useEffect(() => {
    console.error(error);
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-danger-soft text-danger-fg">
          <TriangleAlert className="size-5" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">{t.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-2">{t.body}</p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-fg-3">
            {t.ref}: {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary btn-sm">
            <RotateCcw className="size-3.5" /> {t.retry}
          </button>
          <a href={lang === "zh" ? "/zh" : "/"} className="btn btn-secondary btn-sm">
            {t.home}
          </a>
        </div>
      </div>
    </main>
  );
}
