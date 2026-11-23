import { and, asc, count, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isAdminUser } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { schedulerHealth } from "@/lib/jobs/runner";
import { openIssueCounts } from "@/lib/issues";
import { notifyAdmins } from "@/lib/notify";
import { getAccountTier } from "@/lib/tier";

/**
 * 管理员的心跳顺便检查调度器：线上超过预期时间没被触发（换了部署、忘了配定时调用），每天提醒一次。
 * 每个进程最多 10 分钟查一次；本地开发不提醒（本地通常不跑定时任务，后台「定时任务」页有提示）
 */
let lastSchedulerCheck = 0;
async function checkScheduler() {
  if (process.env.NODE_ENV !== "production" || Date.now() - lastSchedulerCheck < 10 * 60_000) return;
  lastSchedulerCheck = Date.now();
  const health = await schedulerHealth();
  if (health.stale) {
    await notifyAdmins({
      type: "admin_scheduler_stalled",
      params: { since: health.lastTickAt?.toISOString() ?? null },
      link: "/admin/jobs",
      refId: `stalled_${new Date().toISOString().slice(0, 10)}`,
    });
  }
}

/**
 * 前端轮询的「心跳」：GET /api/me/pulse?after=<上次看到的最新通知时间>
 * 一次返回积分余额、账户等级、未读数、新通知（管理员另带待审核退款数、待处理问题数，给后台导航角标），页面据此刷新右上角积分、铃铛和弹出提示。
 * 只走索引查询，页面在前台时每 30 秒一次；没带 after 时返回最近 10 条（首次加载，不弹提示）
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const raw = new URL(request.url).searchParams.get("after");
  const after = raw ? new Date(raw) : null;
  const since = after && !Number.isNaN(after.getTime()) ? after : null;
  const isAdmin = isAdminUser(session.user);
  if (isAdmin) await checkScheduler().catch(() => {});

  const db = await getDb();
  const { notification: n, user, refundRequest } = schema;
  const [[me], tier, [{ unread }], items, admin] = await Promise.all([
    db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)),
    getAccountTier(userId),
    db
      .select({ unread: count() })
      .from(n)
      .where(and(eq(n.userId, userId), isNull(n.readAt))),
    since
      ? db
          .select()
          .from(n)
          .where(and(eq(n.userId, userId), gt(n.createdAt, since)))
          .orderBy(asc(n.createdAt))
          .limit(20)
      : db.select().from(n).where(eq(n.userId, userId)).orderBy(desc(n.createdAt)).limit(10),
    isAdmin
      ? Promise.all([db.select({ pending: count() }).from(refundRequest).where(eq(refundRequest.status, "pending")), openIssueCounts()]).then(([[r], issues]) => ({
          pendingRefunds: r.pending,
          openIssues: issues.errors + issues.warnings,
        }))
      : Promise.resolve(null),
  ]);

  return Response.json(
    {
      credits: me?.credits ?? 0,
      tier: { kind: tier.kind, planId: tier.planId, isAdmin },
      unread,
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        params: JSON.parse(i.params ?? "{}"),
        link: i.link,
        read: !!i.readAt,
        createdAt: i.createdAt.toISOString(),
      })),
      admin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
