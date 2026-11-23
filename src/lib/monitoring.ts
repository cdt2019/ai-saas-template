import "server-only";

/**
 * 错误监控（Sentry，可选）：配了 SENTRY_DSN 才生效，没配时什么都不做，也不会加载 SDK。
 * 未捕获的请求错误由 src/instrumentation.ts 自动上报；这里给「被业务捕获、但需要人知道」的错误用：
 * 定时任务失败、支付回调处理出错、AI 调用失败。发送前的脱敏见 monitoring-scrub.ts
 */
export async function captureError(error: unknown, context: { tags?: Record<string, string>; level?: "error" | "warning" } = {}) {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { tags: context.tags, level: context.level ?? "error" });
  } catch (e) {
    // 监控本身出问题不能影响业务
    console.error("[monitoring] capture failed", e);
  }
}
