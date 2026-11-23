import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, SearchX } from "lucide-react";
import { withParams, type SearchParams, type TableQuery } from "@/lib/table";

/**
 * 后台的展示组件（服务端渲染）：平铺面板、可排序的表头、状态标签、空状态。
 * 交互的部分（搜索 / 筛选工具栏、分页）在 TableControls.tsx
 */

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PanelHead({ title, count, action }: { title: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="panel-head">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {count !== undefined && <span className="tag tabular-nums">{count.toLocaleString()}</span>}
      </h2>
      {action}
    </div>
  );
}

/** 表头：点一下按这列排序，再点切换升降序；排序变了回到第 1 页 */
export function SortHeader({
  label,
  sortKey,
  query,
  pathname,
  sp,
  align = "left",
}: {
  label: string;
  sortKey: string;
  query: TableQuery;
  pathname: string;
  sp: SearchParams;
  align?: "left" | "right";
}) {
  const active = query.sort === sortKey;
  const dir = active && query.dir === "desc" ? "asc" : "desc";
  const Icon = !active ? ArrowUpDown : query.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <Link
      href={withParams(pathname, sp, { sort: sortKey, dir, page: "" })}
      scroll={false}
      aria-sort={active ? (query.dir === "desc" ? "descending" : "ascending") : undefined}
      className={`inline-flex items-center gap-1 hover:text-fg ${active ? "text-fg" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {label}
      <Icon className={`size-3 ${active ? "" : "opacity-40"}`} />
    </Link>
  );
}

/** 按状态（或 param 指定的参数）分栏：每栏带数量，点了按它筛选（回到第 1 页）；value 为空表示「全部」 */
export function StatusTabs({
  pathname,
  sp,
  current,
  items,
  param = "status",
  reset = [],
}: {
  pathname: string;
  sp: SearchParams;
  current: string;
  items: { value: string; label: string; count?: number }[];
  param?: string;
  /** 切换时一起清掉的参数（比如切换视图时清掉另一个视图的筛选） */
  reset?: string[];
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2 [scrollbar-width:none]">
      {items.map((i) => {
        const active = i.value === current;
        return (
          <Link
            key={i.value || "all"}
            href={withParams(pathname, sp, { [param]: i.value, page: "", ...Object.fromEntries(reset.map((k) => [k, ""])) })}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pt-1.5 pb-2.5 text-[0.8125rem] whitespace-nowrap transition ${
              active ? "border-brand-1 font-medium text-fg" : "border-transparent text-fg-3 hover:text-fg"
            }`}
          >
            {i.label}
            {i.count !== undefined && <span className="tag tabular-nums">{i.count.toLocaleString()}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

const TAG_TONES: Record<string, string> = {
  paid: "tag-success",
  succeeded: "tag-success",
  active: "tag-success",
  ok: "tag-success",
  pending: "tag-warning",
  past_due: "tag-warning",
  partially_refunded: "tag-warning",
  unverified: "tag-warning",
  processing: "tag-brand",
  failed: "tag-danger",
  rejected: "tag-danger",
  error: "tag-danger",
  disputed: "tag-danger",
  banned: "tag-danger",
  running: "tag-brand",
  success: "tag-success",
  open: "tag-warning",
  resolved: "tag-success",
};

/** 状态标签：颜色按原始状态值，文字可以换成翻译 */
export function StatusTag({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`tag ${TAG_TONES[status] ?? ""}`}>{children ?? status}</span>;
}

export function TableEmpty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      <SearchX className="mb-1 size-5 text-fg-3" />
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="text-[0.8125rem] text-fg-3">{body}</p>}
    </div>
  );
}

/** 后台统一的时间格式：UTC，精确到秒 */
export const fmtTime = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");
