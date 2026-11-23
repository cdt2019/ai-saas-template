import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { CREDIT_FILTERS, listCreditLedger } from "@/lib/admin-activity";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import { fmtTime, Panel, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/credits">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.credits.title, robots: { index: false } };
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${Math.abs(n).toLocaleString()}` : "0");

/**
 * 后台 → 积分流水：全站每一笔积分变动（只读）。按邮箱、用户 id、幂等号搜索，按类型、增减、日期筛选，默认近 7 天。
 * 顶部汇总跟着筛选走；全站余额是此刻用户手里还没用的积分（相当于还欠用户的服务）
 */
export default async function AdminCreditsPage({ params, searchParams }: PageProps<"/[lang]/admin/credits">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { filters: CREDIT_FILTERS, defaultRange: "last7" });
  const [{ rows, total, summary }, dict] = await Promise.all([listCreditLedger(query), getDictionary(lang)]);
  const t = dict.admin.credits;
  const reasons = dict.account.reasons;
  const features: Record<string, string> = { rewrite: dict.studio.tabs.text, image: dict.studio.tabs.image, video: dict.studio.tabs.video };
  const usersHref = localePath(lang, "/admin/users");
  const cards = [
    { k: t.added, v: `+${summary.added.toLocaleString()}`, tone: "text-success-fg" },
    { k: t.removed, v: `−${summary.removed.toLocaleString()}`, tone: "" },
    { k: t.net, v: signed(summary.net), tone: "" },
    { k: t.balance, v: summary.balance.toLocaleString(), tone: "", hint: t.balanceHint },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Panel key={c.k} className="p-4">
            <p className="text-xs text-fg-3">{c.k}</p>
            <p className={`mt-1.5 text-xl font-semibold tracking-[-0.02em] tabular-nums ${c.tone}`}>{c.v}</p>
            {c.hint && <p className="mt-1 text-[0.6875rem] text-fg-3">{c.hint}</p>}
          </Panel>
        ))}
      </div>
      <Panel className="overflow-hidden">
        <div className="border-b border-line p-3">
          <TableToolbar
            placeholder={t.search}
            anyLabel={dict.admin.users.any}
            clearLabel={dict.admin.table.clear}
            dates={dict.admin.table.dates}
            defaultRange="last7"
            filters={[
              { key: "reason", label: t.col.reason, options: CREDIT_FILTERS.reason.map((v) => ({ value: v, label: reasons[v] ?? v })) },
              { key: "direction", label: t.direction, options: [{ value: "in", label: t.in }, { value: "out", label: t.out }] },
            ]}
          />
        </div>
        {total === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[820px]">
              <thead>
                <tr>
                  <th>{t.col.time}</th>
                  <th>{t.col.user}</th>
                  <th>{t.col.reason}</th>
                  <th className="text-right">{t.col.delta}</th>
                  <th>{t.col.ref}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t: r, email }) => {
                  const feature = r.note?.startsWith("ai:") ? features[r.note.slice(3)] : undefined;
                  return (
                    <tr key={r.id}>
                      <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(r.createdAt)}</td>
                      <td className="max-w-[240px] truncate">
                        <Link href={`${usersHref}/${r.userId}?tab=credits`} className="hover:underline">
                          {email}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">
                        {reasons[r.reason] ?? r.reason}
                        {feature && <span className="text-xs text-fg-3"> · {feature}</span>}
                      </td>
                      <td className={`text-right font-mono tabular-nums ${r.delta > 0 ? "text-success-fg" : "text-fg-2"}`}>{signed(r.delta)}</td>
                      <td className="max-w-[320px] font-mono text-xs text-fg-3">
                        <span title={r.refId ?? ""} className="block truncate">
                          {r.refId ?? "—"}
                        </span>
                        {r.note && !feature && (
                          <span title={r.note} className="block truncate text-[0.6875rem]">
                            {r.note}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
