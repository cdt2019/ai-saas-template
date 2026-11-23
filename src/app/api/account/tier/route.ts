import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getAccountTier } from "@/lib/tier";

/**
 * 当前用户的账户等级（只读）：侧栏账号栏、账号菜单显示「Pro / Starter / Free」用。
 * 只返回种类和方案 id，名称由前端按语言显示；isAdmin 用来显示「管理后台」入口（ADMIN_EMAILS 里的管理员数据库 role 不是 admin）
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tier = await getAccountTier(session.user.id);
  return NextResponse.json(
    { kind: tier.kind, planId: tier.planId, isAdmin: isAdminUser(session.user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
