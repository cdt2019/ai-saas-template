import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { EVENT_FILTERS, listPaymentEvents } from "@/lib/admin-revenue";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/payment-log">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.log.title, robots: { index: false } };
}

const money = (cents: number | null | undefined, currency?: string | null) => (cents == null ? "—" : formatPrice(cents, currency ?? "usd"));

/**
 * 支付日志（仅管理员）：每次下单、回调、发积分、退款、拒付、审核都有一行，只追加不修改。排查用——
 * 搜邮箱或任一 id 就是这笔交易 / 这个人按时间排好的完整经过，可以展开平台回调的原始数据。
 * 要处理的异常不在这里看，在「异常与对账」
 */
export default async function AdminPaymentLogPage({ params, searchParams }: PageProps<"/[lang]/admin/payment-log">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { filters: EVENT_FILTERS, defaultRange: "last7" });
  const [{ rows, total }, dict] = await Promise.all([listPaymentEvents(query), getDictionary(lang)]);
  const t = dict.admin.log;
  const pathname = localePath(lang, "/admin/payment-log");
  const trace = (v: string) => `${pathname}?q=${encodeURIComponent(v)}`;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <Panel className="overflow-hidden">
        <div className="border-b border-line p-3">
          <TableToolbar
            placeholder={t.search}
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
              defaultRange="last7"
            filters={[
              { key: "outcome", label: t.filter.outcome, options: EVENT_FILTERS.outcome.map((v) => ({ value: v, label: v })) },
              { key: "provider", label: t.filter.provider, options: EVENT_FILTERS.provider.map((v) => ({ value: v, label: v })) },
              { key: "problems", label: t.filter.problems, options: [{ value: "1", label: t.problemsOnly }] },
            ]}
          />
        </div>
        {query.q && total > 0 && <p className="border-b border-line px-4 py-2 text-xs text-fg-3">{t.timeline}</p>}
        {total === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[1100px]">
              <thead>
                <tr>
                  <th>{t.col.time}</th>
                  <th>{t.col.event}</th>
                  <th>{t.col.money}</th>
                  <th>{t.col.credits}</th>
                  <th>{t.col.ids}</th>
                  <th>{t.col.message}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(e.createdAt)}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{e.kind}</span>
                        <StatusTag status={e.outcome} />
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-3">
                        {e.provider}
                        {e.providerEventType ? ` · ${e.providerEventType}` : ""}
                      </span>
                    </td>
                    <td className="font-mono text-xs tabular-nums">
                      {money(e.listAmount, e.currency)} / {money(e.discountAmount, e.currency)} / {money(e.chargedAmount, e.currency)} / {money(e.refundedAmount, e.currency)}
                      {e.promoCode && <span className="block text-fg-3">code {e.promoCode}</span>}
                    </td>
                    <td className="font-mono text-xs tabular-nums">
                      {e.creditsDelta == null ? "—" : e.creditsDelta > 0 ? `+${e.creditsDelta}` : e.creditsDelta}
                      {e.balanceAfter != null && <span className="block text-fg-3">= {e.balanceAfter}</span>}
                    </td>
                    <td className="font-mono text-xs text-fg-3">
                      {/* 有的平台订单号和付款号是同一个值，去重后再列 */}
                      {[...new Set([e.userEmail, e.orderId, e.providerOrderId, e.providerPaymentId, e.providerSubId, e.providerRefundId, e.providerEventId])]
                        .filter((v): v is string => !!v)
                        .map((v) => (
                          <Link key={v} href={trace(v)} className="block hover:text-fg hover:underline">
                            {v}
                          </Link>
                        ))}
                    </td>
                    <td className="max-w-[340px] text-xs text-fg-2">
                      {e.message}
                      {e.raw && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-fg-3">raw</summary>
                          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-canvas-2 p-2 text-[11px] break-all whitespace-pre-wrap text-fg-3">{e.raw}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3 py-2.5">
          <Pagination total={total} page={query.page} size={query.size} labels={dict.admin.table} />
        </div>
      </Panel>
    </div>
  );
}
