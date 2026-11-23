"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { History, Loader2 } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { EmptyState } from "@/components/ui";

/**
 * 积分记录（设置 → 用量）：首屏 20 条由服务端给，往下滚动到底自动加载下一页（GET /api/credits/history），
 * 底部也有「加载更多」按钮兜底；顶部可以只看获得 / 消耗。时间精确到毫秒，按浏览器所在时区显示
 */
type Item = { id: string; delta: number; reason: string; note: string | null; at: string };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
/** YYYY-MM-DD HH:mm:ss.SSS；服务端渲染时用 UTC，到了浏览器换成本地时区 */
function formatTime(iso: string, utc: boolean) {
  const d = new Date(iso);
  const [y, mo, da, h, mi, s, ms] = utc
    ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()]
    : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
  return `${y}-${pad(mo)}-${pad(da)} ${pad(h)}:${pad(mi)}:${pad(s)}.${pad(ms, 3)}${utc ? " UTC" : ""}`;
}

const noSubscribe = () => () => {};
function Timestamp({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => formatTime(iso, false),
    () => formatTime(iso, true),
  );
  return (
    <time dateTime={iso} className="block font-mono text-[0.6875rem] text-fg-3 tabular-nums">
      {text}
    </time>
  );
}

export function CreditHistoryFeed({
  initial,
  next: initialNext,
  t,
  features,
}: {
  initial: Item[];
  next: string | null;
  t: Dictionary["account"];
  /** AI 功能 id → 名称（消耗记录的 note 是 ai:<功能>，显示成「消耗 · 生图」） */
  features: Record<string, string>;
}) {
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const sentinel = useRef<HTMLDivElement>(null);
  // 切筛选时作废还在路上的请求，晚到的结果不会混进新列表
  const request = useRef(0);

  const fetchPage = useCallback(async (dir: string, cursor: string | null) => {
    const id = ++request.current;
    setState("loading");
    const query = new URLSearchParams();
    if (cursor) query.set("cursor", cursor);
    if (dir) query.set("direction", dir);
    const res = await fetch(`/api/credits/history?${query}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { items: Item[]; next: string | null } | null;
    if (id !== request.current) return;
    if (!res?.ok || !data) return setState("error");
    setItems((prev) => (cursor ? [...prev, ...data.items.filter((i) => !prev.some((p) => p.id === i.id))] : data.items));
    setNext(data.next);
    setState("idle");
  }, []);

  const loadMore = useCallback(async () => {
    if (!next || state === "loading") return;
    await fetchPage(direction, next);
  }, [next, state, direction, fetchPage]);

  const pickDirection = (dir: "" | "in" | "out") => {
    if (dir === direction) return;
    setDirection(dir);
    setItems([]);
    setNext(null);
    void fetchPage(dir, null);
  };

  // 滚到列表底部附近就自动加载下一页
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || state !== "idle") return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, state, loadMore]);

  if (items.length === 0 && !direction && state === "idle") return <EmptyState icon={History} title={t.empty} body={t.historyEmpty} />;

  const label = (i: Item) => {
    const reason = t.reasons[i.reason] ?? i.reason;
    const feature = i.note?.startsWith("ai:") ? features[i.note.slice(3)] : undefined;
    return feature ? `${reason} · ${feature}` : reason;
  };

  return (
    <>
      <div role="group" aria-label={t.historyFilter} className="border-b border-line/60 px-3 py-2">
        <div className="seg">
          {(
            [
              ["", t.historyAll],
              ["in", t.historyIn],
              ["out", t.historyOut],
            ] as const
          ).map(([v, label]) => (
            <button key={v || "all"} type="button" aria-pressed={direction === v} onClick={() => pickDirection(v)} className="seg-item h-7 px-2.5 text-xs">
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul>
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 border-b border-line/60 px-5 py-3 last:border-0">
            <span
              className={`size-2 shrink-0 rounded-full ${
                i.delta > 0 ? "bg-success shadow-[0_0_0_3px_var(--success-soft)]" : "bg-neutral shadow-[0_0_0_3px_var(--neutral-soft)]"
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-medium">{label(i)}</span>
              <Timestamp iso={i.at} />
            </span>
            <span className={`font-mono text-[0.8125rem] tabular-nums ${i.delta > 0 ? "text-success-fg" : "text-fg-3"}`}>
              {i.delta > 0 ? `+${i.delta.toLocaleString()}` : `−${Math.abs(i.delta).toLocaleString()}`}
            </span>
          </li>
        ))}
      </ul>
      <div ref={sentinel} className="flex items-center justify-center gap-3 border-t border-line/60 px-5 py-3 text-xs text-fg-3">
        {state === "loading" ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" /> {t.loading}
          </span>
        ) : state === "error" ? (
          <>
            {t.loadFailed}
            <button type="button" onClick={() => (next ? loadMore() : fetchPage(direction, null))} className="link">
              {t.retry}
            </button>
          </>
        ) : next ? (
          <button type="button" onClick={loadMore} className="btn btn-secondary btn-sm">
            {t.loadMore}
          </button>
        ) : items.length === 0 ? (
          <span>{t.historyNone}</span>
        ) : (
          <span>
            {t.noMore} {t.localTime}
          </span>
        )}
      </div>
    </>
  );
}
