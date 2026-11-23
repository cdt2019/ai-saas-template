import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { listRefundRequests, REFUND_SORTS, REFUND_STATUSES } from "@/lib/admin-revenue";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { RefundReview } from "@/components/account/AdminActions";
import { fmtTime, Panel, SortHeader, StatusTabs, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/refunds">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.refunds.title, robots: { index: false } };
}

/**
 * 后台 → 退款：按状态分栏（待审核 / 处理中 / 已退款 / 已拒绝 / 失败 / 已撤销），在这里批准、拒绝、撤回。
 * 积分在用户提交时就冻结了，金额以申请时为准
 */
export default async function AdminRefundsPage({ params, searchParams }: PageProps<"/[lang]/admin/refunds">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  // 不传默认排序：没选状态时待审核、处理中排在前面
  const query = parseTableQuery(sp, { sorts: REFUND_SORTS, filters: { status: REFUND_STATUSES } });
  const [{ rows, total, byStatus }, dict] = await Promise.all([listRefundRequests(query), getDictionary(lang)]);
  const t = dict.admin.refunds;
  const st = dict.admin.statuses;
  const pathname = localePath(lang, "/admin/refunds");
  const usersHref = localePath(lang, "/admin/users");
  const plan = (id: string) => dict.pricing.plans[id]?.name ?? id;
  const sort = (label: string, key: string, align?: "right") => <SortHeader label={label} sortKey={key} query={query} pathname={pathname} sp={sp} align={align} />;
  const all = Object.values(byStatus).reduce((a, b) => a + b, 0);
  // 处理中的申请还差哪一步：有平台退款号的等回调；没有的（Creem、Waffo 订阅）要管理员到平台后台手动退
  const hint = (r: (typeof rows)[number]["r"], p: (typeof rows)[number]["p"]) =>
    r.providerRefundId
      ? t.hintSent.replace("{id}", r.providerRefundId)
      : t.hintManual.replace("{amount}", formatPrice(r.amount, p.currency)).replace("{payment}", p.providerPaymentId).replace("{provider}", p.provider);

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <Panel className="overflow-hidden">
        <StatusTabs
          pathname={pathname}
          sp={sp}
          current={query.filters.status ?? ""}
          items={[{ value: "", label: dict.admin.users.any, count: all }, ...REFUND_STATUSES.map((v) => ({ value: v, label: st[v] ?? v, count: byStatus[v] ?? 0 }))]}
        />
        <div className="border-b border-line p-3">
          <TableToolbar placeholder={t.search} anyLabel={dict.admin.users.any} clearLabel={dict.admin.table.clear} dates={dict.admin.table.dates} />
        </div>
        {rows.length === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[900px]">
              <thead>
                <tr>
                  <th>{sort(t.col.created, "created")}</th>
                  <th>{t.col.user}</th>
                  <th>{t.col.payment}</th>
                  <th className="text-right">{sort(t.col.refund, "amount", "right")}</th>
                  <th>{t.col.reason}</th>
                  <th>{t.col.status}</th>
                  <th>{t.col.action}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, p, email }) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">
                      {fmtTime(r.createdAt).slice(0, 10)}
                      <span className="block">{fmtTime(r.createdAt).slice(11)}</span>
                    </td>
                    <td className="max-w-[170px] truncate">
                      <Link href={`${usersHref}/${r.userId}`} className="hover:underline">
                        {email}
                      </Link>
                    </td>
                    <td>
                      {plan(p.planId)} <span className="text-xs text-fg-3">· {p.provider}</span>
                      <span className="ml-1.5 font-mono text-xs">{formatPrice(p.amount, p.currency)}</span>
                      <Link
                        href={`${localePath(lang, "/admin/payment-log")}?q=${encodeURIComponent(p.providerPaymentId)}`}
                        className="block font-mono text-[0.6875rem] text-fg-3 hover:underline"
                      >
                        {p.providerPaymentId}
                      </Link>
                    </td>
                    <td className="text-right font-mono whitespace-nowrap tabular-nums">
                      {formatPrice(r.amount, p.currency)}
                      {/* 审核中、处理中的积分还冻着；其余状态要么已扣回、要么已解冻，只写数量 */}
                      <span className="block text-[0.6875rem] text-fg-3">
                        {(r.status === "pending" || r.status === "processing" ? t.credits : t.creditsDone).replace("{n}", r.credits.toLocaleString())}
                      </span>
                    </td>
                    <td className="min-w-[150px] max-w-[240px] text-xs text-fg-2">{r.reason}</td>
                    <td>
                      <StatusTag status={r.status}>{st[r.status] ?? r.status}</StatusTag>
                      {r.reviewedBy && (
                        <span title={r.reviewedBy} className="mt-1 block max-w-[150px] truncate text-[0.6875rem] text-fg-3">
                          {r.reviewedBy}
                        </span>
                      )}
                      {r.adminNote && <span className="mt-1 block max-w-[150px] text-[0.6875rem] [overflow-wrap:anywhere] text-fg-3">{r.adminNote}</span>}
                    </td>
                    <td>
                      <RefundReview id={r.id} status={r.status} hint={r.status === "processing" ? hint(r, p) : undefined} />
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
