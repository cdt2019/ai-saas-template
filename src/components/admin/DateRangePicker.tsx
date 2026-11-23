"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom";
import { DayPicker, type DateRange } from "react-day-picker";
import { enUS, zhCN } from "react-day-picker/locale";
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";

export type DateRangeLabels = {
  label: string;
  from: string;
  to: string;
  clear: string;
  pickStart: string;
  pickEnd: string;
  hint: string;
};

/**
 * YYYY-MM-DD ⇄ 日历用的 Date。日历里的 Date 只当「哪一天」用（本地时区那天 0 点），
 * 起止日期本身按 UTC 解释（见 src/lib/table.ts），所以「今天」也按 UTC 算，和快捷按钮、表格里的时间一致
 */
const toDate = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const utcToday = () => {
  const n = new Date();
  return new Date(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};

const navBtn =
  "grid size-8 place-items-center rounded-lg text-fg-2 transition hover:bg-canvas-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30";
const rangeEnd = "bg-primary/10 [&>button]:bg-primary [&>button]:text-primary-fg [&>button]:hover:bg-primary";

/**
 * 日期范围选择：按钮显示「开始日期 – 结束日期」，点开是两个月的日历（手机上一个月）。
 * 点第一下定开始、第二下定结束（点反了自动对调）就应用并收起，选结束时鼠标移到哪天就预览到哪天；今天以后的日子不能选。
 * 日历用 react-day-picker（shadcn 的日历也是它），浮层用 Floating UI 定位：挂在 body 上不被面板裁掉，下面放不下往上弹
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  labels,
  pending = false,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  labels: DateRangeLabels;
  /** 正在按新范围加载：日历图标换成转圈的加载图标 */
  pending?: boolean;
}) {
  const zh = useParams<{ lang?: string }>()?.lang === "zh";
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(2);
  // 日历里正在选的：first = 已经点了开始，等着点结束
  const [first, setFirst] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const show = () => {
    setMonths(window.matchMedia("(min-width: 640px)").matches ? 2 : 1);
    setFirst(null);
    setHover(null);
    setOpen(true);
  };
  const choose = (day: Date) => {
    if (!first) {
      setFirst(day);
      return;
    }
    const [f, t] = day < first ? [day, first] : [first, day];
    setOpen(false);
    onChange(toIso(f), toIso(t));
  };

  const today = utcToday();
  // 显示的选中范围：正在选时是「开始 → 鼠标所在的那天」，否则是网址里的范围
  const end = first && (hover ?? first);
  const shown: DateRange | undefined = first
    ? end! < first
      ? { from: end!, to: first }
      : { from: first, to: end! }
    : from || to
      ? { from: toDate(from || to), to: toDate(to || from) }
      : undefined;
  // 默认翻到结束日期（或今天）所在的月，两个月时放在右边
  const anchor = to ? toDate(to) : from ? toDate(from) : today;
  const defaultMonth = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1), 1);

  return (
    <div className="relative w-[15.5rem] shrink-0 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
      <button
        ref={(el) => {
          button.current = el;
          refs.setReference(el);
        }}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${labels.label}: ${from || labels.from} – ${to || labels.to}`}
        onClick={() => (open ? setOpen(false) : show())}
        className="field field-sm flex w-full items-center gap-2 pr-8 text-left text-xs"
      >
        {pending ? (
          <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-fg-3" />
        ) : (
          <CalendarDays className="size-4 shrink-0 text-fg-3" />
        )}
        <span className={`truncate ${from ? "font-mono text-fg" : "text-fg-3"}`}>{from || labels.from}</span>
        <span className="shrink-0 text-fg-3">–</span>
        <span className={`truncate ${to ? "font-mono text-fg" : "text-fg-3"}`}>{to || labels.to}</span>
      </button>
      {(from || to) && (
        <button
          type="button"
          onClick={() => onChange("", "")}
          title={labels.clear}
          aria-label={labels.clear}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-3 transition hover:bg-canvas-2 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={(el) => {
              panel.current = el;
              refs.setFloating(el);
            }}
            style={floatingStyles}
            role="dialog"
            aria-label={labels.label}
            className="popover z-50 p-3"
          >
            <DayPicker
              mode="range"
              locale={zh ? zhCN : enUS}
              numberOfMonths={months}
              defaultMonth={defaultMonth}
              today={today}
              disabled={{ after: today }}
              endMonth={today}
              fixedWeeks
              selected={shown}
              onSelect={(_, day) => choose(day)}
              onDayMouseEnter={(day) => first && setHover(day)}
              formatters={{
                formatCaption: (m) => (zh ? `${m.getFullYear()} 年 ${m.getMonth() + 1} 月` : m.toLocaleDateString("en-US", { month: "long", year: "numeric" })),
                formatWeekdayName: (d) => (zh ? "日一二三四五六"[d.getDay()] : d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)),
              }}
              components={{
                Chevron: ({ orientation }) => (orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />),
              }}
              classNames={{
                root: "text-fg",
                months: "relative flex gap-6 max-sm:flex-col",
                month: "space-y-2",
                month_caption: "flex h-8 items-center justify-center text-[0.8125rem] font-semibold",
                caption_label: "",
                nav: "absolute inset-x-0 top-0 z-10 flex justify-between",
                button_previous: navBtn,
                button_next: navBtn,
                chevron: "",
                month_grid: "border-collapse",
                weekdays: "",
                weekday: "h-8 w-9 text-[0.6875rem] font-medium text-fg-3",
                weeks: "",
                week: "",
                day: "p-0 text-center",
                day_button:
                  "grid size-9 place-items-center rounded-lg font-mono text-xs text-fg-2 tabular-nums transition hover:bg-canvas-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand",
                today: "[&>button]:font-semibold [&>button]:text-brand",
                outside: "invisible",
                disabled: "[&>button]:pointer-events-none [&>button]:opacity-30",
                hidden: "invisible",
                selected: "",
                range_start: `rounded-l-lg ${rangeEnd}`,
                range_end: `rounded-r-lg ${rangeEnd}`,
                range_middle: "bg-primary/10 [&>button]:rounded-none [&>button]:text-fg [&>button]:hover:bg-primary/15",
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2.5 text-xs">
              <span className="text-fg-3">
                {first ? labels.pickEnd : labels.pickStart}
                <span title={labels.hint} className="ml-2 cursor-help font-mono text-[0.6875rem]">
                  UTC
                </span>
              </span>
              {(from || to) && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChange("", "");
                  }}
                  className="btn btn-ghost btn-sm h-7 text-xs"
                >
                  {labels.clear}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
