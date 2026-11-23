import { getAdminSession } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-users";
import { csvCell, exportSubscribers, SUBSCRIBER_STATUSES } from "@/lib/newsletter";

/** 导出订阅者 CSV：GET ?status=active（不传导出全部）。里面是邮箱，每次导出都记后台操作日志 */
export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const status = new URL(request.url).searchParams.get("status") ?? "";
  const rows = await exportSubscribers((SUBSCRIBER_STATUSES as readonly string[]).includes(status) ? status : undefined);
  await logAdminAction({ id: session.user.id, email: session.user.email }, "newsletter_export", null, `${rows.length} rows${status ? ` (${status})` : ""}`);
  const head = ["email", "locale", "status", "subscribed_at", "confirmed_at", "unsubscribed_at"];
  const lines = rows.map((r) => [r.email, r.locale, r.status, r.createdAt, r.confirmedAt, r.unsubscribedAt].map(csvCell).join(","));
  return new Response(`﻿${[head.join(","), ...lines].join("\r\n")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="newsletter-subscribers.csv"', "Cache-Control": "no-store" },
  });
}
