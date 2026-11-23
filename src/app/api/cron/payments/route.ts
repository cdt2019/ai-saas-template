import { NextResponse } from "next/server";
import { cronCaller } from "@/lib/jobs/auth";
import { runJobByName } from "@/lib/jobs/runner";

/** 对账要逐个查支付平台，给足时间（Vercel Hobby 最多 60 秒，Pro 最多 800 秒，超出按平台上限截断） */
export const maxDuration = 300;

/**
 * 只跑支付相关的两个任务（老接口，保留兼容；新部署用 /api/cron/tick，它按频率跑所有任务）：
 *   GET /api/cron/payments?task=pending    下单超过 minAgeMinutes（默认 10）还没付款回调的订单，去平台查一次，付了就补单
 *   GET /api/cron/payments?task=reconcile  拉平台最近 hours（默认 48）小时的付款 / 退款，核对本地有效订阅的状态，漏掉的补上
 *   GET /api/cron/payments?task=all        两个都跑（默认）
 * 跑完检查支付异常，新开的问题提醒管理员（铃铛 + 邮件给 ADMIN_EMAILS）。每次运行都记在后台「定时任务」的运行历史里。
 * 鉴权：Authorization: Bearer <CRON_SECRET>，或管理员登录后在浏览器里打开
 */
export async function GET(request: Request) {
  const caller = await cronCaller(request);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const task = url.searchParams.get("task") ?? "all";
  if (!["pending", "reconcile", "all"].includes(task)) return NextResponse.json({ error: "unknown task" }, { status: 400 });
  const trigger = caller === "cron" ? "tick" : "manual";
  const by = caller === "cron" ? undefined : caller;
  const params = Object.fromEntries(["minAgeMinutes", "hours"].filter((k) => url.searchParams.has(k)).map((k) => [k, url.searchParams.get(k)]));

  const started = Date.now();
  const result: Record<string, unknown> = { task };
  if (task === "pending" || task === "all") {
    const run = await runJobByName("payments.pending", trigger, { params, by });
    result.pending = run.summary?.pending ?? { error: run.error ?? run.status };
    result.issues = run.summary?.issues;
  }
  if (task === "reconcile" || task === "all") {
    const run = await runJobByName("payments.reconcile", trigger, { params, by });
    result.reconcile = run.summary?.reconcile ?? { error: run.error ?? run.status };
    result.issues = run.summary?.issues ?? result.issues;
  }
  result.ms = Date.now() - started;
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
