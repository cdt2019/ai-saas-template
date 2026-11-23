import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { searchPaymentTrail } from "@/lib/payments/events";

/**
 * 按邮箱或任一 id 查支付记录（和后台「支付日志」同一份数据，给脚本 / 测试用）：
 * GET ?q=… → { payments（付款汇总）, events（按时间正序的完整经过） }
 */
export async function GET(request: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const data = await searchPaymentTrail({ q: new URL(request.url).searchParams.get("q") ?? undefined });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
