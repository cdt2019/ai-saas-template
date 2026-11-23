import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { dailyReport, listIssues } from "@/lib/admin-ops";
import { ISSUE_KINDS, ISSUE_STATUSES } from "@/lib/issues";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, PanelHead, StatusTabs, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { IssueActions, RunJobButton } from "@/components/admin/OpsActions";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

const SEVERITIES = ["error", "warning"] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/reconciliation">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.recon.title, robots: { index: false } };
}

/**
 * 后台 → 异常与对账：上面是要人处理的问题（支付检查和账务检查发现的，按状态分栏，处理后标记已解决 / 忽略，
 * 规则见 src/lib/issues.ts）；下面是每日对账报表（按天、通道、币种汇总收入、退款、净额和当天补上的漏单），按天分页
 */
export default async function AdminReconciliationPage({ params, searchParams }: PageProps<"/[lang]/admin/reconciliation">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  // 问题列表默认只看「待处理」；报表单独用 r 开头的分页参数
  const issueQuery = parseTableQuery({ status: "open", ...sp }, { filters: { status: ISSUE_STATUSES, kind: ISSUE_KINDS, severity: SEVERITIES } });
  const reportQuery = parseTableQuery(sp, { prefix: "r", defaultRange: "last7" });
  const [issues, report, dict] = await Promise.all([listIssues(issueQuery), dailyReport(reportQuery), getDictionary(lang)]);
  const t = dict.admin.recon;
  const st = dict.admin.statuses;
  const pathname = localePath(lang, "/admin/reconciliation");
  const usersHref = localePath(lang, "/admin/users");
  const all = Object.values(issues.byStatus).reduce((a, b) => a + b, 0);
  const money = (cents: unknown, currency: unknown) => (typeof cents === "number" ? formatPrice(cents, typeof currency === "string" ? currency : "usd") : "—");
  const describe = (kind: string, d: Record<string, unknown>) =>
    (t.detail[kind] ?? "")
      .replace("{provider}", String(d.provider ?? "—"))
      .replace("{event}", String(d.event ?? "—"))
      .replace("{message}", String(d.message ?? "—"))
      .replace("{count}", String(d.count ?? "—"))
      .replace("{attempts}", String(d.attempts ?? 1))
      .replace("{payment}", String(d.payment ?? "—"))
      .replace("{balance}", String(d.balance ?? "—"))
      .replace("{ledger}", String(d.ledger ?? "—"))
      .replace("{amount}", money(d.amount, d.currency))
      .replace("{refunded}", money(d.refunded, d.currency))
      .replace("{plan}", String(d.plan ?? "—"))
      .replace("{since}", d.approvedAt ? fmtTime(String(d.approvedAt)) : "—");
  // 说明下面的小字：平台 / 代码的原始报错，或补上的订单号，最多两行，悬停看全文
  const raw = (kind: string, d: Record<string, unknown>) =>
    kind === "missed_webhook" ? (Array.isArray(d.orders) ? d.orders.join(" · ") : "") : typeof d.message === "string" ? d.message : "";

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={<RunJobButton name="ledger.check" label={t.checkNow} runningLabel={t.checking} />}
      />

      <Panel className="overflow-hidden">
        <PanelHead title={t.issues} />
        <StatusTabs
          pathname={pathname}
          sp={{ status: "open", ...sp }}
          current={sp.status === "all" ? "all" : (issueQuery.filters.status ?? "open")}
          items={[...ISSUE_STATUSES.map((v) => ({ value: v, label: st[v] ?? v, count: issues.byStatus[v] ?? 0 })), { value: "all", label: dict.admin.users.any, count: all }]}
        />
        <div className="border-b border-line p-3">
          <TableToolbar
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
            filters={[
              { key: "severity", label: t.severityLabel, options: SEVERITIES.map((v) => ({ value: v, label: t.severity[v] ?? v })) },
              { key: "kind", label: t.kindLabel, options: ISSUE_KINDS.map((v) => ({ value: v, label: t.kinds[v] ?? v })) },
            ]}
          />
        </div>
        {issues.total === 0 ? (
          <TableEmpty title={t.noIssues} body={t.noIssuesBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[900px]">
              <thead>
                <tr>
                  <th>{t.col.issue}</th>
                  <th>{t.col.user}</th>
                  <th>{t.col.detail}</th>
                  <th>{t.col.seen}</th>
                  <th>{t.col.status}</th>
                  <th>{t.col.action}</th>
                </tr>
              </thead>
              <tbody>
                {issues.rows.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <StatusTag status={i.severity === "error" ? "error" : "pending"}>{t.severity[i.severity] ?? i.severity}</StatusTag>
                        <span className="font-medium">{t.kinds[i.kind] ?? i.kind}</span>
                      </span>
                      <span title={i.entityId ?? ""} className="mt-0.5 block max-w-[140px] truncate font-mono text-[0.6875rem] text-fg-3">
                        {i.entityId}
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate">
                      {i.userId ? (
                        <Link href={`${usersHref}/${i.userId}`} className="hover:underline">
                          {i.email ?? i.userId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[360px] min-w-[200px] text-xs text-fg-2">
                      {describe(i.kind, i.detail)}
                      {raw(i.kind, i.detail) && (
                        <span title={raw(i.kind, i.detail)} className="mt-1 line-clamp-2 font-mono text-[0.6875rem] break-all text-fg-3">
                          {raw(i.kind, i.detail)}
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-[0.6875rem] whitespace-nowrap text-fg-3">
                      {fmtTime(i.firstSeenAt)}
                      <span className="block">{fmtTime(i.lastSeenAt)}</span>
                    </td>
                    <td>
                      <StatusTag status={i.status}>{st[i.status] ?? i.status}</StatusTag>
                      {i.resolvedBy && <span className="mt-1 block text-[0.6875rem] text-fg-3">{i.resolvedBy}</span>}
                      {i.note && <span className="mt-1 block max-w-[200px] text-[0.6875rem] text-fg-3">{i.note}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      <IssueActions id={i.id} status={i.status} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3 py-2.5">
          <Pagination total={issues.total} page={issueQuery.page} size={issueQuery.size} labels={dict.admin.table} />
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHead title={t.report} />
        <p className="border-b border-line px-4 py-2.5 text-xs leading-relaxed text-fg-3">{t.reportHint}</p>
        <div className="border-b border-line p-3">
          <TableToolbar prefix="r" anyLabel={dict.admin.users.any} clearLabel={dict.admin.table.clear} dates={dict.admin.table.dates} defaultRange="last7" />
        </div>
        {report.days.length === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[820px]">
              <thead>
                <tr>
                  <th>{t.col.day}</th>
                  <th>{t.col.provider}</th>
                  <th className="text-right">{t.col.count}</th>
                  <th className="text-right">{t.col.gross}</th>
                  <th className="text-right">{t.col.refunded}</th>
                  <th className="text-right">{t.col.net}</th>
                  <th className="text-right">{t.col.missed}</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) =>
                  d.rows.length === 0 ? (
                    <tr key={d.day}>
                      <td className="font-mono text-xs whitespace-nowrap text-fg-3">{d.day}</td>
                      <td colSpan={6} className="text-xs text-fg-3">
                        {t.noPayments}
                      </td>
                    </tr>
                  ) : (
                    d.rows.map((r, i) => (
                      <tr key={`${d.day}-${r.provider}-${r.currency}`}>
                        <td className="font-mono text-xs whitespace-nowrap text-fg-3">{i === 0 ? d.day : ""}</td>
                        <td className="text-[0.8125rem]">
                          {r.provider}
                          {r.currency && <span className="ml-1 text-xs text-fg-3 uppercase">{r.currency}</span>}
                        </td>
                        <td className="text-right font-mono text-xs tabular-nums">{r.count}</td>
                        <td className="text-right font-mono text-xs tabular-nums">{r.currency ? formatPrice(r.gross, r.currency) : "—"}</td>
                        <td className="text-right font-mono text-xs tabular-nums text-fg-2">{r.refunded && r.currency ? formatPrice(r.refunded, r.currency) : "—"}</td>
                        <td className="text-right font-mono text-xs font-semibold tabular-nums">{r.currency ? formatPrice(r.net, r.currency) : "—"}</td>
                        <td className={`text-right font-mono text-xs tabular-nums ${r.missed ? "font-semibold text-warning-fg" : "text-fg-3"}`}>{r.missed}</td>
                      </tr>
                    ))
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3 py-2.5">
          <Pagination total={report.totalDays} page={reportQuery.page} size={reportQuery.size} labels={{ ...dict.admin.table, showing: t.daysShowing, perPage: t.daysPerPage }} prefix="r" />
        </div>
      </Panel>
    </div>
  );
}
