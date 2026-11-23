import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { listJobRuns, RUN_FILTERS } from "@/lib/admin-ops";
import { jobStates, schedulerHealth } from "@/lib/jobs/runner";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, PanelHead, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { JobControls } from "@/components/admin/OpsActions";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/jobs">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.jobs.title, robots: { index: false } };
}

const duration = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pretty = (json: string | null) => {
  if (!json) return "";
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

/**
 * 后台 → 定时任务：调度器状态（最近一次被触发、时钟停了的提醒、怎么配置）、每个任务（频率、开关、上次 / 下次运行、立即运行）、
 * 运行历史（分页，展开看结果摘要、错误和日志）
 */
export default async function AdminJobsPage({ params, searchParams }: PageProps<"/[lang]/admin/jobs">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { filters: RUN_FILTERS, defaultRange: "last7" });
  const [health, jobs, runs, dict] = await Promise.all([schedulerHealth(), jobStates(), listJobRuns(query), getDictionary(lang)]);
  const t = dict.admin.jobs;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />

      <Panel className={`flex gap-3 p-4 ${health.stale ? "border-warning/40" : ""}`}>
        {health.stale ? <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning-fg" /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-success-fg" />}
        <div className="min-w-0 flex-1 text-[0.8125rem]">
          <p className="font-semibold">{health.stale ? t.stale : t.healthy}</p>
          <p className="mt-1 text-fg-2">
            {t.mode[health.mode]} ·{" "}
            {health.lastTickAt
              ? t.lastTick.replace("{time}", fmtTime(health.lastTickAt)).replace("{trigger}", health.lastTrigger ?? "")
              : t.neverTicked}
          </p>
          {health.stale && <p className="mt-2 leading-relaxed text-fg-3">{t.setup}</p>}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHead title={t.listTitle} count={jobs.length} />
        <div className="overflow-x-auto">
          <table className="dtable min-w-[920px]">
            <thead>
              <tr>
                <th>{t.col.job}</th>
                <th>{t.col.schedule}</th>
                <th>{t.col.last}</th>
                <th>{t.col.next}</th>
                <th className="text-right">{t.col.actions}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.name}>
                  <td className="max-w-[340px]">
                    <p className="flex items-center gap-1.5 font-medium">
                      {t.names[j.name]?.title ?? j.name}
                      {!j.enabled && <span className="tag">{t.off}</span>}
                      {j.running && <StatusTag status="running">{t.statuses.running}</StatusTag>}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{t.names[j.name]?.desc}</p>
                    <p className="mt-0.5 font-mono text-[0.6875rem] text-fg-3">{j.name}</p>
                  </td>
                  <td>
                    <code className="font-mono text-xs whitespace-nowrap">{j.schedule}</code>
                    <span className="block text-[0.6875rem] text-fg-3">{j.schedule === j.defaultSchedule ? t.utc : t.custom}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {j.lastStatus ? <StatusTag status={j.lastStatus}>{t.statuses[j.lastStatus] ?? j.lastStatus}</StatusTag> : <span className="text-xs text-fg-3">{t.never}</span>}
                    {j.lastRunAt && <span className="mt-1 block font-mono text-[0.6875rem] text-fg-3">{fmtTime(j.lastRunAt)}</span>}
                  </td>
                  <td className="font-mono text-xs whitespace-nowrap text-fg-2">{j.enabled ? (j.nextRunAt ? fmtTime(j.nextRunAt) : t.nextTick) : "—"}</td>
                  <td>
                    <JobControls name={j.name} enabled={j.enabled} schedule={j.schedule} defaultSchedule={j.defaultSchedule} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHead title={t.historyTitle} count={runs.total} />
        <div className="border-b border-line p-3">
          <TableToolbar
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
            defaultRange="last7"
            filters={[
              { key: "job", label: t.col.job, options: RUN_FILTERS.job.map((v) => ({ value: v, label: t.names[v]?.title ?? v })) },
              { key: "status", label: t.col.status, options: RUN_FILTERS.status.map((v) => ({ value: v, label: t.statuses[v] ?? v })) },
              { key: "trigger", label: t.col.trigger, options: RUN_FILTERS.trigger.map((v) => ({ value: v, label: t.triggers[v] ?? v })) },
            ]}
          />
        </div>
        {runs.total === 0 ? (
          <TableEmpty title={t.noRuns} body={t.noRunsBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[960px]">
              <thead>
                <tr>
                  <th>{t.col.started}</th>
                  <th>{t.col.job}</th>
                  <th>{t.col.trigger}</th>
                  <th>{t.col.status}</th>
                  <th className="text-right">{t.col.duration}</th>
                  <th>{t.col.result}</th>
                </tr>
              </thead>
              <tbody>
                {runs.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(r.startedAt)}</td>
                    <td className="text-[0.8125rem]">{t.names[r.job]?.title ?? r.job}</td>
                    <td className="text-xs text-fg-2">
                      {t.triggers[r.trigger] ?? r.trigger}
                      {r.triggeredBy && <span className="block text-[0.6875rem] text-fg-3">{r.triggeredBy}</span>}
                    </td>
                    <td>
                      <StatusTag status={r.status}>{t.statuses[r.status] ?? r.status}</StatusTag>
                    </td>
                    <td className="text-right font-mono text-xs tabular-nums">{duration(r.durationMs)}</td>
                    <td className="max-w-[460px] text-xs">
                      {r.error && <p className="text-danger-fg">{r.error}</p>}
                      {(r.summary || r.log) && (
                        <details>
                          <summary className="cursor-pointer text-fg-3 hover:text-fg">{t.details}</summary>
                          {r.summary && <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-canvas-2 p-2 text-[11px] whitespace-pre-wrap text-fg-2">{pretty(r.summary)}</pre>}
                          {r.log && <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-canvas-2 p-2 text-[11px] whitespace-pre-wrap text-fg-3">{r.log}</pre>}
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
          <Pagination total={runs.total} page={query.page} size={query.size} labels={dict.admin.table} />
        </div>
      </Panel>
      <p className="text-xs text-fg-3">
        {t.footer.replace("{path}", "/api/cron/tick")} ·{" "}
        <Link href={localePath(lang, "/admin/reconciliation")} className="underline hover:text-fg">
          {dict.admin.nav.reconciliation}
        </Link>
      </p>
    </div>
  );
}
