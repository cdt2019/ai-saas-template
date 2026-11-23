"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, CreditCard, Film, RotateCcw, ShieldAlert, Zap } from "lucide-react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { notificationKind, renderNotification, timeAgo } from "@/lib/notification-text";
import { localePath } from "@/lib/paths";
import { usePulse } from "@/lib/pulse";

type Labels = Dictionary["notifications"];

const ICONS = { payment: CreditCard, refund: RotateCcw, video: Film, admin: ShieldAlert, credits: Zap };

export function NotificationIcon({ type, className = "size-4" }: { type: string; className?: string }) {
  const Icon = ICONS[notificationKind(type)];
  return <Icon className={className} />;
}

const now = () => Date.now();

/**
 * 顶栏的铃铛：未读数角标 + 下拉最近的通知。点一条通知标为已读并跳过去；「查看全部」去设置页的通知列表。
 * 角标和下拉都是浮在上面的，不挤动顶栏
 */
export function NotificationBell({ locale, labels, planNames }: { locale: Locale; labels: Labels; planNames: Record<string, string> }) {
  const pulse = usePulse();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const unread = pulse?.data?.unread ?? 0;
  const items = (pulse?.data?.items ?? []).slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={unread ? `${labels.bell} (${unread})` : labels.bell}
        aria-expanded={open}
        onClick={() => {
          setAt(now());
          setOpen((v) => !v);
        }}
        className="icon-btn relative"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[0.625rem] leading-none font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        // 手机上铃铛不在最右边，下拉改成贴着屏幕左右两边（fixed），不会伸出屏幕
        <div className="popover fixed top-16 right-3 left-3 z-50 p-0 sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-[22rem]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
            <p className="text-[0.8125rem] font-semibold">{labels.title}</p>
            <button
              type="button"
              onClick={() => pulse?.markRead()}
              className={`text-xs text-fg-2 hover:text-fg ${unread ? "" : "invisible"}`}
              tabIndex={unread ? 0 : -1}
            >
              {labels.markAllRead}
            </button>
          </div>
          {items.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm font-medium">{labels.empty}</p>
              <p className="mt-1 text-xs text-fg-3">{labels.emptyBody}</p>
            </div>
          ) : (
            <ul className="max-h-[22rem] overflow-y-auto py-1">
              {items.map((i) => {
                const { title, body } = renderNotification(i, labels, planNames, locale);
                const row = (
                  <span className="flex gap-3 px-3.5 py-2.5">
                    <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${i.read ? "bg-canvas-2 text-fg-3" : "bg-brand-soft text-brand"}`}>
                      <NotificationIcon type={i.type} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[0.8125rem] ${i.read ? "text-fg-2" : "font-semibold"}`}>{title}</span>
                      {body && <span className="mt-0.5 block text-xs leading-relaxed [overflow-wrap:anywhere] text-fg-3">{body}</span>}
                      <span className="mt-1 block text-[0.6875rem] text-fg-3">{timeAgo(i.createdAt, labels, at)}</span>
                    </span>
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full bg-brand ${i.read ? "invisible" : ""}`} />
                  </span>
                );
                const onClick = () => {
                  if (!i.read) pulse?.markRead([i.id]);
                  setOpen(false);
                };
                return (
                  <li key={i.id} className="hover:bg-canvas-2/60">
                    {i.link ? (
                      <Link href={localePath(locale, i.link)} onClick={onClick} className="block">
                        {row}
                      </Link>
                    ) : (
                      <button type="button" onClick={onClick} className="block w-full text-left">
                        {row}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href={`${localePath(locale, "/settings")}?tab=notifications`}
            onClick={() => setOpen(false)}
            className="block border-t border-line px-3.5 py-2.5 text-center text-xs font-medium text-fg-2 hover:text-fg"
          >
            {labels.viewAll}
          </Link>
        </div>
      )}
    </div>
  );
}
