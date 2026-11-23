import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { listUsers, USER_FILTERS, USER_SORTS } from "@/lib/admin-users";
import { localePath } from "@/lib/paths";
import { parseTableQuery } from "@/lib/table";
import type { AccountTier } from "@/lib/tier";
import { fmtTime, Panel, SortHeader, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { PageHeader } from "@/components/ui";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin/users">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.users.title, robots: { index: false } };
}

/** 后台 → 用户：搜索邮箱 / 名字 / ID，按状态、是否付费、角色筛选，可排序，服务端分页 */
export default async function AdminUsersPage({ params, searchParams }: PageProps<"/[lang]/admin/users">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const query = parseTableQuery(sp, { sorts: USER_SORTS, defaultSort: "created", filters: USER_FILTERS });
  const [{ rows, total }, dict] = await Promise.all([listUsers(query), getDictionary(lang)]);
  const t = dict.admin.users;
  const pathname = localePath(lang, "/admin/users");
  const sort = (label: string, key: string, align?: "right") => <SortHeader label={label} sortKey={key} query={query} pathname={pathname} sp={sp} align={align} />;
  const planName = (tier: AccountTier) =>
    tier.kind === "subscription"
      ? (dict.pricing.plans[tier.planId]?.name ?? tier.planId)
      : tier.kind === "pack"
        ? t.pack.replace("{plan}", dict.pricing.plans[tier.planId]?.name ?? tier.planId)
        : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title={t.title} lead={t.lead} />
      <Panel className="overflow-hidden">
        <div className="border-b border-line p-3">
          <TableToolbar
            placeholder={t.search}
            anyLabel={t.any}
            clearLabel={dict.admin.table.clear}
            dates={{ ...dict.admin.table.dates, label: t.col.joined }}
            filters={[
              { key: "status", label: t.filter.status, options: USER_FILTERS.status.map((v) => ({ value: v, label: t.status[v] })) },
              { key: "paid", label: t.filter.paid, options: USER_FILTERS.paid.map((v) => ({ value: v, label: t.paid[v] })) },
              { key: "role", label: t.filter.role, options: USER_FILTERS.role.map((v) => ({ value: v, label: t.role[v] })) },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <TableEmpty title={dict.admin.table.empty} body={dict.admin.table.emptyHint} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable min-w-[920px]">
              <thead>
                <tr>
                  <th>{sort(t.col.user, "email")}</th>
                  <th>{t.col.status}</th>
                  <th>{t.col.plan}</th>
                  <th className="text-right">{sort(t.col.credits, "credits", "right")}</th>
                  <th className="text-right">{sort(t.col.paid, "paid", "right")}</th>
                  <th>{t.col.lastActive}</th>
                  <th>{sort(t.col.joined, "created")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const plan = planName(u.tier);
                  const status = u.banned ? "banned" : u.emailVerified ? "active" : "unverified";
                  return (
                    <tr key={u.id}>
                      <td className="max-w-[320px]">
                        <Link href={`${pathname}/${u.id}`} className="group flex min-w-0 items-center gap-2.5">
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-canvas-2 text-xs font-semibold text-fg-2">
                            {(u.name || u.email).charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-medium group-hover:underline">{u.email}</span>
                              {u.isAdmin && <span className="tag tag-brand">{t.admin}</span>}
                            </span>
                            <span className="block truncate text-xs text-fg-3">{u.name}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <StatusTag status={status}>{t.status[status]}</StatusTag>
                      </td>
                      <td>{plan ? <span className="tag">{plan}</span> : <span className="text-xs text-fg-3">{t.free}</span>}</td>
                      <td className="text-right font-mono tabular-nums">{u.credits.toLocaleString()}</td>
                      <td className="text-right font-mono tabular-nums">{u.paidNet ? formatPrice(u.paidNet) : <span className="text-fg-3">—</span>}</td>
                      <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(u.lastActive)}</td>
                      <td className="font-mono text-xs whitespace-nowrap text-fg-3">{fmtTime(u.createdAt)}</td>
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
