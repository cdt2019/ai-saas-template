import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { siteConfig, type Locale } from "@/config/site";
import { getDb, schema } from "@/db";
import { isDisposableEmail } from "./abuse";
import { emailLayout, sendEmail } from "./email";
import { isLocalDev } from "./env";
import { newId } from "./ids";
import { captureError } from "./monitoring";
import { absoluteUrl } from "./paths";
import type { TableQuery } from "./table";
import { inRange } from "./table-db";

/**
 * Newsletter：
 * - 订阅是双重确认：先发确认邮件，用户在页面上点按钮才生效（只点链接不算，邮箱的安全扫描会自动访问链接）
 * - 接口不暴露邮箱是否已订阅；同一邮箱 1 小时内不重复发确认信，防止被拿来轰炸别人
 * - 每封邮件带退订链接和 RFC 8058 一键退订头（Gmail / Yahoo 对群发的要求）
 * - 群发：先把收件人写进 newsletter_delivery，由定时任务 newsletter.send 分批发。发到一半中断的那封记为失败、不重发，宁可少发不重复发
 */
const { newsletterSubscriber: sub, newsletterCampaign: campaign, newsletterDelivery: delivery } = schema;

export const SUBSCRIBER_STATUSES = ["active", "pending", "unsubscribed"] as const;
export const AUDIENCES = ["all", ...siteConfig.locales] as const;
export type Audience = (typeof AUDIENCES)[number];

const RESEND_COOLDOWN_MS = 3_600_000;
/** Resend 默认每秒 2 封，本机写文件不用等 */
const SEND_GAP_MS = 600;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const like = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const where = (conds: (SQL | undefined)[]) => {
  const list = conds.filter(Boolean) as SQL[];
  return list.length ? and(...list) : undefined;
};
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const newToken = () => randomBytes(24).toString("base64url");
const pageUrl = (locale: string, action: "confirm" | "unsubscribe", token: string) =>
  `${absoluteUrl(locale as Locale, "/newsletter")}?action=${action}&token=${encodeURIComponent(token)}`;

export const normalizeEmail = (email: unknown) => (typeof email === "string" ? email.trim().toLowerCase() : "");
export const isValidEmail = (email: string) => email.length <= 254 && EMAIL_RE.test(email) && !isDisposableEmail(email);

