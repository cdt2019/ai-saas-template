import "server-only";
import { captureError } from "@/lib/monitoring";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { notifyAdmins } from "@/lib/notify";
import { nextRun } from "./cron";
import { getJob, JOBS } from "./registry";
import type { JobDef, JobTrigger } from "./types";

/**
 * 定时任务的执行：
 * - runJob：加锁（job.lockedUntil，多台服务器 / 多个触发同时到时只有一个在跑）→ 记一行 job_run → 执行（带超时）→ 写结果、放锁。
 *   失败会通知管理员。上一次进程崩溃留下的「运行中」记录在锁过期后标为失败
 * - runDueJobs：调度器每次被触发（外部 tick / 进程内定时器）时调用：到点的、开着的任务依次执行
 * 「到点」= 按频率算，上次运行之后的下一次时间已经过了；从没跑过的立刻跑
 */
const TICK = "__tick";
const { job, jobRun } = schema;

async function ensureRows() {
  const db = await getDb();
  await db
    .insert(job)
    .values([...JOBS.map((j) => ({ name: j.name })), { name: TICK }])
    .onConflictDoNothing();
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms))]);

export type RunResult = { job: string; runId?: string; status: "success" | "failed" | "skipped"; summary?: Record<string, unknown>; error?: string; durationMs?: number };

export async function runJob(def: JobDef, trigger: JobTrigger, opts: { params?: Record<string, unknown>; by?: string } = {}): Promise<RunResult> {
  await ensureRows();
  const db = await getDb();
  const runId = newId("run");
  const now = new Date();
  const locked = await db
    .update(job)
    .set({ lockedUntil: new Date(now.getTime() + def.timeoutMs + 60_000), lockedBy: runId })
    .where(and(eq(job.name, def.name), or(isNull(job.lockedUntil), lt(job.lockedUntil, now))))
    .returning({ name: job.name });
  if (locked.length === 0) return { job: def.name, status: "skipped", error: "already running" };

  // 锁是过期后才拿到的：之前那次多半是进程崩溃 / 被平台超时杀掉，留下的「运行中」记录标为失败
  await db
    .update(jobRun)
    .set({ status: "failed", finishedAt: now, error: "did not finish (process stopped or timed out)" })
    .where(and(eq(jobRun.job, def.name), eq(jobRun.status, "running")));
  await db.insert(jobRun).values({ id: runId, job: def.name, trigger, triggeredBy: opts.by ?? null, status: "running", startedAt: now });

  const lines: string[] = [];
  const log = (line: string) => {
    if (lines.length < 200) lines.push(`${new Date().toISOString().slice(11, 19)} ${line}`.slice(0, 1000));
  };
  let status: RunResult["status"] = "success";
  let summary: Record<string, unknown> | undefined;
  let error: string | undefined;
  try {
    summary = await withTimeout(def.run({ log, params: opts.params ?? {}, trigger }), def.timeoutMs);
  } catch (e) {
    status = "failed";
    error = (e as Error).message || String(e);
    log(`error: ${error}`);
    console.error(`[jobs] ${def.name} failed:`, e);
    await captureError(e, { tags: { area: "jobs", job: def.name } });
  }
  const durationMs = Date.now() - now.getTime();
  await db
    .update(jobRun)
    .set({
      status,
      finishedAt: new Date(),
      durationMs,
      summary: summary ? JSON.stringify(summary).slice(0, 20_000) : null,
      error: error?.slice(0, 2000) ?? null,
      log: lines.join("\n"),
    })
    .where(eq(jobRun.id, runId));
  await db.update(job).set({ lockedUntil: null, lockedBy: null, lastRunAt: now, lastStatus: status }).where(eq(job.name, def.name));
  if (status === "failed") {
    await notifyAdmins({ type: "admin_job_failed", params: { job: def.name, error: error ?? "" }, link: "/admin/jobs", refId: runId });
  }
  return { job: def.name, runId, status, summary, error, durationMs };
}

export async function runJobByName(name: string, trigger: JobTrigger, opts: { params?: Record<string, unknown>; by?: string } = {}) {
  const def = getJob(name);
  if (!def) return { job: name, status: "failed" as const, error: "unknown job" };
  return runJob(def, trigger, opts);
}

/** 调度器被触发：记下触发时间（后台据此判断「时钟停了没有」），然后执行所有到点的任务 */
export async function runDueJobs(trigger: Exclude<JobTrigger, "manual">): Promise<RunResult[]> {
  await ensureRows();
  const db = await getDb();
  const now = new Date();
  await db.update(job).set({ lastRunAt: now, lastStatus: trigger }).where(eq(job.name, TICK));
  const rows = await db.select().from(job);
  const results: RunResult[] = [];
  for (const def of JOBS) {
    const row = rows.find((r) => r.name === def.name);
    if (!row?.enabled) continue;
    const next = row.lastRunAt ? nextRun(row.schedule ?? def.schedule, row.lastRunAt) : now;
    if (next && next <= now) results.push(await runJob(def, trigger));
  }
  return results;
}

/** 每个任务现在的状态（后台用）：频率、开关、上次运行、下次运行 */
export async function jobStates() {
  await ensureRows();
  const db = await getDb();
  const rows = await db.select().from(job);
  return JOBS.map((def) => {
    const row = rows.find((r) => r.name === def.name);
    const schedule = row?.schedule ?? def.schedule;
    const running = !!row?.lockedUntil && row.lockedUntil > new Date();
    return {
      name: def.name,
      schedule,
      defaultSchedule: def.schedule,
      enabled: row?.enabled ?? true,
      running,
      lastRunAt: row?.lastRunAt ?? null,
      lastStatus: row?.lastStatus ?? null,
      nextRunAt: row?.lastRunAt ? nextRun(schedule, row.lastRunAt) : null,
    };
  });
}

/**
 * 调度器健康：最近一次被触发的时间，超过预期间隔的两倍（再加 10 分钟余量）还没被触发，就算「时钟停了」——
 * 多半是换了部署平台、忘了配 Vercel Cron / GitHub Actions / crontab，或者 CRON_SECRET 不对
 */
export async function schedulerHealth() {
  await ensureRows();
  const db = await getDb();
  const [tick] = await db.select().from(job).where(eq(job.name, TICK));
  const mode = process.env.CRON_MODE === "internal" ? "internal" : "external";
  const expectedMinutes = Number(process.env.CRON_TICK_MINUTES) || (mode === "internal" ? 1 : 1440);
  const lastTickAt = tick?.lastRunAt ?? null;
  const stale = !lastTickAt || Date.now() - lastTickAt.getTime() > (expectedMinutes * 2 + 10) * 60_000;
  return { mode, expectedMinutes, lastTickAt, lastTrigger: tick?.lastStatus ?? null, stale };
}
