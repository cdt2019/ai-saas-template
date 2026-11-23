/**
 * 5 段 cron 表达式（分 时 日 月 周，按 UTC）：支持 *、*\/n、a-b、a-b/n、逗号列表，周日写 0 或 7。
 * 只做定时任务要用的两件事：校验表达式、算出某个时间之后的下一次运行时间。不引第三方库
 */
type Spec = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean };

function field(part: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const item of part.split(",")) {
    const [range, stepStr] = item.split("/");
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step: ${item}`);
    let lo: number, hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number) as [number, number];
    else [lo, hi] = [Number(range), stepStr === undefined ? Number(range) : max];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`out of range: ${item}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Spec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron needs 5 fields: minute hour day month weekday");
  const [mi, h, d, mo, w] = parts;
  const dow = field(w, 0, 7);
  if (dow.has(7)) dow.add(0);
  return { minute: field(mi, 0, 59), hour: field(h, 0, 23), dom: field(d, 1, 31), month: field(mo, 1, 12), dow, domAny: d === "*", dowAny: w === "*" };
}

export function isValidCron(expr: string) {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

/** 日和周都限定时按标准 cron 的规则：满足其一即可 */
function dayMatches(s: Spec, t: Date) {
  const dom = s.dom.has(t.getUTCDate());
  const dow = s.dow.has(t.getUTCDay());
  if (s.domAny && s.dowAny) return true;
  if (s.domAny) return dow;
  if (s.dowAny) return dom;
  return dom || dow;
}

/** after 之后（不含）的下一次运行时间，精确到分钟；两年内找不到返回 null */
export function nextRun(expr: string, after: Date): Date | null {
  const s = parseCron(expr);
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = after.getTime() + 2 * 366 * 86_400_000;
  while (t.getTime() <= limit) {
    if (!s.month.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
    } else if (!dayMatches(s, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
    } else if (!s.hour.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
    } else if (!s.minute.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
    } else return t;
  }
  return null;
}
