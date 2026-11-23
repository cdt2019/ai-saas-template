import "server-only";
import { and, asc, count, desc, eq, gt, ilike, inArray, max, ne, not, or, sql, sum, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { adminEmails, isAdminUser } from "./admin";
import { newId } from "./ids";
import type { TableQuery } from "./table";
import { inRange } from "./table-db";
import { getAccountTiers } from "./tier";

/**
 * 后台「用户」模块的查询和操作：列表（搜索 / 筛选 / 注册日期 / 排序 / 分页）、详情各标签页（按日期范围）、
 * 改角色、封禁 / 解封、踢下线、删除。每个操作都写一条 admin_log。
 * 封禁的拦截在 src/lib/auth.ts（建登录会话之前检查）。数据量大时只查当前一页，总数单独 count
 */
const { user, session, payment, order, subscription, refundRequest, creditTransaction, generation, adminLog } = schema;

export const USER_FILTERS = {
  status: ["active", "unverified", "banned"],
  paid: ["yes", "no"],
  role: ["admin", "user"],
} as const;
export const USER_SORTS = ["created", "credits", "paid", "email"];

/** ILIKE 里的 % _ \ 当普通字符 */
const like = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** 现在仍在封禁中（永久，或还没到期） */
const bannedNow = sql<boolean>`(${user.banned} and (${user.banExpires} is null or ${user.banExpires} > now()))`;
/*
 * 关联子查询手写带表名的 SQL：drizzle 在单表查询里不给列名加表名，
 * 写成 ${payment.userId} = ${user.id} 会变成 "user_id" = "id"，两个都被当成 payment 自己的列，永远对不上
 */
const USER_ID = sql.raw(`"user"."id"`);
/** 实付合计（减去已退款），分 */
const paidNet = sql<number>`coalesce((select sum(p.amount - p.refunded_amount) from payment p where p.user_id = ${USER_ID}), 0)::int`;
const hasPayment = sql<boolean>`exists (select 1 from payment p where p.user_id = ${USER_ID})`;
const lastActive = sql<Date | null>`(select max(s.updated_at) from session s where s.user_id = ${USER_ID})`;

export async function listUsers(query: TableQuery) {
  const db = await getDb();
  const where: SQL[] = [];
  if (query.q) {
    const term = like(query.q);
    where.push(or(ilike(user.email, term), ilike(user.name, term), eq(user.id, query.q))!);
  }
  const { status, paid, role } = query.filters;
  if (status === "banned") where.push(bannedNow);
  if (status === "active") where.push(and(not(bannedNow), eq(user.emailVerified, true))!);
  if (status === "unverified") where.push(and(not(bannedNow), eq(user.emailVerified, false))!);
  if (paid === "yes") where.push(hasPayment);
  if (paid === "no") where.push(not(hasPayment));
  // 管理员 = role 为 admin，或邮箱在 ADMIN_EMAILS 里且已验证（和 src/lib/admin.ts 的判断一致）
  const envAdmins = adminEmails();
  const adminCond = envAdmins.length
    ? or(eq(user.role, "admin"), and(eq(user.emailVerified, true), inArray(sql`lower(${user.email})`, envAdmins)))!
    : eq(user.role, "admin");
  if (role === "admin") where.push(adminCond);
  if (role === "user") where.push(not(adminCond));
  const joined = inRange(query, user.createdAt);
  if (joined) where.push(joined);

  const sortCol = { created: user.createdAt, credits: user.credits, paid: paidNet, email: user.email }[query.sort] ?? user.createdAt;
  const orderBy = query.dir === "asc" ? asc(sortCol) : desc(sortCol);
  const cond = where.length ? and(...where) : undefined;

  const [rows, [{ n }]] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        role: user.role,
        credits: user.credits,
        banned: bannedNow,
        createdAt: user.createdAt,
        paidNet,
        lastActive,
      })
      .from(user)
      .where(cond)
      .orderBy(orderBy, desc(user.id))
      .limit(query.size)
      .offset(query.offset),
    db.select({ n: count() }).from(user).where(cond),
  ]);
  const tiers = await getAccountTiers(rows.map((r) => r.id));
  return {
    total: n,
    rows: rows.map((r) => ({ ...r, isAdmin: isAdminUser(r), tier: tiers.get(r.id)! })),
  };
}

