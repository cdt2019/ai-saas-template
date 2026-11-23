import { ReceiptText } from "lucide-react";
import type { schema } from "@/db";
import type { Locale } from "@/config/site";
import { formatPrice, getPlan } from "@/config/pricing";
import { refundRules } from "@/config/refunds";
import type { Dictionary } from "@/i18n/dictionaries/en";
import type { listRefundables } from "@/lib/payments/refunds";
import { EmptyState, StatusBadge } from "@/components/ui";
import { CancelRefundButton, RefundRequestButton } from "./ClientActions";

/**
 * 账单 / 用量相关的展示组件（服务端渲染），用户中心概览和设置页共用：
 * 用量热力图、订单表（含申请退款入口）。积分记录是客户端分页组件，见 CreditHistoryFeed
 */

type Refundable = Awaited<ReturnType<typeof listRefundables>>[number];
type Order = typeof schema.order.$inferSelect;

export const fmtDate = (d: Date | null | undefined, locale: string) =>
  d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d) : "—";

/** 用量热力格的颜色深浅（0 = 当天没用） */
const LEVELS = ["bg-viz-muted", "bg-brand-1/30", "bg-brand-1/55", "bg-brand-1/80", "bg-brand-2"];

export function UsageHeatmap({ days, cols = 7, className = "" }: { days: { d: string; n: number }[]; cols?: number; className?: string }) {
  const max = Math.max(1, ...days.map((u) => u.n));
  const level = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  return (
    <div className={`grid gap-1.5 ${className}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {days.map((u) => (
        <span key={u.d} title={`${u.d} · ${u.n}`} className={`aspect-square rounded-[5px] ${LEVELS[level(u.n)]}`} />
      ))}
    </div>
  );
}

/**
 * 退款入口：已申请的显示进度，符合规则的显示「申请退款」按钮，其余不显示。
 * 金额由服务端按未用积分算好（quote），这里只负责展示
 */
export function RefundEntry({ item, t }: { item?: Refundable; t: Dictionary["account"] }) {
  if (!item) return null;
  if (item.request) {
    const pending = item.request.status === "pending";
    return (
      <div className="space-y-1">
        <p className="text-xs text-warning-fg">
          {t.refund.status[item.request.status] ?? item.request.status} · {formatPrice(item.request.amount, item.payment.currency)}
        </p>
        {/* 审核中：积分已冻结，可以撤销 */}
        {pending && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
            {t.refund.held.replace("{credits}", item.request.credits.toLocaleString())}
            <CancelRefundButton id={item.request.id} label={t.refund.cancelRequest} confirmText={t.refund.cancelConfirm} />
          </p>
        )}
      </div>
    );
  }
  if (!item.quote?.ok) return null;
  const rules = t.refund.rules
    .replace("{days}", String(refundRules.packDays))
    .replace("{percent}", String(Math.round(refundRules.maxUsedRatio * 100)));
  const summary = t.refund.summary
    .replace("{amount}", formatPrice(item.quote.amount, item.quote.currency))
    .replace("{credits}", item.quote.credits.toLocaleString());
  return <RefundRequestButton paymentId={item.payment.id} summary={summary} rules={rules} t={t.refund} />;
}

/** 订单表：积分包的退款入口挂在对应订单行上 */
export function OrdersTable({
  orders,
  refundables,
  dict,
  lang,
}: {
  orders: Order[];
  refundables: Refundable[];
  dict: Dictionary;
  lang: Locale;
}) {
  const t = dict.account;
  if (orders.length === 0) return <EmptyState icon={ReceiptText} title={t.empty} body={t.ordersEmpty} />;
  return (
    <div className="overflow-x-auto">
      <table className="tbl min-w-[600px]">
        <thead>
          <tr>
            <th>{t.date}</th>
            <th>{t.item}</th>
            <th>{t.provider}</th>
            <th className="!text-right">{t.amount}</th>
            <th className="!text-right">{t.status}</th>
            <th>{dict.settings.actions}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="whitespace-nowrap text-fg-2">{fmtDate(o.createdAt, lang)}</td>
              <td className="font-medium">{dict.pricing.plans[o.planId]?.name ?? getPlan(o.planId)?.id ?? o.planId}</td>
              <td className="text-fg-3">{o.provider}</td>
              <td className="text-right">
                <span className="font-mono tabular-nums">{formatPrice(o.amount, o.currency)}</span>
              </td>
              <td className="text-right">
                <StatusBadge status={o.status} />
              </td>
              <td>
                <RefundEntry item={refundables.find((i) => i.payment.grantRefId === `order_${o.id}`)} t={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
