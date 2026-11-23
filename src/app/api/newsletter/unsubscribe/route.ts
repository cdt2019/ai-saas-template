import { unsubscribeByToken } from "@/lib/newsletter";

/**
 * 退订：POST ?token=（邮箱客户端按 RFC 8058 一键退订，正文是 List-Unsubscribe=One-Click）
 * 或 POST { token }（退订页面的按钮）
 */
export async function POST(request: Request) {
  let token = new URL(request.url).searchParams.get("token");
  if (!token && request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : null;
  }
  if (!token) return Response.json({ error: "invalid_token" }, { status: 400 });
  if (!(await unsubscribeByToken(token))) return Response.json({ error: "invalid_token" }, { status: 404 });
  return Response.json({ ok: true });
}
