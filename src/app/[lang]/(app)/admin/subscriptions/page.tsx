import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { listSubscriptions, SUB_FILTERS, SUB_SORTS } from "@/lib/admin-revenue";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, SortHeader, StatusTabs, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/subscriptions">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.subscriptions.title, robots: { index: false } };
}

/** 后台 → 订阅：按状态分栏（带数量），按邮箱 / 平台订阅号搜索，按通道、套餐筛选 */
export default async function AdminSubscriptionsPage({ params, searchParams }: PageProps<"/[lang]/admin/subscriptions">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { sorts: SUB_SORTS, defaultSort: "created", filters: SUB_FILTERS });
  const [{ rows, total, byStatus }, dict] = await Promise.all([listSubscriptions(query), getDictionary(lang)]);
  const t = dict.admin.subscriptions;
  const st = dict.admin.statuses;
  const pathname = localePath(lang, "/admin/subscriptions");
  const usersHref = localePath(lang, "/admin/users");
  const plan = (id: string) => dict.pricing.plans[id]?.name ?? id;
  const sort = (label: string, key: string) => <SortHeader label={label} sortKey={key} query={query} pathname={pathname} sp={sp} />;
  const all = Object.values(byStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <Panel className="overflow-hidden">
        <StatusTabs
          pathname={pathname}
          sp={sp}
          current={query.filters.status ?? ""}
          items={[{ value: "", label: dict.admin.users.any, count: all }, ...SUB_FILTERS.status.map((v) => ({ value: v, label: st[v] ?? v, count: byStatus[v] ?? 0 }))]}
        />
        <div className="border-b border-line p-3">
          <TableToolbar
            placeholder={t.search}
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
            filters={[
              { key: "provider", label: t.filter.provider, options: SUB_FILTERS.provider.map((v) => ({ value: v, label: v })) },
              { key: "plan", label: t.filter.plan, options: SUB_FILTERS.plan.map((v) => ({ value: v, label: plan(v) })) },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[880px]">
              <thead>
                <tr>
                  <th>{t.col.user}</th>
                  <th>{t.col.plan}</th>
                  <th>{t.col.status}</th>
                  <th>{sort(t.col.period, "period")}</th>
                  <th>{sort(t.col.created, "created")}</th>
                  <th>{t.col.id}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, email }) => (
                  <tr key={s.id}>
                    <td className="max-w-[260px] truncate">
                      <Link href={`${usersHref}/${s.userId}`} className="hover:underline">
                        {email}
                      </Link>
                    </td>
                    <td>
                      {plan(s.planId)} <span className="text-xs text-fg-3">· {s.provider}</span>
                    </td>
                    <td>
                      <StatusTag status={s.status}>{st[s.status] ?? s.status}</StatusTag>
                      {s.cancelAtPeriodEnd && s.status === "active" && <span className="tag ml-1.5">{t.cancelAtEnd}</span>}
                    </td>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-2">{fmtTime(s.currentPeriodEnd)}</td>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(s.createdAt)}</td>
                    <td>
                      <Link href={`${localePath(lang, "/admin/payment-log")}?q=${encodeURIComponent(s.providerSubId)}`} className="font-mono text-xs hover:underline">
                        {s.providerSubId}
                      </Link>
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
