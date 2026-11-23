import "server-only";
import { runDueJobs } from "./runner";

/**
 * 进程内定时器（CRON_MODE=internal 时由 src/instrumentation.ts 在服务启动时开启）：每分钟检查一次到点的任务，
 * 适合 `next start` 一直在跑的部署（服务器、Docker）。多台服务器同时开着也只会有一台跑同一个任务（数据库锁）。
 * Serverless（Vercel 等）没有常驻进程，用外部定时调用 /api/cron/tick
 */
const globalForScheduler = globalThis as unknown as { __jobScheduler?: ReturnType<typeof setInterval> };

export function startInternalScheduler() {
  if (globalForScheduler.__jobScheduler) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueJobs("internal");
    } catch (e) {
      console.error("[jobs] internal tick failed:", e);
    } finally {
      busy = false;
    }
  };
  globalForScheduler.__jobScheduler = setInterval(tick, 60_000);
  // 启动后稍等一下再跑第一次，别和服务启动抢资源
  setTimeout(tick, 15_000);
  console.info("[jobs] internal scheduler started (checks due jobs every minute)");
}
