import "server-only";
import { getAiFeature, type AiFeature } from "@/config/ai";
import { limits } from "@/lib/abuse";
import { getSession, type Session } from "@/lib/auth";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

/**
 * AI 接口的公共前置检查：登录、功能是否存在、输入长度、按用户和 IP 限流。
 * 通过返回 { session, feature, input, body }，不通过直接返回 Response。body 是完整请求体，额外字段（如图片地址）从这里取。
 */
export async function guardAiRequest(
  request: Request,
  kind: AiFeature["kind"],
): Promise<{ session: Session; feature: AiFeature; input: string; body: Record<string, unknown> } | Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { feature?: string; input?: string } & Record<string, unknown>;
  const feature = body.feature ? getAiFeature(body.feature) : undefined;
  if (!feature || feature.kind !== kind) return Response.json({ error: "invalid_feature" }, { status: 400 });

  const input = (body.input ?? "").trim();
  if (!input) return Response.json({ error: "empty_input" }, { status: 400 });
  if (input.length > feature.maxInput) return Response.json({ error: "input_too_long", max: feature.maxInput }, { status: 400 });

  const byUser = await rateLimit(`ai:user:${session.user.id}`, limits.aiPerUserPerMinute, 60);
  if (!byUser.ok) return tooManyRequests(byUser.retryAfter);
  const byIp = await rateLimit(`ai:ip:${getClientIp(request.headers)}`, limits.aiPerIpPerMinute, 60);
  if (!byIp.ok) return tooManyRequests(byIp.retryAfter);

  return { session, feature, input, body };
}
