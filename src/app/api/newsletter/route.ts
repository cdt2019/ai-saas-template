import { limits } from "@/lib/abuse";
import { isValidEmail, normalizeEmail, subscribe } from "@/lib/newsletter";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

/**
 * 订阅 Newsletter：POST { email, locale, website }
 * website 是隐藏的蜜罐字段，机器人填了就假装成功。邮箱格式对就回 { ok: true }，不暴露是否已订阅
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; locale?: unknown; website?: unknown };
  if (body.website) return Response.json({ ok: true });
  const r = await rateLimit(`newsletter:ip:${getClientIp(request.headers)}`, limits.newsletterPerIpPerHour, 3600);
  if (!r.ok) return tooManyRequests(r.retryAfter);
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
  await subscribe(email, typeof body.locale === "string" ? body.locale : "");
  return Response.json({ ok: true });
}
