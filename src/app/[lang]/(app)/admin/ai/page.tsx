import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { AI_FILTERS, AI_SORTS, AI_STATUSES, listAiCalls } from "@/lib/admin-activity";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, PanelHead, SortHeader, StatusTabs, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/ai">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.ai.title, robots: { index: false } };
}

const secs = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(1)}%` : "—");

/**
 * 后台 → AI 调用：每一次生成（文本、图片、视频）。顶部看调用量、成功率、失败和卡住的数量，
 * 按功能看耗时（平均 / P95）和成功调用消耗的积分；下面是明细，失败的带平台报错。默认近 7 天
 */
export default async function AdminAiPage({ params, searchParams }: PageProps<"/[lang]/admin/ai">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { sorts: AI_SORTS, defaultSort: "created", filters: AI_FILTERS, defaultRange: "last7" });
  const [{ rows, total, features, summary: s }, dict] = await Promise.all([listAiCalls(query), getDictionary(lang)]);
  const t = dict.admin.ai;
  const pathname = localePath(lang, "/admin/ai");
  const usersHref = localePath(lang, "/admin/users");
  const featureName = (id: string) => ({ rewrite: dict.studio.tabs.text, image: dict.studio.tabs.image, video: dict.studio.tabs.video })[id] ?? id;
  const statusName = (v: string) => t.statuses[v] ?? v;
  const finished = s.succeeded + s.failed;
  const cards = [
    { k: t.calls, v: s.calls.toLocaleString(), tone: "" },
    { k: t.successRate, v: pct(s.succeeded, finished), tone: "" },
    { k: t.failed, v: s.failed.toLocaleString(), tone: s.failed ? "text-danger-fg" : "" },
    { k: t.stuck, v: s.stuck.toLocaleString(), tone: s.stuck ? "text-warning-fg" : "", hint: t.stuckHint },
    { k: t.credits, v: s.credits.toLocaleString(), tone: "" },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((c) => (
          <Panel key={c.k} className="p-4">
            <p className="text-xs text-fg-3">{c.k}</p>
            <p className={`mt-1.5 text-xl font-semibold tracking-[-0.02em] tabular-nums ${c.tone}`}>{c.v}</p>
            {c.hint && <p className="mt-1 text-[0.6875rem] text-fg-3">{c.hint}</p>}
          </Panel>
        ))}
      </div>

      {features.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHead title={t.byFeature} />
          <div className="overflow-x-auto">
            <table className="dtable min-w-[720px]">
              <thead>
                <tr>
                  <th>{t.col.feature}</th>
                  <th className="text-right">{t.calls}</th>
                  <th className="text-right">{t.successRate}</th>
                  <th className="text-right">{t.failed}</th>
                  <th className="text-right">{t.avg}</th>
                  <th className="text-right">{t.p95}</th>
                  <th className="text-right">{t.credits}</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.feature}>
                    <td className="font-medium">{featureName(f.feature)}</td>
                    <td className="text-right font-mono text-xs tabular-nums">{f.calls.toLocaleString()}</td>
                    <td className="text-right font-mono text-xs tabular-nums">{pct(f.succeeded, f.succeeded + f.failed)}</td>
                    <td className={`text-right font-mono text-xs tabular-nums ${f.failed ? "text-danger-fg" : "text-fg-3"}`}>{f.failed.toLocaleString()}</td>
                    <td className="text-right font-mono text-xs tabular-nums">{secs(f.avgMs)}</td>
                    <td className="text-right font-mono text-xs tabular-nums">{secs(f.p95Ms)}</td>
                    <td className="text-right font-mono text-xs tabular-nums">{f.credits.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        <StatusTabs
          pathname={pathname}
          sp={sp}
          current={query.filters.status ?? ""}
          items={[
            { value: "", label: dict.admin.users.any, count: s.calls },
            { value: "succeeded", label: statusName("succeeded"), count: s.succeeded },
            { value: "failed", label: statusName("failed"), count: s.failed },
            { value: "pending", label: statusName("pending"), count: s.pending },
          ].filter((i) => !i.value || AI_STATUSES.includes(i.value as (typeof AI_STATUSES)[number]))}
        />
        <div className="border-b border-line p-3">
          <TableToolbar
            placeholder={t.search}
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
            defaultRange="last7"
            filters={[{ key: "feature", label: t.col.feature, options: AI_FILTERS.feature.map((v) => ({ value: v, label: featureName(v) })) }]}
          />
        </div>
        {total === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[900px]">
              <thead>
                <tr>
                  <th>
                    <SortHeader label={t.col.time} sortKey="created" query={query} pathname={pathname} sp={sp} />
                  </th>
                  <th>{t.col.user}</th>
                  <th>{t.col.feature}</th>
                  <th>{t.col.status}</th>
                  <th className="text-right">{t.col.cost}</th>
                  <th className="text-right">
                    <SortHeader label={t.col.duration} sortKey="duration" query={query} pathname={pathname} sp={sp} align="right" />
                  </th>
                  <th>{t.col.detail}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">
                      {fmtTime(r.createdAt).slice(0, 10)}
                      <span className="block">{fmtTime(r.createdAt).slice(11)}</span>
                    </td>
                    <td className="max-w-[180px] truncate">
                      <Link href={`${usersHref}/${r.userId}?tab=generations`} className="hover:underline">
                        {r.email}
                      </Link>
                    </td>
                    <td className="max-w-[190px]">
                      {featureName(r.feature)}
                      <span title={r.model} className="block truncate font-mono text-[0.6875rem] text-fg-3">
                        {r.model}
                      </span>
                    </td>
                    <td>
                      <StatusTag status={r.status}>{statusName(r.status)}</StatusTag>
                    </td>
                    <td className="text-right font-mono text-xs tabular-nums">{r.cost}</td>
                    <td className="text-right font-mono text-xs whitespace-nowrap tabular-nums">{secs(r.durationMs)}</td>
                    <td className="max-w-[300px] min-w-[180px] text-xs text-fg-2">
                      {r.error && (
                        <span title={r.error} className="mb-0.5 line-clamp-2 font-mono text-[0.6875rem] break-all text-danger-fg">
                          {r.error}
                        </span>
                      )}
                      <span title={r.input ?? ""} className="line-clamp-1 break-all text-fg-3">
                        {r.input ?? "—"}
                      </span>
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
