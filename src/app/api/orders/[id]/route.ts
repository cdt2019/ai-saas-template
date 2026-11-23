import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { reconcileOnReturn } from "@/lib/payments/reconcile";

/**
 * 付完跳回来后，页面每 2 秒问一次订单状态：GET /api/orders/<订单号> → { status }。
 * 还没付款就顺便去支付平台查一次（同一订单 10 秒内只查一次，见 reconcileOnReturn），回调丢了也能到账。只能查自己的订单
 */
export async function GET(_: Request, { params }: RouteContext<"/api/orders/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = await getDb();
  const mine = and(eq(schema.order.id, id), eq(schema.order.userId, session.user.id));
  const [before] = await db.select({ status: schema.order.status }).from(schema.order).where(mine);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });
  if (before.status !== "pending") return Response.json({ status: before.status }, { headers: { "Cache-Control": "no-store" } });
  await reconcileOnReturn(id, session.user.id, 3000);
  const [after] = await db.select({ status: schema.order.status }).from(schema.order).where(mine);
  return Response.json({ status: after?.status ?? before.status }, { headers: { "Cache-Control": "no-store" } });
}
