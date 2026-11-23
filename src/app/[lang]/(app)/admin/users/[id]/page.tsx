import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { isEnvAdmin, requireAdmin } from "@/lib/admin";
import { getUserDetail, listUserTab, USER_TABS, type UserTab, type UserTabData } from "@/lib/admin-users";
import { localePath } from "@/lib/paths";
import { parseTableQuery, withParams } from "@/lib/table";
import { fmtTime, Panel, StatusTag, TableEmpty } from "@/components/admin/Panel";
import { Pagination, TableToolbar } from "@/components/admin/TableControls";
import { UserActions } from "@/components/admin/UserActions";
import type { Dictionary } from "@/i18n/dictionaries/en";

/** 依赖登录状态和查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: PageProps<"/[lang]/admin/users/[id]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { admin } = await getDictionary(lang);
  return { title: admin.users.title, robots: { index: false } };
}

/**
 * 后台 → 用户详情：资料、关键数字、各类记录（每个标签页单独分页，?tab=&page=&size=；日期范围 ?from=&to= 或 ?range= 切标签时保留），右侧是管理操作
 */
export default async function AdminUserPage({ params, searchParams }: PageProps<"/[lang]/admin/users/[id]">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const session = await requireAdmin();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const sp = await searchParams;
  const tab: UserTab = USER_TABS.includes(sp.tab as UserTab) ? (sp.tab as UserTab) : "credits";
  const query = parseTableQuery(sp);
  const [data, dict] = await Promise.all([listUserTab(id, tab, query), getDictionary(lang)]);
  const t = dict.admin.user;
  const { user: u, stats, tier } = detail;
  const usersHref = localePath(lang, "/admin/users");
  const base = `${usersHref}/${id}`;
  const plan = (planId: string) => dict.pricing.plans[planId]?.name ?? planId;
  const tierName =
    tier.kind === "subscription" ? plan(tier.planId) : tier.kind === "pack" ? dict.admin.users.pack.replace("{plan}", plan(tier.planId)) : dict.admin.users.free;

  const numbers = [
    { k: t.stats.credits, v: u.credits.toLocaleString() },
    { k: t.stats.paid, v: formatPrice(stats.gross - stats.refunded) },
    { k: t.stats.refunded, v: formatPrice(stats.refunded) },
    { k: t.stats.payments, v: stats.payments.toLocaleString() },
    { k: t.stats.generations, v: stats.generations.toLocaleString() },
    { k: t.stats.sessions, v: stats.sessions.toLocaleString() },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <Link href={usersHref} className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-2 hover:text-fg">
        <ArrowLeft className="size-3.5" /> {t.back}
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-canvas-2 text-lg font-semibold text-fg-2">
          {(u.name || u.email).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-[-0.02em]">{u.email}</h1>
          <p className="mt-0.5 text-sm text-fg-2">{u.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusTag status={u.emailVerified ? "active" : "unverified"}>{u.emailVerified ? t.verified : t.unverified}</StatusTag>
            {detail.isAdmin && <span className="tag tag-brand">{u.role === "admin" ? dict.admin.users.admin : t.envAdmin}</span>}
            {detail.banned && (
              <StatusTag status="banned">{u.banExpires ? t.bannedUntil.replace("{date}", fmtTime(u.banExpires)) : t.bannedForever}</StatusTag>
            )}
            <span className="tag">{tierName}</span>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-fg-3">{t.userId}</dt>
          <dd className="font-mono select-all">{u.id}</dd>
          <dt className="text-fg-3">{t.joined}</dt>
          <dd className="font-mono">{fmtTime(u.createdAt)}</dd>
          <dt className="text-fg-3">{t.lastActive}</dt>
          <dd className="font-mono">{stats.lastActive ? fmtTime(stats.lastActive) : t.never}</dd>
        </dl>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <div className="space-y-5">
          <Panel className="grid grid-cols-2 divide-line overflow-hidden sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-line max-lg:[&>*]:border-b sm:[&>*:not(:last-child)]:border-r">
            {numbers.map((n) => (
              <div key={n.k} className="px-4 py-3">
                <p className="text-xs text-fg-3">{n.k}</p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{n.v}</p>
              </div>
            ))}
          </Panel>

          <Panel className="overflow-hidden">
            <nav className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2 [scrollbar-width:none]" aria-label={t.actions}>
              {USER_TABS.map((key) => (
                <Link
                  key={key}
                  href={withParams(base, { from: sp.from, to: sp.to, range: sp.range }, { tab: key })}
                  scroll={false}
                  aria-current={key === tab ? "page" : undefined}
                  className={`-mb-px border-b-2 px-3 pb-2.5 pt-1.5 text-[0.8125rem] whitespace-nowrap transition ${
                    key === tab ? "border-brand-1 font-medium text-fg" : "border-transparent text-fg-3 hover:text-fg"
                  }`}
                >
                  {t.tabs[key]}
                </Link>
              ))}
            </nav>
            <div className="border-b border-line p-3">
              <TableToolbar anyLabel={dict.admin.users.any} clearLabel={dict.admin.table.clear} dates={dict.admin.table.dates} />
            </div>
            {data.total === 0 ? (
              <TableEmpty title={dict.admin.table.empty} body={query.from || query.to ? dict.admin.table.emptyHint : undefined} />
            ) : (
              <div className="overflow-x-auto">
                <TabTable data={data} t={t} plan={plan} />
              </div>
            )}
            {data.total > 0 && (
              <div className="border-t border-line px-3 py-2.5">
                <Pagination total={data.total} page={query.page} size={query.size} labels={dict.admin.table} />
              </div>
            )}
          </Panel>
        </div>

        <Panel className="h-fit overflow-hidden xl:sticky xl:top-4">
          <div className="panel-head">
            <h2 className="text-sm font-semibold">{t.actions}</h2>
          </div>
          <UserActions
            userId={u.id}
            email={u.email}
            usersHref={usersHref}
            isSelf={u.id === session.user.id}
            isAdmin={detail.isAdmin}
            envAdmin={isEnvAdmin(u.email)}
            role={u.role}
            banned={detail.banned}
            banReason={u.banReason}
            canDelete={stats.payments === 0}
            t={t}
          />
        </Panel>
      </div>
    </div>
  );
}

const Mono = ({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) => (
  <span className={`font-mono text-xs ${muted ? "text-fg-3" : ""}`}>{children}</span>
);

/** 各标签页的表格：列按记录类型不同 */
function TabTable({ data, t, plan }: { data: UserTabData; t: Dictionary["admin"]["user"]; plan: (id: string) => string }) {
  const c = t.cols;
  switch (data.tab) {
    case "credits":
      return (
        <table className="dtable min-w-[640px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th className="text-right">{c.change}</th>
              <th>{c.reason}</th>
              <th>{c.note}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(r.createdAt)}</Mono>
                </td>
                <td className={`text-right font-mono tabular-nums ${r.delta > 0 ? "text-success-fg" : ""}`}>
                  {r.delta > 0 ? "+" : ""}
                  {r.delta.toLocaleString()}
                </td>
                <td>
                  <span className="tag">{r.reason}</span>
                </td>
                <td className="max-w-[360px] truncate text-xs text-fg-2" title={r.note ?? undefined}>
                  {r.note ?? r.refId ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "orders":
      return (
        <table className="dtable min-w-[640px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th>{c.id}</th>
              <th>{c.plan}</th>
              <th>{c.provider}</th>
              <th className="text-right">{c.amount}</th>
              <th>{c.status}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((o) => (
              <tr key={o.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(o.createdAt)}</Mono>
                </td>
                <td>
                  <Mono>{o.id}</Mono>
                </td>
                <td>{plan(o.planId)}</td>
                <td className="text-fg-2">{o.provider}</td>
                <td className="text-right font-mono tabular-nums">{formatPrice(o.amount, o.currency)}</td>
                <td>
                  <StatusTag status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "payments":
      return (
        <table className="dtable min-w-[720px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th>{c.id}</th>
              <th>{c.plan}</th>
              <th className="text-right">{c.amount}</th>
              <th className="text-right">{c.refunded}</th>
              <th className="text-right">{c.credits}</th>
              <th>{c.status}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(p.createdAt)}</Mono>
                </td>
                <td>
                  <Mono>{p.providerPaymentId}</Mono>
                </td>
                <td>
                  {plan(p.planId)} <span className="text-xs text-fg-3">· {p.provider}</span>
                </td>
                <td className="text-right font-mono tabular-nums">{formatPrice(p.amount, p.currency)}</td>
                <td className="text-right font-mono tabular-nums text-fg-2">{p.refundedAmount ? formatPrice(p.refundedAmount, p.currency) : "—"}</td>
                <td className="text-right font-mono tabular-nums">{p.creditsGranted.toLocaleString()}</td>
                <td>
                  <StatusTag status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "subscriptions":
      return (
        <table className="dtable min-w-[640px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th>{c.id}</th>
              <th>{c.plan}</th>
              <th>{c.status}</th>
              <th>{c.period}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(s.createdAt)}</Mono>
                </td>
                <td>
                  <Mono>{s.providerSubId}</Mono>
                </td>
                <td>
                  {plan(s.planId)} <span className="text-xs text-fg-3">· {s.provider}</span>
                </td>
                <td>
                  <StatusTag status={s.status} />
                  {s.cancelAtPeriodEnd && <span className="tag ml-1">cancel at period end</span>}
                </td>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(s.currentPeriodEnd)}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "refunds":
      return (
        <table className="dtable min-w-[720px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th className="text-right">{c.amount}</th>
              <th className="text-right">{c.credits}</th>
              <th>{c.reason}</th>
              <th>{c.status}</th>
              <th>{c.admin}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(r.createdAt)}</Mono>
                </td>
                <td className="text-right font-mono tabular-nums">{formatPrice(r.amount)}</td>
                <td className="text-right font-mono tabular-nums">{r.credits.toLocaleString()}</td>
                <td className="max-w-[280px] truncate text-xs text-fg-2" title={r.reason}>
                  {r.reason}
                </td>
                <td>
                  <StatusTag status={r.status} />
                </td>
                <td className="text-xs text-fg-3">{r.reviewedBy ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "generations":
      return (
        <table className="dtable min-w-[720px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th>{c.feature}</th>
              <th className="text-right">{c.cost}</th>
              <th>{c.status}</th>
              <th>{c.detail}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((g) => (
              <tr key={g.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(g.createdAt)}</Mono>
                </td>
                <td>
                  {g.feature} <span className="text-xs text-fg-3">· {g.model}</span>
                </td>
                <td className="text-right font-mono tabular-nums">{g.cost}</td>
                <td>
                  <StatusTag status={g.status} />
                </td>
                <td className={`max-w-[320px] truncate text-xs ${g.error ? "text-danger-fg" : "text-fg-3"}`} title={g.error ?? g.input ?? undefined}>
                  {g.error ?? g.input ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "sessions":
      return (
        <table className="dtable min-w-[720px]">
          <thead>
            <tr>
              <th>{c.lastSeen}</th>
              <th>{c.device}</th>
              <th>IP</th>
              <th>{c.time}</th>
              <th>{c.expires}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap">
                  <Mono>{fmtTime(s.updatedAt)}</Mono>
                </td>
                <td className="max-w-[320px] truncate text-xs text-fg-2" title={s.userAgent ?? undefined}>
                  {s.userAgent ?? "—"}
                </td>
                <td>
                  <Mono muted>{s.ipAddress ?? "—"}</Mono>
                </td>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(s.createdAt)}</Mono>
                </td>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(s.expiresAt)}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "log":
      return (
        <table className="dtable min-w-[640px]">
          <thead>
            <tr>
              <th>{c.time}</th>
              <th>{c.admin}</th>
              <th>{c.action}</th>
              <th>{c.detail}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">
                  <Mono muted>{fmtTime(l.createdAt)}</Mono>
                </td>
                <td className="text-xs">{l.adminEmail}</td>
                <td>
                  <span className="tag">{l.action}</span>
                </td>
                <td className="max-w-[360px] truncate text-xs text-fg-2" title={l.detail ?? undefined}>
                  {l.detail || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