/** 纯文本正文 → 邮件 HTML：先转义，空行分段，http(s) 链接可点 */
export function renderBody(text: string) {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((p) => escapeHtml(p.trim()).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#e8488a">${u}</a>`).replace(/\r?\n/g, "<br>"))
    .join('</p><p style="font-size:15px;line-height:1.6;color:#574d66;margin:16px 0 0">');
}

const CONFIRM_TEXT = {
  en: { subject: `Confirm your ${siteConfig.name} subscription`, title: "Confirm your subscription", body: "Press the button to start receiving updates. If you didn't sign up, ignore this email and nothing will happen.", action: "Confirm subscription", footer: "You're receiving this because this address was entered on our newsletter form." },
  zh: { subject: `请确认订阅 ${siteConfig.name}`, title: "确认订阅", body: "点击按钮后开始接收更新。如果不是你本人订阅的，忽略这封邮件即可。", action: "确认订阅", footer: "你收到这封邮件，是因为有人在我们的订阅表单里填了这个地址。" },
};

async function sendConfirmation(email: string, locale: string, token: string) {
  const t = locale === "zh" ? CONFIRM_TEXT.zh : CONFIRM_TEXT.en;
  return sendEmail({ to: email, subject: t.subject, html: emailLayout({ title: t.title, body: t.body, action: { label: t.action, url: pageUrl(locale, "confirm", token) }, footer: t.footer }) });
}

/** 订阅：调用方不管结果都回同样的响应，外部看不出这个邮箱是否已订阅 */
export async function subscribe(email: string, locale: string) {
  const db = await getDb();
  const lang = (siteConfig.locales as readonly string[]).includes(locale) ? locale : siteConfig.defaultLocale;
  const [row] = await db.select().from(sub).where(eq(sub.email, email));
  if (!row) {
    const token = newToken();
    const created = await db.insert(sub).values({ id: newId("sub"), email, locale: lang, token }).onConflictDoNothing().returning({ id: sub.id });
    if (created.length) await sendConfirmation(email, lang, token);
    return;
  }
  if (row.status === "active") return;
  if (row.confirmSentAt && Date.now() - row.confirmSentAt.getTime() < RESEND_COOLDOWN_MS) return;
  await db.update(sub).set({ status: "pending", locale: lang, confirmSentAt: new Date() }).where(eq(sub.id, row.id));
  await sendConfirmation(email, lang, row.token);
}

export async function confirmSubscription(token: string) {
  const db = await getDb();
  const done = await db
    .update(sub)
    .set({ status: "active", confirmedAt: new Date(), unsubscribedAt: null })
    .where(and(eq(sub.token, token), inArray(sub.status, ["pending", "active"])))
    .returning({ id: sub.id });
  return done.length > 0;
}

export async function unsubscribeByToken(token: string) {
  const db = await getDb();
  const [row] = await db.select({ id: sub.id, status: sub.status }).from(sub).where(eq(sub.token, token));
  if (!row) return false;
  if (row.status !== "unsubscribed") await db.update(sub).set({ status: "unsubscribed", unsubscribedAt: new Date() }).where(eq(sub.id, row.id));
  return true;
}

/* ---------------- 后台 ---------------- */

export async function listSubscribers(q: TableQuery) {
  const db = await getDb();
  const base = [q.q ? ilike(sub.email, like(q.q)) : undefined, q.filters.locale ? eq(sub.locale, q.filters.locale) : undefined, inRange(q, sub.createdAt)];
  const cond = where([...base, q.filters.status ? eq(sub.status, q.filters.status) : undefined]);
  const [rows, [{ n }], byStatus] = await Promise.all([
    db.select({ id: sub.id, email: sub.email, locale: sub.locale, status: sub.status, createdAt: sub.createdAt, confirmedAt: sub.confirmedAt, unsubscribedAt: sub.unsubscribedAt }).from(sub).where(cond).orderBy(desc(sub.createdAt), desc(sub.id)).limit(q.size).offset(q.offset),
    db.select({ n: count() }).from(sub).where(cond),
    db.select({ status: sub.status, n: count() }).from(sub).where(where(base)).groupBy(sub.status),
  ]);
  return { rows, total: n, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number> };
}

/** 导出：只含运营需要的字段，不含退订令牌 */
export async function exportSubscribers(status?: string) {
  const db = await getDb();
  return db
    .select({ email: sub.email, locale: sub.locale, status: sub.status, createdAt: sub.createdAt, confirmedAt: sub.confirmedAt, unsubscribedAt: sub.unsubscribedAt })
    .from(sub)
    .where(status ? eq(sub.status, status) : undefined)
    .orderBy(desc(sub.createdAt));
}

/** CSV 单元格：转义引号；以 = + - @ 开头的加 '，防止 Excel 把内容当公式执行 */
export const csvCell = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? "");
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function audienceCounts() {
  const db = await getDb();
  const rows = await db.select({ locale: sub.locale, n: count() }).from(sub).where(eq(sub.status, "active")).groupBy(sub.locale);
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.locale] = r.n;
    out.all += r.n;
  }
  return out;
}

export async function listCampaigns(limit = 10) {
  const db = await getDb();
  const rows = await db.select().from(campaign).orderBy(desc(campaign.createdAt)).limit(limit);
  if (rows.length === 0) return [];
  const stats = await db
    .select({ campaignId: delivery.campaignId, status: delivery.status, n: count() })
    .from(delivery)
    .where(inArray(delivery.campaignId, rows.map((r) => r.id)))
    .groupBy(delivery.campaignId, delivery.status);
  return rows.map((r) => {
    const by = (s: string) => stats.find((x) => x.campaignId === r.id && x.status === s)?.n ?? 0;
    return { ...r, sent: by("sent"), failed: by("failed"), skipped: by("skipped"), queued: by("pending") + by("sending") };
  });
}

