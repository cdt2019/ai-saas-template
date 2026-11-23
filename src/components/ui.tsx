import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** 订单 / 支付 / 退款 / 订阅等状态 → 胶囊颜色。文字保持原始状态值（测试和后台都按原值匹配） */
const TONES: Record<string, string> = {
  paid: "badge-success",
  succeeded: "badge-success",
  active: "badge-success",
  ok: "badge-success",
  refunded: "badge-neutral",
  canceled: "badge-neutral",
  expired: "badge-neutral",
  ignored: "badge-neutral",
  pending: "badge-warning",
  past_due: "badge-warning",
  partially_refunded: "badge-warning",
  processing: "badge-info",
  failed: "badge-danger",
  rejected: "badge-danger",
  error: "badge-danger",
  disputed: "badge-danger",
};

export function StatusBadge({ status, children, className = "" }: { status: string; children?: ReactNode; className?: string }) {
  return <span className={`badge ${TONES[status] ?? "badge-neutral"} ${className}`}>{children ?? status}</span>;
}

/**
 * 按钮文字在两种状态之间切换（生成 / 生成中…、保存 / 已保存）时宽度不变：
 * 两段内容叠在同一个格子里，按较宽的那段占位，只切换哪段可见，旁边的元素不会被推来推去
 */
export function SwapLabel({ show, alt, children }: { show: boolean; alt: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-grid [&>*]:col-start-1 [&>*]:row-start-1">
      <span className={`inline-flex items-center justify-center gap-2 ${show ? "invisible" : ""}`}>{children}</span>
      <span className={`inline-flex items-center justify-center gap-2 ${show ? "" : "invisible"}`}>{alt}</span>
    </span>
  );
}

/** 双层卡片：浅色外壳 + 内卡 */
export function Bezel({ children, className = "", innerClassName = "" }: { children: ReactNode; className?: string; innerClassName?: string }) {
  return (
    <div className={`bezel ${className}`}>
      <div className={`card ${innerClassName}`}>{children}</div>
    </div>
  );
}

/** 卡片标题栏：标题 + 计数 + 右侧操作 */
export function CardHeader({ title, count, action, border = true }: { title: ReactNode; count?: number; action?: ReactNode; border?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${border ? "border-b border-line" : ""}`}>
      <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.015em]">
        {title}
        {count !== undefined && <span className="badge badge-neutral badge-plain h-5 tabular-nums">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-fg-3 shadow-sm">
        <Icon className="size-[18px]" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-xs text-[0.8125rem] text-fg-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** 应用内页面标题 */
export function PageHeader({ title, lead, actions }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.035em] sm:text-[1.75rem]">{title}</h1>
        {lead && <p className="mt-1.5 max-w-2xl text-sm text-fg-3">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 面积折线图（纯 SVG，服务端渲染）。id 用来区分渐变，同页多个图要传不同的 id */
export function AreaChart({
  id,
  values,
  height = 72,
  stroke = "var(--brand-1)",
  fill = "var(--brand-1)",
}: {
  id: string;
  values: number[];
  height?: number;
  stroke?: string;
  fill?: string;
}) {
  const w = 400;
  const max = Math.max(1, ...values);
  const n = Math.max(2, values.length);
  const pts = values.map((v, i) => [(i / (n - 1)) * w, height - 6 - (v / max) * (height - 14)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full overflow-visible" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.45" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** 刻度条：value 为 0..1，填满的格子用 fill 颜色 */
export function TickMeter({
  value,
  count = 30,
  fill = "bg-brand-1",
  empty = "bg-viz-muted",
  className = "h-5",
}: {
  value: number;
  count?: number;
  fill?: string;
  empty?: string;
  className?: string;
}) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * count);
  return (
    <div aria-hidden className={`flex gap-[3px] ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`tick h-full ${i < filled ? fill : empty}`} />
      ))}
    </div>
  );
}
