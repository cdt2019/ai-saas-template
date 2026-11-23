import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCreditHistoryPage } from "@/lib/credit-history";

/**
 * 当前用户的积分记录（只读，分页）：GET /api/credits/history?cursor=…&limit=20&direction=in|out
 * 返回 { items, next }，next 为空表示没有更多了
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const page = await getCreditHistoryPage(session.user.id, {
    cursor: params.get("cursor"),
    limit: Number(params.get("limit")) || undefined,
    direction: params.get("direction"),
  });
  if (!page) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
