import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TableQuery } from "./table";
import { inRange } from "./table-db";

/** 用户自己的列表（设置 → 账单）：只查当前一页，总数单独 count */
const { order } = schema;

export const USER_ORDER_FILTERS = { status: ["paid", "pending", "failed", "refunded"] } as const;

export async function listUserOrders(userId: string, q: TableQuery) {
  const db = await getDb();
  const cond = and(eq(order.userId, userId), q.filters.status ? eq(order.status, q.filters.status) : undefined, inRange(q, order.createdAt));
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(order).where(cond).orderBy(desc(order.createdAt), desc(order.id)).limit(q.size).offset(q.offset),
    db.select({ total: count() }).from(order).where(cond),
  ]);
  return { rows, total };
}