export async function getUserDetail(id: string) {
  const db = await getDb();
  const [u] = await db.select().from(user).where(eq(user.id, id));
  if (!u) return null;
  const [[money], [pays], [refunds], [gens], [sessions], [active], tiers] = await Promise.all([
    db.select({ gross: sum(payment.amount), refunded: sum(payment.refundedAmount) }).from(payment).where(eq(payment.userId, id)),
    db.select({ n: count() }).from(payment).where(eq(payment.userId, id)),
    db.select({ n: count() }).from(refundRequest).where(eq(refundRequest.userId, id)),
    db.select({ n: count() }).from(generation).where(eq(generation.userId, id)),
    db.select({ n: count() }).from(session).where(and(eq(session.userId, id), gt(session.expiresAt, new Date()))),
    db.select({ at: max(session.updatedAt) }).from(session).where(eq(session.userId, id)),
    getAccountTiers([id]),
  ]);
  const banned = u.banned && (!u.banExpires || u.banExpires > new Date());
  return {
    user: u,
    banned,
    isAdmin: isAdminUser(u),
    tier: tiers.get(id)!,
    stats: {
      gross: Number(money.gross ?? 0),
      refunded: Number(money.refunded ?? 0),
      payments: pays.n,
      refunds: refunds.n,
      generations: gens.n,
      sessions: sessions.n,
      lastActive: active.at,
    },
  };
}

/* ---------------- 详情页标签：每个都分页 ---------------- */

export const USER_TABS = ["credits", "orders", "payments", "subscriptions", "refunds", "generations", "sessions", "log"] as const;
export type UserTab = (typeof USER_TABS)[number];

export async function listUserTab(userId: string, tab: UserTab, q: TableQuery) {
  const db = await getDb();
  const page = <T>(rows: Promise<T[]>, total: Promise<{ n: number }[]>) =>
    Promise.all([rows, total]).then(([r, [{ n }]]) => ({ rows: r, total: n }));
  switch (tab) {
    case "credits":
      return {
        tab,
        ...(await page(
          db
            .select()
            .from(creditTransaction)
            .where(and(eq(creditTransaction.userId, userId), inRange(q, creditTransaction.createdAt)))
            .orderBy(desc(creditTransaction.createdAt), desc(creditTransaction.id))
            .limit(q.size)
            .offset(q.offset),
          db.select({ n: count() }).from(creditTransaction).where(and(eq(creditTransaction.userId, userId), inRange(q, creditTransaction.createdAt))),
        )),
      };
    case "orders":
      return {
        tab,
        ...(await page(
          db.select().from(order).where(and(eq(order.userId, userId), inRange(q, order.createdAt))).orderBy(desc(order.createdAt)).limit(q.size).offset(q.offset),
          db.select({ n: count() }).from(order).where(and(eq(order.userId, userId), inRange(q, order.createdAt))),
        )),
      };
    case "payments":
      return {
        tab,
        ...(await page(
          db.select().from(payment).where(and(eq(payment.userId, userId), inRange(q, payment.createdAt))).orderBy(desc(payment.createdAt)).limit(q.size).offset(q.offset),
          db.select({ n: count() }).from(payment).where(and(eq(payment.userId, userId), inRange(q, payment.createdAt))),
        )),
      };
    case "subscriptions":
      return {
        tab,
        ...(await page(
          db.select().from(subscription).where(and(eq(subscription.userId, userId), inRange(q, subscription.createdAt))).orderBy(desc(subscription.createdAt)).limit(q.size).offset(q.offset),
          db.select({ n: count() }).from(subscription).where(and(eq(subscription.userId, userId), inRange(q, subscription.createdAt))),
        )),
      };
    case "refunds":
      return {
        tab,
        ...(await page(
          db.select().from(refundRequest).where(and(eq(refundRequest.userId, userId), inRange(q, refundRequest.createdAt))).orderBy(desc(refundRequest.createdAt)).limit(q.size).offset(q.offset),
          db.select({ n: count() }).from(refundRequest).where(and(eq(refundRequest.userId, userId), inRange(q, refundRequest.createdAt))),
        )),
      };
    case "generations":
      return {
        tab,
        ...(await page(
          db.select().from(generation).where(and(eq(generation.userId, userId), inRange(q, generation.createdAt))).orderBy(desc(generation.createdAt)).limit(q.size).offset(q.offset),
          db.select({ n: count() }).from(generation).where(and(eq(generation.userId, userId), inRange(q, generation.createdAt))),
        )),
      };
    case "sessions":
      return {
        tab,
        ...(await page(
          db
            .select({
              id: session.id,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              expiresAt: session.expiresAt,
            })
            .from(session)
            .where(and(eq(session.userId, userId), inRange(q, session.createdAt, session.updatedAt)))
            .orderBy(desc(session.updatedAt))
            .limit(q.size)
            .offset(q.offset),
          db.select({ n: count() }).from(session).where(and(eq(session.userId, userId), inRange(q, session.createdAt, session.updatedAt))),
        )),
      };
    case "log":
      return {
        tab,
        ...(await page(
          db.select().from(adminLog).where(and(eq(adminLog.targetUserId, userId), inRange(q, adminLog.createdAt))).orderBy(desc(adminLog.createdAt)).limit(q.size).offset(q.offset),
          db.select({ n: count() }).from(adminLog).where(and(eq(adminLog.targetUserId, userId), inRange(q, adminLog.createdAt))),
        )),
      };
  }
}
export type UserTabData = Awaited<ReturnType<typeof listUserTab>>;

