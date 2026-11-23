import { NextResponse } from "next/server";
import { cronCaller } from "@/lib/jobs/auth";
import { runDueJobs } from "@/lib/jobs/runner";

/** 到点的任务可能要逐个查支付平台，给足时间（Vercel Hobby 最多 60 秒，Pro 最多 800 秒，超出按平台上限截断） */
export const maxDuration = 300;

/**
 * 调度器的统一入口：GET / POST /api/cron/tick → 执行所有到点的定时任务（任务和频率在 src/lib/jobs/registry.ts，后台可改）。
 * 谁来定时调用都行：Vercel Cron（vercel.json）、GitHub Actions（.github/workflows/cron.yml）、cron-job.org、服务器 crontab。
 * 鉴权：Authorization: Bearer <CRON_SECRET>，或管理员登录后在浏览器里打开
 */
async function tick(request: Request) {
  if (!(await cronCaller(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const runs = await runDueJobs("tick");
  return NextResponse.json({ ran: runs.length, runs, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = tick;
export const POST = tick;
