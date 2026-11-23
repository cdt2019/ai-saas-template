/**
 * 浏览器端错误监控（可选）：配了 NEXT_PUBLIC_SENTRY_DSN 才按需加载 SDK，没配时不增加页面体积
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void Promise.all([import("@sentry/nextjs"), import("./lib/monitoring-scrub")]).then(([Sentry, { PRIVATE_DATA_COLLECTION, scrubEvent }]) => {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
      dataCollection: PRIVATE_DATA_COLLECTION,
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
    });
  });
}
