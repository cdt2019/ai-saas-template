import { formatPrice } from "@/config/pricing";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * 通知的文字：服务端只存类型和参数（src/lib/notify.ts），这里按当前语言拼出标题和正文。
 * 铃铛、弹出提示（客户端）和设置页的通知列表（服务端）共用
 */
export type NotificationItem = {
  id: string;
  type: string;
  params: Record<string, string | number | null>;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationLabels = Pick<Dictionary["notifications"], "types" | "justNow" | "minutesAgo" | "hoursAgo" | "daysAgo">;

export function renderNotification(item: Pick<NotificationItem, "type" | "params">, labels: NotificationLabels, planNames: Record<string, string>, locale: string) {
  const tpl = labels.types[item.type] ?? { title: item.type, body: "" };
  const p = item.params ?? {};
  const value = (key: string) => {
    const v = p[key];
    if (v === null || v === undefined || v === "") return "";
    if (key === "amount") return formatPrice(Number(v), String(p.currency ?? "usd"));
    if (key === "plan") return planNames[String(v)] ?? String(v);
    if (key === "date") return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(String(v)));
    if (key === "delta") return `${Number(v) > 0 ? "+" : ""}${Number(v).toLocaleString(locale)}`;
    return typeof v === "number" ? v.toLocaleString(locale) : String(v);
  };
  // 参数缺了（比如没有备注）时，去掉多出来的「 · 」
  const fill = (s: string) =>
    s
      .replace(/\{(\w+)\}/g, (_, k: string) => value(k))
      .replace(/^\s*·\s*/, "")
      .replace(/\s*·\s*$/, "")
      .trim();
  return { title: fill(tpl.title), body: fill(tpl.body) };
}

/** 「3 分钟前」：now 由调用方传（组件里不直接调 Date.now） */
export function timeAgo(iso: string, labels: NotificationLabels, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return labels.justNow;
  if (s < 3600) return labels.minutesAgo.replace("{n}", String(Math.floor(s / 60)));
  if (s < 86_400) return labels.hoursAgo.replace("{n}", String(Math.floor(s / 3600)));
  return labels.daysAgo.replace("{n}", String(Math.floor(s / 86_400)));
}

/** 按类型分组给图标用 */
export const notificationKind = (type: string) =>
  type.startsWith("admin_")
    ? "admin"
    : type.startsWith("refund_")
      ? "refund"
      : type.startsWith("subscription_") || type === "payment_succeeded"
        ? "payment"
        : type.startsWith("video_")
          ? "video"
          : "credits";
