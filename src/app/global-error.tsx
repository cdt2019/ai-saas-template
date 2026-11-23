"use client";

import { useEffect } from "react";

/** 根布局本身出错时的兜底：样式表可能没加载，所以用行内样式 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#1e1530", color: "#f7f3f8", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <main style={{ padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.75, margin: "0 0 20px" }}>The site hit an error. Please try again.</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.6 }}>Reference: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#f7f3f8", color: "#1e1530", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