function campaignEmail(c: { subject: string; body: string }, s: { locale: string; token: string }) {
  const zh = s.locale === "zh";
  const url = pageUrl(s.locale, "unsubscribe", s.token);
  return {
    subject: c.subject,
    html: emailLayout({
      title: escapeHtml(c.subject),
      body: renderBody(c.body),
      footer: `${zh ? "不想再收到？" : "Don't want these emails?"} <a href="${url}" style="color:#6e6480">${zh ? "退订" : "Unsubscribe"}</a>`,
    }),
    headers: {
      "List-Unsubscribe": `<${siteConfig.url}/api/newsletter/unsubscribe?token=${encodeURIComponent(s.token)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** 发一封测试信给管理员自己（退订链接是占位的，不影响任何订阅者） */
export function sendTestEmail(to: string, c: { subject: string; body: string }, locale: string) {
  const mail = campaignEmail(c, { locale, token: "test" });
  return sendEmail({ to, subject: `[Test] ${mail.subject}`, html: mail.html });
}

/** 创建群发：此刻的有效订阅者写进投递表，之后退订的在发送时跳过 */
export async function createCampaign(input: { subject: string; body: string; audience: Audience; by: string }) {
  const db = await getDb();
  const recipients = await db
    .select({ id: sub.id })
    .from(sub)
    .where(and(eq(sub.status, "active"), input.audience === "all" ? undefined : eq(sub.locale, input.audience)));
  if (recipients.length === 0) return null;
  const id = newId("cmp");
  await db.transaction(async (tx) => {
    await tx.insert(campaign).values({ id, subject: input.subject, body: input.body, audience: input.audience, status: "sending", total: recipients.length, createdBy: input.by });
    for (let i = 0; i < recipients.length; i += 500) {
      await tx.insert(delivery).values(recipients.slice(i, i + 500).map((r) => ({ id: newId("dlv"), campaignId: id, subscriberId: r.id })));
    }
  });
  return { id, total: recipients.length };
}

/** 定时任务 newsletter.send：发一批。任务本身有运行锁，同一时间只有一个在跑 */
export async function sendNewsletterBatch(log: (line: string) => void) {
  const db = await getDb();
  // 上次跑到一半进程没了：那封不知道发没发出去，记为失败，不重发
  const interrupted = await db.update(delivery).set({ status: "failed", error: "interrupted" }).where(eq(delivery.status, "sending")).returning({ id: delivery.id });
  const batchSize = Math.min(1000, Math.max(1, Number(process.env.NEWSLETTER_BATCH_SIZE) || 100));
  const gap = isLocalDev() && !process.env.RESEND_API_KEY ? 0 : SEND_GAP_MS;
  const open = await db.select().from(campaign).where(eq(campaign.status, "sending")).orderBy(asc(campaign.createdAt));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let budget = batchSize;
  for (const c of open) {
    if (budget > 0) {
      const batch = await db
        .select({ id: delivery.id, email: sub.email, locale: sub.locale, token: sub.token, status: sub.status })
        .from(delivery)
        .innerJoin(sub, eq(delivery.subscriberId, sub.id))
        .where(and(eq(delivery.campaignId, c.id), eq(delivery.status, "pending")))
        .limit(budget);
      for (const d of batch) {
        budget--;
        if (d.status !== "active") {
          await db.update(delivery).set({ status: "skipped" }).where(eq(delivery.id, d.id));
          skipped++;
          continue;
        }
        // 原子领取：任务超时后上一批可能还在跑，只有把 pending 改成 sending 的那一方才能发，同一个人不会收到两封
        const claimed = await db.update(delivery).set({ status: "sending" }).where(and(eq(delivery.id, d.id), eq(delivery.status, "pending"))).returning({ id: delivery.id });
        if (claimed.length === 0) continue;
        const mail = campaignEmail(c, d);
        const ok = await sendEmail({ to: d.email, ...mail }).catch((e) => {
          void captureError(e, { tags: { area: "newsletter" } });
          return false;
        });
        await db.update(delivery).set(ok ? { status: "sent", sentAt: new Date() } : { status: "failed", error: "send failed" }).where(eq(delivery.id, d.id));
        if (ok) sent++;
        else failed++;
        if (gap) await new Promise((r) => setTimeout(r, gap));
      }
    }
    const [{ left }] = await db
      .select({ left: count() })
      .from(delivery)
      .where(and(eq(delivery.campaignId, c.id), inArray(delivery.status, ["pending", "sending"])));
    if (left === 0) await db.update(campaign).set({ status: "sent", finishedAt: new Date() }).where(eq(campaign.id, c.id));
  }
  const summary = { campaigns: open.length, sent, failed, skipped, interrupted: interrupted.length };
  log(`newsletter: ${JSON.stringify(summary)}`);
  return summary;
}

/** 清理任务用：超过 30 天没确认的订阅直接删除，不留别人的邮箱 */
export async function purgeUnconfirmed() {
  const db = await getDb();
  const rows = await db
    .delete(sub)
    .where(and(eq(sub.status, "pending"), lt(sub.createdAt, new Date(Date.now() - 30 * 86_400_000)), isNull(sub.confirmedAt)))
    .returning({ id: sub.id });
  return rows.length;
}
