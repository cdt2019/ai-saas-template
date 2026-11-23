import { confirmSubscription } from "@/lib/newsletter";

/** 确认订阅：POST { token }。必须是页面上按按钮发的 POST，邮箱安全扫描访问链接不会触发 */
export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: unknown };
  if (typeof token !== "string" || !token) return Response.json({ error: "invalid_token" }, { status: 400 });
  if (!(await confirmSubscription(token))) return Response.json({ error: "invalid_token" }, { status: 404 });
  return Response.json({ ok: true });
}
