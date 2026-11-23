"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  Search,
} from "lucide-react";
import { DATE_PRESETS, PAGE_SIZES, presetRange, resolveDates, type DatePreset } from "@/lib/table";
import { Select } from "@/components/Select";
import { DateRangePicker, type DateRangeLabels } from "@/components/admin/DateRangePicker";

/**
 * 后台列表的搜索 / 筛选 / 日期范围工具栏和分页：只改网址参数，数据由服务端按参数重新查。
 * 第一行日期范围，第二行搜索和筛选；改了任何一项回到第 1 页；prefix 用于同一页有多个列表时区分参数。
 * 布局稳定：下拉框、日期按钮固定宽度，「重置」（回到默认）固定在日期行最后，加载图标放在搜索框里，
 * 操作时工具栏里的东西不会挪位置
 */
function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const go = (
    patch: Record<string, string | number | null>,
    mode: "push" | "replace" = "replace",
  ) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    startTransition(() =>
      router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  };
  return { sp, go, pending };
}

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

export type DateLabels = DateRangeLabels & Record<DatePreset | "any", string>;

/**
 * 日期范围（工具栏第一行）：起止日期选择 + 快捷按钮（全部时间、今天、昨天、近 7 天……）。
 * 快捷按钮写相对范围 ?range=last7（今天、明天打开各按当天算），日历里选的写 ?from=&to=；
 * 列表有默认范围时（defaultRange），选回默认就把参数去掉，选「全部时间」写 range=all。规则见 src/lib/table.ts 的 resolveDates。
 * 快捷按钮和 children（重置按钮）是一个不换行的整体：面板窄时快捷按钮横向滚动，重置始终跟在后面，不会单独掉到下一行
 */
