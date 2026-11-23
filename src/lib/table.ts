/**
 * 后台列表的查询参数：搜索、筛选、日期范围、排序、分页都放在网址里（?q=&status=&from=2026-10-01&to=2026-10-31&sort=created&dir=desc&page=2&size=50），
 * 刷新页面、复制链接给别人看到的都是同一页。服务端页面用 parseTableQuery 解析，客户端工具栏和分页改的也是这些参数。
 */
/** 每页条数可选值，第一个是默认 */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

export type TableQuery = {
  q: string;
  page: number;
  size: number;
  sort: string;
  dir: "asc" | "desc";
  filters: Record<string, string>;
  /** 日期范围 [from, to)：网址里是 UTC 日期、含首尾两天（或 range=快捷范围，见 resolveDates），这里 to 已经加了一天；不限是 null */
  from: Date | null;
  to: Date | null;
  /** 第几条开始（offset） */
  offset: number;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DAY = 86_400_000;
/** YYYY-MM-DD → 那天 0 点（UTC）；格式不对或日期不存在（2 月 30 日）返回 null */
const utcDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
};

/** 日期快捷范围（UTC，含首尾两天）。网址里写 ?range=last7 这种相对范围，今天打开、明天打开各按当天算 */
export const DATE_PRESETS = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];
const isPreset = (v: string): v is DatePreset => (DATE_PRESETS as readonly string[]).includes(v);

export function presetRange(key: DatePreset, now = new Date()): [string, string] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  const today = iso(y, m, d);
  const ranges: Record<DatePreset, [string, string]> = {
    today: [today, today],
    yesterday: [iso(y, m, d - 1), iso(y, m, d - 1)],
    last7: [iso(y, m, d - 6), today],
    last30: [iso(y, m, d - 29), today],
    thisMonth: [iso(y, m, 1), today],
    lastMonth: [iso(y, m - 1, 1), iso(y, m, 0)],
  };
  return ranges[key];
}

/**
 * 网址参数 → 当前日期范围（服务端查询和工具栏显示都用这一个，规则一致）：
 * 1. 有 from / to：自定义起止（填反了对调），preset 为 null
 * 2. range=all：不限；range=快捷范围：按今天算出起止
 * 3. 都没有：用列表的默认范围（defaultRange，如交易、日志默认近 7 天）；有搜索词时默认不限，按单号查老记录不会被挡住
 * get 读不带前缀的参数名（from / to / range / q）
 */
export function resolveDates(get: (key: string) => string, defaultRange?: DatePreset): { preset: DatePreset | "all" | null; from: string; to: string } {
  const from = utcDate(get("from")) ? get("from") : "";
  const to = utcDate(get("to")) ? get("to") : "";
  if (from || to) return from && to && from > to ? { preset: null, from: to, to: from } : { preset: null, from, to };
  const range = get("range");
  const key = isPreset(range) ? range : range === "all" || get("q").trim() ? "all" : (defaultRange ?? "all");
  if (key === "all") return { preset: "all", from: "", to: "" };
  const [f, t] = presetRange(key);
  return { preset: key, from: f, to: t };
}

/**
 * sorts：允许排序的列；filters：每个筛选项允许的取值（不在列表里的当作没选，防止拼进查询）。
 * prefix：同一个页面有多个列表时（用户详情的各个标签页），参数名加前缀区分；defaultRange：没选日期时的默认范围
 */
export function parseTableQuery(
  sp: SearchParams,
  opts: {
    sorts?: string[];
    defaultSort?: string;
    defaultDir?: "asc" | "desc";
    filters?: Record<string, readonly string[]>;
    prefix?: string;
    defaultRange?: DatePreset;
  } = {},
): TableQuery {
  const p = opts.prefix ?? "";
  const size = Number(one(sp[`${p}size`]));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZES[0];
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(one(sp[`${p}page`]))) || 1));
  const sort = one(sp[`${p}sort`]);
  const dir = one(sp[`${p}dir`]);
  const filters: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(opts.filters ?? {})) {
    const v = one(sp[`${p}${key}`]);
    if (allowed.includes(v)) filters[key] = v;
  }
  const dates = resolveDates((k) => one(sp[`${p}${k}`]), opts.defaultRange);
  const from = utcDate(dates.from);
  const to = utcDate(dates.to);
  return {
    q: one(sp[`${p}q`]).trim().slice(0, 200),
    page,
    size: pageSize,
    sort: opts.sorts?.includes(sort) ? sort : (opts.defaultSort ?? ""),
    dir: dir === "asc" || dir === "desc" ? dir : (opts.defaultDir ?? "desc"),
    filters,
    from,
    to: to && new Date(to.getTime() + DAY),
    offset: (page - 1) * pageSize,
  };
}

/** 在当前参数的基础上改几项，生成链接（值为空就去掉这个参数）；改了筛选 / 搜索 / 排序要回到第 1 页，由调用方传 page: "" */
export function withParams(pathname: string, current: SearchParams, patch: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const value = one(v);
    if (value) params.set(k, value);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** 总页数（至少 1 页） */
export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));
