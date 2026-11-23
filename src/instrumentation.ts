import type { Instrumentation } from "next";

/**
 * 服务启动时执行一次（Next.js instrumentation）。
 * - 配了 SENTRY_DSN：初始化错误监控（只上报错误；性能追踪默认关，SENTRY_TRACES_SAMPLE_RATE 可开）
 * - CRON_MODE=internal：开启进程内定时器，定时任务自己跑，不需要外部定时服务（见 src/lib/jobs/scheduler.ts）
 */
export async function register() {
  if (process.env.SENTRY_DSN) {
    const [Sentry, { PRIVATE_DATA_COLLECTION, scrubEvent }] = await Promise.all([import("@sentry/nextjs"), import("./lib/monitoring-scrub")]);
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
      dataCollection: PRIVATE_DATA_COLLECTION,
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
    });
  }
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CRON_MODE !== "internal") return;
  const { startInternalScheduler } = await import("./lib/jobs/scheduler");
  startInternalScheduler();
}

/** 页面和接口里没被捕获的错误 */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