function DateRow({
  labels,
  preset,
  from,
  to,
  defaultRange,
  pending,
  onChange,
  children,
}: {
  labels: DateLabels;
  preset: DatePreset | "all" | null;
  from: string;
  to: string;
  defaultRange: DatePreset | "all";
  pending: boolean;
  onChange: (patch: { from?: string; to?: string; range?: string }) => void;
  children?: ReactNode;
}) {
  const pick = (key: DatePreset | "all") =>
    onChange(key === defaultRange ? {} : { range: key });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1.5 text-xs text-fg-3 max-sm:w-full">
        <span className="shrink-0">{labels.label}</span>
        <DateRangePicker
          from={from}
          to={to}
          labels={labels}
          pending={pending}
          onChange={(f, t) => (f || t ? onChange({ from: f, to: t }) : pick("all"))}
        />
      </div>
      <div className="flex max-w-full min-w-0 items-center gap-2">
        <div
          role="group"
          aria-label={labels.label}
          className="seg min-w-0 overflow-x-auto [scrollbar-width:none]"
        >
          {(["all", ...DATE_PRESETS] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={preset === k}
              title={k === "all" ? undefined : presetRange(k).join(" – ")}
              onClick={() => pick(preset === k && k !== "all" ? "all" : k)}
              className="seg-item h-7 shrink-0 px-2 text-xs whitespace-nowrap"
            >
              {k === "all" ? labels.any : labels[k]}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export function TableToolbar({
  placeholder,
  filters = [],
  dates,
  defaultRange,
  anyLabel,
  clearLabel,
  prefix = "",
}: {
  /** 不传就不显示搜索框（只有筛选的列表） */
  placeholder?: string;
  filters?: FilterDef[];
  /** 传了就在第一行显示日期范围（参数 from / to / range） */
  dates?: DateLabels;
  /** 没选日期时的默认范围，要和页面 parseTableQuery 传的一致 */
  defaultRange?: DatePreset;
  anyLabel: string;
  clearLabel: string;
  prefix?: string;
}) {
  const { sp, go, pending } = useUrlParams();
  const urlQ = sp.get(`${prefix}q`) ?? "";
  const [q, setQ] = useState(urlQ);
  const first = useRef(true);

  // 停止输入 350ms 后再搜索，避免每敲一个字查一次库
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      if (q.trim() !== urlQ)
        go({ [`${prefix}q`]: q.trim(), [`${prefix}page`]: null });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在输入变化时触发
  }, [q]);

  const dateKeys = ["from", "to", "range"].map((k) => `${prefix}${k}`);
  const range = resolveDates((k) => sp.get(`${prefix}${k}`) ?? "", defaultRange);
  const active =
    !!urlQ ||
    dateKeys.some((k) => sp.get(k)) ||
    filters.some((f) => sp.get(`${prefix}${f.key}`));
  const main = !!placeholder || filters.length > 0;

  const spinner = (
    <LoaderCircle
      aria-hidden
      className={`size-4 shrink-0 animate-spin text-fg-3 ${pending ? "" : "invisible"}`}
    />
  );
  // 重置（回到默认）：有日期行时固定在日期行最后，没改过任何条件时隐藏但占着位置（日期行右边本来就空着），
  // 出现、消失都不挤动别的东西；没有日期行时放在搜索行最后
  const clear = (
    <button
      type="button"
      onClick={() => {
        setQ("");
        go({
          [`${prefix}q`]: null,
          [`${prefix}page`]: null,
          ...Object.fromEntries(dateKeys.map((k) => [k, null])),
          ...Object.fromEntries(
            filters.map((f) => [`${prefix}${f.key}`, null]),
          ),
        });
      }}
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      className={`btn btn-ghost btn-sm h-8 shrink-0 gap-1.5 text-xs ${active ? "" : dates ? "invisible" : "hidden"}`}
    >
      <RotateCcw className="size-3.5" /> {clearLabel}
    </button>
  );

  return (
    <div className="space-y-2.5">
      {dates && (
        <DateRow
          labels={dates}
          preset={range.preset}
          from={range.from}
          to={range.to}
          // 有搜索词时默认不限日期（和服务端一致）
          defaultRange={urlQ ? "all" : (defaultRange ?? "all")}
          // 有搜索框时加载图标在搜索框里，没有时日期按钮的日历图标换成加载图标
          pending={!placeholder && pending}
          onChange={(patch) =>
            go({
              ...Object.fromEntries(dateKeys.map((k) => [k, null])),
              ...Object.fromEntries(
                Object.entries(patch).map(([k, v]) => [`${prefix}${k}`, v]),
              ),
              [`${prefix}page`]: null,
            })
          }
        >
          {clear}
        </DateRow>
      )}
      {main && (
        <div className="flex flex-wrap items-center gap-2">
          {placeholder ? (
            <label className="relative min-w-[11rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className="field field-sm pr-9 pl-9"
              />
              <LoaderCircle
                aria-hidden
                className={`pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-fg-3 ${pending ? "" : "invisible"}`}
              />
            </label>
          ) : (
            !dates && spinner
          )}
          {filters.map((f) => (
            <div
              key={f.key}
              className="flex items-center gap-1.5 text-xs text-fg-3"
            >
              <span>{f.label}</span>
              <Select
                label={f.label}
                value={sp.get(`${prefix}${f.key}`) ?? ""}
                onChange={(v) =>
                  go({ [`${prefix}${f.key}`]: v, [`${prefix}page`]: null })
                }
                options={[{ value: "", label: anyLabel }, ...f.options]}
                className="w-28 text-fg"
              />
            </div>
          ))}
          {!dates && clear}
        </div>
      )}
    </div>
  );
}

export function Pagination({
  total,
  page,
  size,
  labels,
  prefix = "",
}: {
  total: number;
  page: number;
  size: number;
  labels: {
    showing: string;
    perPage: string;
    prev: string;
    next: string;
    jump: string;
  };
  prefix?: string;
}) {
  const { go, pending } = useUrlParams();
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const [jump, setJump] = useState("");
  const toPage = (p: number) =>
    go({ [`${prefix}page`]: p <= 1 ? null : Math.min(p, pages) }, "push");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-3">
      <span className="tabular-nums">
        {labels.showing
          .replace("{from}", from.toLocaleString())
          .replace("{to}", to.toLocaleString())
          .replace("{total}", total.toLocaleString())}
      </span>
      <div className="relative flex items-center gap-1.5">
        <LoaderCircle
          aria-hidden
          className={`absolute top-1/2 -left-6 size-3.5 -translate-y-1/2 animate-spin ${pending ? "" : "invisible"}`}
        />
        <Select
          label={labels.perPage.replace("{n}", "").trim()}
          value={String(size)}
          onChange={(v) =>
            go({
              [`${prefix}size`]: Number(v) === PAGE_SIZES[0] ? null : v,
              [`${prefix}page`]: null,
            })
          }
          options={PAGE_SIZES.map((n) => ({
            value: String(n),
            label: labels.perPage.replace("{n}", String(n)),
          }))}
          className="w-28 text-fg"
          align="right"
        />
        <button
          type="button"
          onClick={() => toPage(page - 1)}
          disabled={page <= 1}
          aria-label={labels.prev}
          className="icon-btn size-8"
        >
          <ChevronLeft className="size-4" />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.floor(Number(jump));
            if (n >= 1) toPage(n);
            setJump("");
          }}
          className="flex items-center gap-1.5"
        >
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            aria-label={labels.jump}
            placeholder={String(page)}
            className="field field-sm h-8 w-12 px-2 text-center font-mono text-xs"
          />
          <span className="min-w-[4ch] font-mono tabular-nums">
            / {pages.toLocaleString()}
          </span>
        </form>
        <button
          type="button"
          onClick={() => toPage(page + 1)}
          disabled={page >= pages}
          aria-label={labels.next}
          className="icon-btn size-8"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
