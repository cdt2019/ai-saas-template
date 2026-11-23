import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { getAiFeature } from "@/config/ai";
import { getDb, schema } from "@/db";
import { emailLayout, sendEmail } from "@/lib/email";
import { authSecret } from "@/lib/env";
import { notify } from "@/lib/notify";
import { failGeneration, succeedGeneration } from "./billing";
import { checkVideo, type VideoJob, type VideoStatus } from "./providers";

/**
 * 视频任务的状态同步：前端轮询（GET /api/ai/generations/[id]）和 fal 回调（/api/webhooks/fal）都调用这里。
 * - 成功：记录视频地址，给用户发邮件（用户关掉页面也能收到）
 * - 失败或超时：记录错误，自动退积分
 * succeed / fail 都只在记录还是 pending 时生效，轮询和回调同时到达也只会发一封邮件、退一次款。
 * 用户关了页面、回调又丢了时，由定时任务 ai.sweep 兜底（sweepPendingGenerations）。
 */
type Generation = typeof schema.generation.$inferSelect;

/** 超过这个时间还没出结果，判失败并退积分 */
const TIMEOUT_MS = 20 * 60 * 1000;
/** 定时任务只管创建超过 5 分钟的，刚提交的留给前端轮询和回调 */
const SWEEP_AFTER_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 100;

export async function refreshVideoGeneration(gen: Generation): Promise<Generation> {
  if (gen.status !== "pending") return gen;
  const startedAt = gen.createdAt.getTime();
  if (!gen.job) {
    // 扣了积分但没提交成功（进程在中途退出）：等到超时再退，刚创建的可能还在提交
    if (Date.now() - startedAt > TIMEOUT_MS) await failAndNotify(gen, "interrupted", startedAt);
    return reload(gen);
  }

  let status: VideoStatus;
  try {
    status = await checkVideo(JSON.parse(gen.job) as VideoJob);
  } catch (e) {
    // 查询本身失败（网络抖动等）先保持 pending，下次再查；真卡住了由超时兜底
    console.warn(`[ai] video ${gen.id} status check failed:`, e);
    status = { state: "pending" };
  }
  if (status.state === "pending" && Date.now() - startedAt > TIMEOUT_MS) status = { state: "failed", error: "timeout" };

  if (status.state === "done") {
    if (await succeedGeneration(gen.id, status.url, startedAt)) {
      await notifyVideoReady(gen.userId, status.url);
      await notify({ userId: gen.userId, type: "video_ready", link: "/studio?tab=video", refId: gen.id });
    }
  } else if (status.state === "failed") {
    await failAndNotify(gen, status.error, startedAt);
  }
  return reload(gen);
}

async function failAndNotify(gen: Generation, error: string, startedAt: number) {
  if (!(await failGeneration(gen.id, gen.userId, gen.cost, new Error(error), startedAt))) return;
  if (getAiFeature(gen.feature)?.kind === "video") {
    await notify({ userId: gen.userId, type: "video_failed", params: { credits: gen.cost }, link: "/studio?tab=video", refId: gen.id });
  }
}

async function reload(gen: Generation) {
  const db = await getDb();
  const [row] = await db.select().from(schema.generation).where(eq(schema.generation.id, gen.id));
  return row ?? gen;
}

/**
 * 定时任务 ai.sweep：处理没人再来查的 pending 记录。
 * 视频去平台查一次（出结果就结单，超时就退款）；文本、图片是同步调用，超过 20 分钟还是 pending 说明进程中途退出了，直接退款
 */
export async function sweepPendingGenerations(log: (line: string) => void) {
  const db = await getDb();
  const { generation } = schema;
  const rows = await db
    .select()
    .from(generation)
    .where(and(eq(generation.status, "pending"), lt(generation.createdAt, new Date(Date.now() - SWEEP_AFTER_MS))))
    .orderBy(asc(generation.createdAt))
    .limit(SWEEP_BATCH);
  const out = { checked: 0, succeeded: 0, refunded: 0, stillPending: 0 };
  for (const gen of rows) {
    const video = getAiFeature(gen.feature)?.kind === "video";
    if (!video && Date.now() - gen.createdAt.getTime() <= TIMEOUT_MS) continue;
    out.checked++;
    const after = video ? await refreshVideoGeneration(gen) : await (async () => {
      await failAndNotify(gen, "interrupted", gen.createdAt.getTime());
      return reload(gen);
    })();
    if (after.status === "succeeded") out.succeeded++;
    else if (after.status === "failed") out.refunded++;
    else out.stillPending++;
  }
  log(`ai sweep: ${JSON.stringify(out)}`);
  return out;
}

/* ---------------- fal 回调 ---------------- */

/** 回调地址里带的签名，防止别人伪造回调 */
export function webhookToken(id: string) {
  return createHmac("sha256", authSecret()).update(`fal:${id}`).digest("hex").slice(0, 32);
}

export function verifyWebhookToken(id: string, token: string) {
  const a = Buffer.from(webhookToken(id));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 只有线上（https 公网地址）才传回调地址；本地开发 fal 回调不到 localhost，靠前端轮询 */
export function videoWebhookUrl(id: string): string | undefined {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (!base.startsWith("https://") || base.includes("example.com")) return undefined;
  return `${base}/api/webhooks/fal?gen=${encodeURIComponent(id)}&token=${webhookToken(id)}`;
}

/* ---------------- 完成通知 ---------------- */

/** 视频生成好就发邮件：用户可能已经关了页面；邮件里写清楚不满意可以直接回信退款，减少客服单 */
async function notifyVideoReady(userId: string, url: string) {
  try {
    const db = await getDb();
    const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
    if (!u) return;
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    const link = url.startsWith("/") ? `${site}${url}` : url;
    await sendEmail({
      to: u.email,
      subject: "Your video is ready",
      html: emailLayout({
        title: "Your video is ready",
        body: "Your video has finished generating. If anything looks off, just reply to this email — we'll fix it or refund you.",
        action: { label: "Watch & download", url: link },
      }),
    });
  } catch (e) {
    console.error("[ai] video ready email failed:", e);
  }
}
