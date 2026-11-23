import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { listOrders, listPayments, ORDER_FILTERS, ORDER_SORTS, PAYMENT_FILTERS, PAYMENT_SORTS } from "@/lib/admin-revenue";
import { localePath } from "@/lib/paths";
import { paymentFlags } from "@/lib/payments/events";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, SortHeader, StatusTabs, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/payments">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.payments.title, robots: { index: false } };
}

const money = (cents: number | null | undefined, currency?: string | null) => (cents == null ? "—" : formatPrice(cents, currency ?? "usd"));

/**
 * 交易（仅管理员），两个视图：
 * - 到账（默认）：每一笔真实收到的钱（payment 表），含订阅续费；标价 / 实付 / 已退、发了多少积分、是否拒付
 * - 结账单：用户发起的每次支付（order 表），含没付钱、过期的，用来看多少人中途放弃
 * 一次性购买两边都有；续费只在「到账」；放弃的支付只在「结账单」。单号点进去是支付日志里的完整经过
 */
export default async function AdminPaymentsPage({ params, searchParams }: PageProps<"/[lang]/admin/payments">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const view = sp.view === "checkouts" ? "checkouts" : "received";
  const query =
    view === "checkouts"
      ? parseTableQuery(sp, { sorts: ORDER_SORTS, defaultSort: "created", filters: ORDER_FILTERS, defaultRange: "last7" })
      : parseTableQuery(sp, { sorts: PAYMENT_SORTS, defaultSort: "created", filters: PAYMENT_FILTERS, defaultRange: "last7" });
  const [list, dict] = await Promise.all([
    view === "checkouts" ? listOrders(query).then((r) => ({ kind: "checkouts" as const, ...r })) : listPayments(query).then((r) => ({ kind: "received" as const, ...r })),
    getDictionary(lang),
  ]);
  const t = dict.admin.payments;
  const st = dict.admin.statuses;
  const pathname = localePath(lang, "/admin/payments");
  const usersHref = localePath(lang, "/admin/users");
  const trace = (v: string) => `${localePath(lang, "/admin/payment-log")}?q=${encodeURIComponent(v)}`;
  const plan = (id: string | null) => (id ? (dict.pricing.plans[id]?.name ?? id) : "—");
  const sort = (label: string, key: string, align?: "right") => <SortHeader label={label} sortKey={key} query={query} pathname={pathname} sp={sp} align={align} />;
  const providerFilter = { key: "provider", label: t.filter.provider, options: PAYMENT_FILTERS.provider.map((v) => ({ value: v, label: v })) };

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <Panel className="overflow-hidden">
        <StatusTabs
          pathname={pathname}
          sp={sp}
          param="view"
          current={view === "checkouts" ? "checkouts" : ""}
          reset={["status", "provider", "plan", "sort", "dir"]}
          items={[
            { value: "", label: t.received },
            { value: "checkouts", label: t.checkouts },
          ]}
        />
        <p className="border-b border-line px-4 py-2.5 text-xs leading-relaxed text-fg-3">{view === "checkouts" ? t.checkoutsHint : t.receivedHint}</p>
        <div className="border-b border-line p-3">
          {view === "checkouts" ? (
            <TableToolbar
              placeholder={t.searchCheckouts}
              anyLabel={dict.admin.users.any}
              clearLabel={dict.admin.table.clear}
              dates={dict.admin.table.dates}
              defaultRange="last7"
              filters={[
                { key: "status", label: t.filter.status, options: ORDER_FILTERS.status.map((v) => ({ value: v, label: st[v] ?? v })) },
                providerFilter,
                { key: "plan", label: t.filter.plan, options: ORDER_FILTERS.plan.map((v) => ({ value: v, label: plan(v) })) },
              ]}
            />
          ) : (
            <TableToolbar
              placeholder={t.search}
              anyLabel={dict.admin.users.any}
              clearLabel={dict.admin.table.clear}
              dates={dict.admin.table.dates}
              defaultRange="last7"
              filters={[{ key: "status", label: t.filter.status, options: PAYMENT_FILTERS.status.map((v) => ({ value: v, label: st[v] ?? v })) }, providerFilter]}
            />
          )}
        </div>

        {list.total === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : list.kind === "received" ? (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[900px]">
              <thead>
                <tr>
                  <th>{sort(t.col.time, "created")}</th>
                  <th>{t.col.user}</th>
                  <th>{t.col.plan}</th>
                  <th className="text-right">{sort(t.col.paid, "amount", "right")}</th>
                  <th className="text-right">{t.col.credits}</th>
                  <th>{t.col.status}</th>
                  <th>{t.col.providerPayment}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => {
                  const flags = paymentFlags(p);
                  return (
                    <tr key={p.id}>
                      <td className="font-mono text-xs whitespace-nowrap text-fg-3">
                        {fmtTime(p.createdAt).slice(0, 10)}
                        <span className="block">{fmtTime(p.createdAt).slice(11)}</span>
                      </td>
                      <td className="max-w-[200px] truncate">
                        <Link href={`${usersHref}/${p.userId}`} className="hover:underline">
                          {p.userEmail ?? p.userId}
                        </Link>
                      </td>
                      <td>
                        {plan(p.planId)} <span className="text-xs text-fg-3">· {p.provider}</span>
                        {p.promoCode && <span className="tag ml-1.5">{p.promoCode}</span>}
                      </td>
                      <td className="text-right font-mono whitespace-nowrap tabular-nums">
                        {money(p.amount, p.currency)}
                        {p.listAmount != null && p.listAmount !== p.amount && <span className="block text-[0.6875rem] text-fg-3 line-through">{money(p.listAmount, p.currency)}</span>}
                        {p.refundedAmount > 0 && <span className="block text-[0.6875rem] text-fg-2">{t.refundedAmount.replace("{amount}", money(p.refundedAmount, p.currency))}</span>}
                      </td>
                      <td className="text-right font-mono text-xs tabular-nums">{p.creditsGranted}</td>
                      <td>
                        <StatusTag status={p.status}>{st[p.status] ?? p.status}</StatusTag>
                        {flags.length > 0 && (
                          <span className={`mt-1 block text-xs ${flags.some((f) => f === "over-refunded" || f === "disputed") ? "text-danger-fg" : "text-fg-3"}`}>{flags.join(" · ")}</span>
                        )}
                      </td>
                      <td className="font-mono text-xs">
                        <Link href={trace(p.providerPaymentId)} className="text-brand hover:underline">
                          {p.providerPaymentId}
                        </Link>
                        {p.orderId && <span className="block text-fg-3">{p.orderId}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[880px]">
              <thead>
                <tr>
                  <th>{sort(t.col.created, "created")}</th>
                  <th>{t.col.order}</th>
                  <th>{t.col.user}</th>
                  <th>{t.col.plan}</th>
                  <th className="text-right">{sort(t.col.amount, "amount", "right")}</th>
                  <th>{t.col.status}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map(({ o, email }) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(o.createdAt)}</td>
                    <td>
                      <Link href={trace(o.id)} className="font-mono text-xs hover:underline">
                        {o.id}
                      </Link>
                      {o.promoCode && <span className="tag ml-1.5">{o.promoCode}</span>}
                    </td>
                    <td className="max-w-[260px] truncate">
                      <Link href={`${usersHref}/${o.userId}`} className="hover:underline">
                        {email}
                      </Link>
                    </td>
                    <td>
                      {plan(o.planId)} <span className="text-xs text-fg-3">· {o.provider}</span>
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {formatPrice(o.amount, o.currency)}
                      {o.listAmount != null && o.listAmount !== o.amount && <span className="block text-[0.6875rem] text-fg-3 line-through">{formatPrice(o.listAmount, o.currency)}</span>}
                    </td>
                    <td>
                      <StatusTag status={o.status}>{st[o.status] ?? o.status}</StatusTag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3 py-2.5">
          <Pagination total={list.total} page={query.page} size={query.size} labels={dict.admin.table} />
        </div>
      </Panel>
    </div>
  );
}
