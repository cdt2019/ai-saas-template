import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cancelRefundRequest, createRefundRequest, listRefundables } from "@/lib/payments/refunds";

/**
 * 网页退款申请（规则见 src/config/refunds.ts）
 * GET  → { items }：我的付款记录，每笔带退款申请状态，或系统算好的可退金额（quote）
 * POST { paymentId, reason } → 提交申请（同时冻结可退的积分）。金额只由系统计算，不接受客户端传金额
 * DELETE ?id=<申请号> → 撤销自己还在审核中的申请，立即解冻
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = (await listRefundables(session.user.id)).map(({ payment: p, request, quote }) => ({
    paymentId: p.id,
    planId: p.planId,
    provider: p.provider,
    amount: p.amount,
    currency: p.currency,
    createdAt: p.createdAt,
    request,
    quote,
  }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

const STATUS: Record<string, number> = { not_found: 404, requested: 409, not_pending: 409 };

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await cancelRefundRequest(session.user.id, id);
  if ("error" in result) return NextResponse.json(result, { status: STATUS[result.error ?? ""] ?? 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { paymentId?: unknown; reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (typeof body.paymentId !== "string" || reason.length < 3) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const result = await createRefundRequest(session.user.id, body.paymentId, reason);
  if ("error" in result) return NextResponse.json(result, { status: STATUS[result.error ?? ""] ?? 400 });
  return NextResponse.json({ ok: true, ...result });
}
