import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { spendCredits } from "@/lib/credits";

/**
 * 示例：消耗积分的接口。真实项目里，在调用 AI 接口等付费功能之前先扣积分，
 * 失败时可以用 grantCredits({ reason: "refund" }) 退回。
 */
const COST = 1;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await spendCredits({ userId: session.user.id, amount: COST, note: "demo" });
  if (!result.ok) return NextResponse.json({ error: "insufficient_credits", balance: result.balance }, { status: 402 });

  // ……在这里执行真正的付费操作（如调用 AI 接口）……
  return NextResponse.json({ ok: true, balance: result.balance });
}
