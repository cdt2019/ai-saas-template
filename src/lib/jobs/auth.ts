import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getAdminSession } from "@/lib/admin";

/** 定时任务接口的鉴权：Authorization: Bearer <CRON_SECRET>（Vercel Cron 会自动带上），或者管理员登录后在浏览器里打开 */
export function authorizedBySecret(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 返回触发者：cron（密钥）/ 管理员邮箱；都不是返回 null */
export async function cronCaller(request: Request): Promise<string | null> {
  if (authorizedBySecret(request)) return "cron";
  const admin = await getAdminSession();
  return admin ? admin.user.email : null;
}