/* ---------------- 操作 ---------------- */

type Admin = { id: string; email: string };
type Target = typeof schema.user.$inferSelect;
export type UserActionError =
  | "not_found"
  | "self"
  | "target_admin"
  | "has_payments"
  | "invalid_input";

export async function logAdminAction(admin: Admin, action: string, target: { id: string; email: string } | null, detail: string) {
  const db = await getDb();
  await db.insert(adminLog).values({
    id: newId("alog"),
    adminEmail: admin.email,
    action,
    targetUserId: target?.id ?? null,
    targetEmail: target?.email ?? null,
    detail: detail.slice(0, 1000),
  });
}

async function loadTarget(admin: Admin, id: string): Promise<Target | UserActionError> {
  const db = await getDb();
  const [t] = await db.select().from(user).where(eq(user.id, id));
  if (!t) return "not_found";
  // 不能对自己做这些操作：把自己封了、降级了、删了，后台就进不来了
  if (t.id === admin.id) return "self";
  return t;
}

export async function setUserRole(admin: Admin, id: string, role: string): Promise<{ ok: true } | { error: UserActionError }> {
  if (role !== "admin" && role !== "user") return { error: "invalid_input" };
  const t = await loadTarget(admin, id);
  if (typeof t === "string") return { error: t };
  const db = await getDb();
  await db.update(user).set({ role }).where(eq(user.id, id));
  await logAdminAction(admin, "set_role", t, `${t.role} → ${role}`);
  return { ok: true };
}

/** 封禁：days 为空表示永久。同时踢掉这个人所有的登录 */
export async function banUser(admin: Admin, id: string, reason: string, days: number | null): Promise<{ ok: true } | { error: UserActionError }> {
  if (!reason.trim() || (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))) return { error: "invalid_input" };
  const t = await loadTarget(admin, id);
  if (typeof t === "string") return { error: t };
  if (isAdminUser(t)) return { error: "target_admin" };
  const db = await getDb();
  const expires = days ? new Date(Date.now() + days * 86_400_000) : null;
  await db.update(user).set({ banned: true, banReason: reason.trim().slice(0, 500), banExpires: expires }).where(eq(user.id, id));
  await db.delete(session).where(eq(session.userId, id));
  await logAdminAction(admin, "ban", t, `${days ? `${days} days` : "permanent"}: ${reason.trim()}`);
  return { ok: true };
}

export async function unbanUser(admin: Admin, id: string): Promise<{ ok: true } | { error: UserActionError }> {
  const t = await loadTarget(admin, id);
  if (typeof t === "string") return { error: t };
  const db = await getDb();
  await db.update(user).set({ banned: false, banReason: null, banExpires: null }).where(eq(user.id, id));
  await logAdminAction(admin, "unban", t, t.banReason ? `was: ${t.banReason}` : "");
  return { ok: true };
}

/** 踢下线：删掉这个人所有的登录会话，下次请求就要重新登录 */
export async function revokeUserSessions(admin: Admin, id: string): Promise<{ ok: true; count: number } | { error: UserActionError }> {
  const t = await loadTarget(admin, id);
  if (typeof t === "string") return { error: t };
  const db = await getDb();
  const gone = await db.delete(session).where(eq(session.userId, id)).returning({ id: session.id });
  await logAdminAction(admin, "revoke_sessions", t, `${gone.length} session(s)`);
  return { ok: true, count: gone.length };
}

/**
 * 删除账号：只能删没有付过款的（付款、订单是账务记录，删了就对不上账；这种用封禁）。
 * 管理员不能删。会连带删除积分流水、AI 记录、登录会话
 */
export async function deleteUser(admin: Admin, id: string, confirmEmail: string): Promise<{ ok: true } | { error: UserActionError }> {
  const t = await loadTarget(admin, id);
  if (typeof t === "string") return { error: t };
  if (confirmEmail.trim().toLowerCase() !== t.email.toLowerCase()) return { error: "invalid_input" };
  if (isAdminUser(t)) return { error: "target_admin" };
  const db = await getDb();
  const [[pays], [paidOrders]] = await Promise.all([
    db.select({ n: count() }).from(payment).where(eq(payment.userId, id)),
    db.select({ n: count() }).from(order).where(and(eq(order.userId, id), ne(order.status, "pending"), ne(order.status, "failed"))),
  ]);
  if (pays.n > 0 || paidOrders.n > 0) return { error: "has_payments" };
  await db.delete(user).where(eq(user.id, id));
  await logAdminAction(admin, "delete", t, `${t.name} <${t.email}>, ${t.credits} credits`);
  return { ok: true };
}
