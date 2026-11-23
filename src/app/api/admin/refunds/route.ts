import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { approveRefundRequest, rejectRefundRequest, releaseRefundRequest } from "@/lib/payments/refunds";

/**
 * 管理员审核退款申请：POST { id, action, note? }
 * - approve：按提交时定下的金额到平台退款（Waffo 建工单；Creem 需到后台手动退）；重试失败的申请时按现在的未用积分重算
 * - reject：拒绝待审核的申请
 * - release：平台那边没退成（工单被拒等），撤回冻结，积分还给用户
 */
const STATUS: Record<string, number> = { not_found: 404, not_pending: 409, not_processing: 409, nothing_left: 409, provider_failed: 502 };

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, action, note } = (await request.json().catch(() => ({}))) as { id?: string; action?: string; note?: string };
  if (typeof id !== "string") return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const memo = typeof note === "string" ? note.slice(0, 500) : undefined;

  const result =
    action === "approve"
      ? await approveRefundRequest(id, admin.user.email)
      : action === "reject"
        ? await rejectRefundRequest(id, admin.user.email, memo)
        : action === "release"
          ? await releaseRefundRequest(id, admin.user.email, memo)
          : { error: "invalid_action" as const };
  if ("error" in result) return NextResponse.json(result, { status: STATUS[result.error ?? ""] ?? 400 });
  return NextResponse.json(result);
}
