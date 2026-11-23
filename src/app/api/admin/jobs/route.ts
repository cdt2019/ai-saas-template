import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAdminSession } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-users";
import { isValidCron } from "@/lib/jobs/cron";
import { getJob } from "@/lib/jobs/registry";
import { runJob } from "@/lib/jobs/runner";

/** 运行一次任务可能要查支付平台，给足时间 */
export const maxDuration = 300;

/**
 * 后台管理定时任务：POST { name, action, ... }
 * - run { params? }：立即运行一次（和定时运行一样加锁、记运行历史）
 * - enable / disable：开关（关掉后调度器不再自动跑，手动仍可运行）
 * - schedule { schedule }：改频率（cron，UTC）；传空字符串恢复默认
 * 每次操作写进 admin_log
 */
export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { name?: string; action?: string; params?: Record<string, unknown>; schedule?: string };
  const def = getJob(String(body.name ?? ""));
  if (!def) return Response.json({ error: "unknown_job" }, { status: 404 });
  const admin = { id: session.user.id, email: session.user.email };
  const db = await getDb();

  if (body.action === "run") {
    const params = body.params && typeof body.params === "object" ? body.params : {};
    const result = await runJob(def, "manual", { params, by: admin.email });
    await logAdminAction(admin, "run_job", null, `${def.name}: ${result.status}${result.error ? ` (${result.error})` : ""}`);
    return Response.json(result, { status: result.status === "skipped" ? 409 : 200 });
  }
  if (body.action === "enable" || body.action === "disable") {
    await db.insert(schema.job).values({ name: def.name }).onConflictDoNothing();
    await db.update(schema.job).set({ enabled: body.action === "enable" }).where(eq(schema.job.name, def.name));
    await logAdminAction(admin, `${body.action}_job`, null, def.name);
    return Response.json({ ok: true });
  }
  if (body.action === "schedule") {
    const schedule = String(body.schedule ?? "").trim();
    if (schedule && !isValidCron(schedule)) return Response.json({ error: "invalid_cron" }, { status: 400 });
    await db.insert(schema.job).values({ name: def.name }).onConflictDoNothing();
    await db.update(schema.job).set({ schedule: schedule || null }).where(eq(schema.job.name, def.name));
    await logAdminAction(admin, "schedule_job", null, `${def.name}: ${schedule || `default (${def.schedule})`}`);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "invalid_action" }, { status: 400 });
}
