import "server-only";
import { runIssueChecks } from "@/lib/issues";
import { sweepPendingGenerations } from "@/lib/ai/video";
import { sendNewsletterBatch } from "@/lib/newsletter";
import { reconcilePendingOrders, reconcileRecent } from "@/lib/payments/reconcile";
import { runCleanup, runLedgerChecks } from "./ledger";
import type { JobDef } from "./types";

/**
 * 所有定时任务在这里登记（相当于 Spring 的 @Scheduled）：名字、默认频率（cron，UTC）、超时、要做的事。
 * 频率和开关可以在后台「定时任务」页改（存在 job 表，覆盖这里的默认值）；运行记录在 job_run。
 * 加任务：在下面加一项，后台就能看到、手动运行、按频率自动跑
 */
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);

export const JOBS: JobDef[] = [
  {
    // 下单后一直没收到付款回调的订单：去支付平台查一次，付了就补单；24 小时没付标记 failed。
    // 顺带检查支付异常（回调出错、被拒、漏单、退款失败），新问题提醒管理员
    name: "payments.pending",
    schedule: "*/10 * * * *",
    timeoutMs: 5 * 60_000,
    run: async (ctx) => {
      const pending = await reconcilePendingOrders({ minAgeMinutes: num(ctx.params.minAgeMinutes, 10) });
      ctx.log(`pending orders: ${JSON.stringify(pending)}`);
      const issues = await runIssueChecks(ctx.log);
      return { pending, issues };
    },
  },
  {
    // 拉支付平台最近 48 小时的付款、退款，和本地比；核对有效订阅的状态。漏掉的补上，新问题提醒管理员
    name: "payments.reconcile",
    schedule: "17 3 * * *",
    timeoutMs: 15 * 60_000,
    run: async (ctx) => {
      const reconcile = await reconcileRecent({ hours: Math.min(24 * 30, Math.max(1, num(ctx.params.hours, 48))) });
      ctx.log(`reconcile: ${JSON.stringify(reconcile)}`);
      const issues = await runIssueChecks(ctx.log);
      return { reconcile, issues };
    },
  },
  {
    // 账务检查，再把支付异常也复查一遍（后台「立即检查」跑的就是它），新问题一起提醒
    name: "ledger.check",
    schedule: "20 3 * * *",
    timeoutMs: 10 * 60_000,
    run: async (ctx) => {
      const { opened, ...ledger } = await runLedgerChecks(ctx);
      const issues = await runIssueChecks(ctx.log, opened);
      return { ...ledger, issues };
    },
  },
  {
    // 没人再来查的 AI 任务：视频去平台查结果，超时或中途退出的自动退积分
    name: "ai.sweep",
    schedule: "*/10 * * * *",
    timeoutMs: 5 * 60_000,
    run: (ctx) => sweepPendingGenerations(ctx.log),
  },
  {
    // 发 Newsletter：没有待发的群发时什么都不做，有的话每次发一批
    name: "newsletter.send",
    schedule: "*/10 * * * *",
    timeoutMs: 8 * 60_000,
    run: (ctx) => sendNewsletterBatch(ctx.log),
  },
  {
    name: "cleanup",
    schedule: "25 3 * * *",
    timeoutMs: 10 * 60_000,
    run: (ctx) => runCleanup(ctx),
  },
];

export const getJob = (name: string) => JOBS.find((j) => j.name === name);
