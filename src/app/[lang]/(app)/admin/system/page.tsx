import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, CircleMinus, TriangleAlert } from "lucide-react";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { runSystemChecks, type CheckStatus } from "@/lib/system-check";
import { Panel, PanelHead } from "@/components/admin/Panel";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和环境变量，每次请求实时检查 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/system">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.system.title, robots: { index: false } };
}

const ICONS: Record<CheckStatus, { icon: typeof CircleCheck; tone: string }> = {
  error: { icon: CircleAlert, tone: "text-danger-fg" },
  warn: { icon: TriangleAlert, tone: "text-warning-fg" },
  ok: { icon: CircleCheck, tone: "text-success-fg" },
  off: { icon: CircleMinus, tone: "text-fg-3" },
};

/** 后台 → 系统检查：上线前看哪些配置没填、填错了。页面只显示变量名，不显示变量的值（规则见 src/lib/system-check.ts） */
export default async function AdminSystemPage({ params }: PageProps<"/[lang]/admin/system">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const [{ groups, counts }, dict] = await Promise.all([runSystemChecks(), getDictionary(lang)]);
  const t = dict.admin.system;
  const cards: { status: CheckStatus; n: number }[] = [
    { status: "error", n: counts.error },
    { status: "warn", n: counts.warn },
    { status: "ok", n: counts.ok },
    { status: "off", n: counts.off },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ status, n }) => {
          const { icon: Icon, tone } = ICONS[status];
          return (
            <Panel key={status} className="flex items-center gap-3 p-4">
              <Icon className={`size-5 shrink-0 ${n ? tone : "text-fg-3"}`} />
              <span>
                <span className="block text-xl leading-none font-semibold tabular-nums">{n}</span>
                <span className="mt-1 block text-xs text-fg-3">{t.status[status]}</span>
              </span>
            </Panel>
          );
        })}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {groups.map((g) => (
          <Panel key={g.id} className="overflow-hidden">
            <PanelHead title={t.groups[g.id] ?? g.id} />
            <ul className="divide-y divide-line/60">
              {g.checks.map((c) => {
                const { icon: Icon, tone } = ICONS[c.status];
                return (
                  <li key={c.key} className="flex gap-3 px-4 py-3">
                    <Icon aria-label={t.status[c.status]} className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] font-medium">{t.items[c.key] ?? c.key}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{t.msgs[c.msg] ?? c.msg}</p>
                      {c.detail && <p className="mt-1 font-mono text-[0.6875rem] break-all text-fg-2 select-all">{c.detail}</p>}
                      {c.names && c.names.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1">
                          {c.names.map((n) => (
                            <code key={n} className="tag font-mono text-[0.6875rem]">
                              {n}
                            </code>
                          ))}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
