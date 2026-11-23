import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAdminSession } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-users";
import { notify } from "@/lib/notify";
import { grantCredits, spendCredits } from "@/lib/credits";
import { newId } from "@/lib/ids";

/** 管理员手动调整积分：POST { userId, delta, note }（delta 可正可负，note 原因必填，写进积分流水和 admin_log） */
export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const { userId, delta, note } = (await request.json().catch(() => ({}))) as {
    userId?: string;
    delta?: number;
    note?: string;
  };
  if (!userId || !Number.isInteger(delta) || delta === 0 || Math.abs(delta!) > 1_000_000 || !note?.trim()) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const db = await getDb();
  const [target] = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  if (!target) return Response.json({ error: "user_not_found" }, { status: 404 });

  const memo = `by ${admin.user.email}: ${note!.trim().slice(0, 300)}`;
  if (delta! > 0) {
    await grantCredits({ userId, amount: delta!, reason: "admin", refId: newId("adm"), note: memo });
  } else {
    const r = await spendCredits({ userId, amount: -delta!, reason: "admin", note: memo });
    if (!r.ok) return Response.json({ error: "insufficient_credits", balance: r.balance }, { status: 400 });
  }
  const [u] = await db.select({ credits: schema.user.credits }).from(schema.user).where(eq(schema.user.id, userId));
  await notify({ userId, type: "credits_adjusted", params: { delta: delta!, balance: u.credits, note: note!.trim() }, link: "/settings?tab=usage" });
  await logAdminAction({ id: admin.user.id, email: admin.user.email }, "adjust_credits", target, `${delta! > 0 ? "+" : ""}${delta} → ${u.credits}: ${note!.trim()}`);
  return Response.json({ ok: true, balance: u.credits });
}
