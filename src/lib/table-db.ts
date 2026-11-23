import "server-only";
import { and, gte, lt, type AnyColumn, type SQL } from "drizzle-orm";
import type { TableQuery } from "./table";

/**
 * 列表的日期范围条件（from / to 见 src/lib/table.ts）。只传一列：落在 [from, to) 里；
 * 传起止两列（问题的首次 / 最近发现、登录会话的登录 / 最近活动）：这段时间里出现过，即 start < to 且 end >= from
 */
export const inRange = (q: Pick<TableQuery, "from" | "to">, start: AnyColumn, end: AnyColumn = start): SQL | undefined =>
  and(q.to ? lt(start, q.to) : undefined, q.from ? gte(end, q.from) : undefined);
