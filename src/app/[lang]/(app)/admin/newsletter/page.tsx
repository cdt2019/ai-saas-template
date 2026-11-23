import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { siteConfig, localeLabels } from "@/config/site";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { audienceCounts, listCampaigns, listSubscribers, SUBSCRIBER_STATUSES } from "@/lib/newsletter";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, PanelHead, StatusTabs, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { CampaignComposer, SubscriberActions } from "@/components/admin/NewsletterControls";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/newsletter">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.newsletter.title, robots: { index: false } };
}

const LOCALES = siteConfig.locales as readonly string[];

/** 后台 → Newsletter：写群发、看发送进度、管理订阅者（筛选、导出、退订、删除） */
export default async function AdminNewsletterPage({ params, searchParams }: PageProps<"/[lang]/admin/newsletter">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { filters: { status: SUBSCRIBER_STATUSES, locale: LOCALES } });
  const [{ rows, total, byStatus }, campaigns, counts, dict] = await Promise.all([listSubscribers(query), listCampaigns(), audienceCounts(), getDictionary(lang)]);
  const t = dict.admin.newsletter;
  const pathname = localePath(lang, "/admin/newsletter");
  const all = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const audiences = [{ value: "all", label: t.everyone }, ...siteConfig.locales.map((l) => ({ value: l as string, label: localeLabels[l] }))];
  const audienceName = (v: string) => audiences.find((a) => a.value === v)?.label ?? v;
  const exportHref = `/api/admin/newsletter/export${query.filters.status ? `?status=${query.filters.status}` : ""}`;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={
          <a href={exportHref} className="btn btn-secondary btn-sm">
            <Download className="size-3.5" /> {t.export}
          </a>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel className="overflow-hidden">
          <PanelHead title={t.compose} />
          <CampaignComposer counts={counts} audiences={audiences} t={t} />
        </Panel>
        <Panel className="overflow-hidden">
          <PanelHead title={t.campaigns} count={campaigns.length || undefined} />
          {campaigns.length === 0 ? (
            <TableEmpty title={t.noCampaigns} body={t.noCampaignsBody} />
          ) : (
            <ul className="divide-y divide-line/60">
              {campaigns.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <p className="flex items-center justify-between gap-3">
                    <span title={c.subject} className="truncate text-[0.8125rem] font-medium">{c.subject}</span>
                    <StatusTag status={c.status === "sent" ? "success" : "running"}>{t.campaignStatus[c.status] ?? c.status}</StatusTag>
                  </p>
                  <p className="mt-1 font-mono text-[0.6875rem] text-fg-3">
                    {fmtTime(c.createdAt)} · {audienceName(c.audience)} ·{" "}
                    {t.progress.replace("{sent}", String(c.sent)).replace("{total}", String(c.total))}
                    {c.failed > 0 && <span className="text-danger-fg"> · {t.failedCount.replace("{n}", String(c.failed))}</span>}
                    {c.skipped > 0 && <> · {t.skippedCount.replace("{n}", String(c.skipped))}</>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <StatusTabs
          pathname={pathname}
          sp={sp}
          current={query.filters.status ?? ""}
          items={[{ value: "", label: dict.admin.users.any, count: all }, ...SUBSCRIBER_STATUSES.map((v) => ({ value: v, label: t.statuses[v], count: byStatus[v] ?? 0 }))]}
        />
        <div className="border-b border-line p-3">
          <TableToolbar
            placeholder={t.search}
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
            filters={[{ key: "locale", label: t.col.locale, options: siteConfig.locales.map((l) => ({ value: l, label: localeLabels[l] })) }]}
          />
        </div>
        {total === 0 ? (
          <TableEmpty title={t.noSubscribers} body={t.noSubscribersBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[760px]">
              <thead>
                <tr>
                  <th>{t.col.email}</th>
                  <th>{t.col.locale}</th>
                  <th>{t.col.status}</th>
                  <th>{t.col.subscribed}</th>
                  <th>{t.col.confirmed}</th>
                  <th className="text-right">{t.col.action}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-[280px] truncate">{r.email}</td>
                    <td className="text-xs text-fg-2">{localeLabels[r.locale as keyof typeof localeLabels] ?? r.locale}</td>
                    <td>
                      <StatusTag status={r.status === "unsubscribed" ? "canceled" : r.status}>{t.statuses[r.status] ?? r.status}</StatusTag>
                    </td>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(r.createdAt)}</td>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(r.confirmedAt)}</td>
                    <td>
                      <SubscriberActions id={r.id} status={r.status} t={t} />
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
