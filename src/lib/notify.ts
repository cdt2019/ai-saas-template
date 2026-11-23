import "server-only";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { siteConfig } from "@/config/site";
import { getDb, schema } from "@/db";
import { adminEmails } from "./admin-emails";
import { emailLayout, sendEmail } from "./email";
import { newId } from "./ids";

/**
 * 站内通知：业务事件发生时写一条（支付成功、订阅变化、退款、积分变动、视频生成……），
 * 前端每 30 秒轮询 /api/me/pulse 取新的，弹出提示 + 铃铛未读数。重要的事件同时发邮件。
 * 通知只存类型和参数，文字由前端按语言生成（src/lib/notification-text.ts）。
 * 通知失败只记日志、不抛错：不能因为通知写不进去，把付款、发积分这些正事搞失败
 */
export type NotificationType =
  | "payment_succeeded"
  | "subscription_started"
  | "subscription_trial"
  | "subscription_renewed"
  | "subscription_past_due"
  | "subscription_recovered"
  | "subscription_canceling"
  | "subscription_ended"
  | "refund_requested"
  | "refund_approved"
  | "refund_rejected"
  | "refund_failed"
  | "refund_completed"
  | "credits_adjusted"
  | "signup_bonus"
  | "credits_low"
  | "video_ready"
  | "video_failed"
  | "admin_refund_request"
  | "admin_issues"
  | "admin_job_failed"
  | "admin_scheduler_stalled";

export type NotificationParams = Record<string, string | number | null | undefined>;

type Email = { subject: string; title: string; body: string; action?: string };

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || siteConfig.url).replace(/\/$/, "");

/**
 * 发一条通知。refId：同一件事只通知一次（回调重推、定时任务补单时不会重复）。
 * email：同时给用户发邮件（action 是按钮文字，链接用 link）。返回是否新写了一条
 */
export async function notify(opts: {
  userId: string;
  type: NotificationType;
  params?: NotificationParams;
  link?: string;
  refId?: string;
  email?: Email;
}): Promise<boolean> {
  try {
    const db = await getDb();
    const rows = await db
      .insert(schema.notification)
      .values({
        id: newId("ntf"),
        userId: opts.userId,
        type: opts.type,
        params: JSON.stringify(opts.params ?? {}),
        link: opts.link ?? null,
        // 类型做前缀：不同类型的通知可以用同一个业务 id（订单号、退款号）
        refId: opts.refId ? `${opts.type}:${opts.refId}` : null,
      })
      .onConflictDoNothing({ target: schema.notification.refId })
      .returning({ id: schema.notification.id });
    if (rows.length === 0) return false;
    if (opts.email) {
      const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, opts.userId));
      if (u) {
        await sendEmail({
          to: u.email,
          subject: opts.email.subject,
          html: emailLayout({
            title: opts.email.title,
            body: opts.email.body,
            action: opts.email.action && opts.link ? { label: opts.email.action, url: `${siteUrl()}${opts.link}` } : undefined,
          }),
        });
      }
    }
    return true;
  } catch (e) {
    console.error(`[notify] ${opts.type} for ${opts.userId} failed:`, e);
    return false;
  }
}

/** 通知所有管理员（数据库 role=admin，或 ADMIN_EMAILS 里已验证的邮箱） */
export async function notifyAdmins(opts: { type: NotificationType; params?: NotificationParams; link?: string; refId: string }) {
  try {
    const db = await getDb();
    const emails = adminEmails();
    const { user } = schema;
    const admins = await db
      .select({ id: user.id })
      .from(user)
      .where(
        emails.length
          ? or(eq(user.role, "admin"), and(eq(user.emailVerified, true), inArray(sql`lower(${user.email})`, emails)))
          : eq(user.role, "admin"),
      );
    for (const a of admins) await notify({ ...opts, userId: a.id, refId: `${opts.refId}:${a.id}` });
  } catch (e) {
    console.error(`[notify] admin ${opts.type} failed:`, e);
  }
}

/** 余额跌破这个数提醒一次（再充值回到这个数以上，下次跌破再提醒） */
export const LOW_CREDITS = Number(process.env.LOW_CREDITS_THRESHOLD ?? 5);

export async function notifyIfLow(userId: string, before: number, after: number) {
  if (LOW_CREDITS > 0 && before >= LOW_CREDITS && after < LOW_CREDITS) {
    await notify({ userId, type: "credits_low", params: { balance: after }, link: "/pricing" });
  }
}

/** 设置页的通知列表：分页，新的在前 */
export async function listNotifications(userId: string, page: { offset: number; size: number; filters?: Record<string, string> }) {
  const db = await getDb();
  const n = schema.notification;
  const mine = eq(n.userId, userId);
  const unreadOnly = and(mine, isNull(n.readAt));
  const cond = page.filters?.view === "unread" ? unreadOnly : mine;
  const [rows, [{ total }], [{ all }], [{ unread }]] = await Promise.all([
    db.select().from(n).where(cond).orderBy(desc(n.createdAt), desc(n.id)).limit(page.size).offset(page.offset),
    db.select({ total: count() }).from(n).where(cond),
    db.select({ all: count() }).from(n).where(mine),
    db.select({ unread: count() }).from(n).where(unreadOnly),
  ]);
  return {
    total,
    all,
    unread,
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      params: JSON.parse(r.params ?? "{}") as Record<string, string | number | null>,
      link: r.link,
      read: !!r.readAt,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
