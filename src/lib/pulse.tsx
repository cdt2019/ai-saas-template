"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NotificationItem } from "./notification-text";
import type { TierInfo } from "./tier-client";

/**
 * 「心跳」：轮询 /api/me/pulse，拿积分余额、账户等级、未读数和新通知，整个应用共享。
 * - 页面在前台时每 30 秒问一次；切回这个标签页、窗口重新获得焦点时立刻问；后台标签页不问
 * - 多个标签页之间用 BroadcastChannel 同步结果和已读状态
 * - 有新通知时调用 onNew（弹出提示）；第一次加载拿到的是历史通知，不弹
 * 需要立刻知道结果的地方（刚花了积分、付款回来）调用 refresh()
 */
export type PulseData = {
  credits: number;
  tier: TierInfo;
  unread: number;
  items: NotificationItem[];
  admin: { pendingRefunds: number; openIssues: number } | null;
};
type Payload = Omit<PulseData, "items"> & { items: NotificationItem[] };
type Pulse = { data: PulseData | null; refresh: () => void; markRead: (ids?: string[]) => Promise<void> };

const PulseContext = createContext<Pulse | null>(null);

/** 不在 PulseProvider 里（比如营销页的页头）时返回 null，调用方自己回退 */
export const usePulse = () => useContext(PulseContext);

const INTERVAL = 30_000;
const KEEP = 30;
const newestFirst = (a: NotificationItem, b: NotificationItem) => (a.createdAt < b.createdAt ? 1 : -1);

export function PulseProvider({
  userId,
  onNew,
  children,
}: {
  /** 换用户时外面用 key 重新挂载，这里不处理切换 */
  userId: string | null;
  onNew?: (items: NotificationItem[]) => void;
  children: ReactNode;
}) {
  const [data, setData] = useState<PulseData | null>(null);
  const latest = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const loaded = useRef(false);
  const busy = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  }, [onNew]);

  const apply = useCallback((p: Payload) => {
    const initial = !loaded.current;
    loaded.current = true;
    const fresh = p.items.filter((i) => !seen.current.has(i.id));
    for (const i of p.items) {
      seen.current.add(i.id);
      if (!latest.current || i.createdAt > latest.current) latest.current = i.createdAt;
    }
    setData((prev) => ({
      credits: p.credits,
      tier: p.tier,
      unread: p.unread,
      admin: p.admin,
      items: (initial || !prev ? [...p.items] : [...fresh, ...prev.items]).sort(newestFirst).slice(0, KEEP),
    }));
    // 只在看得见的标签页弹提示；第一次加载的是历史通知，不弹
    if (!initial && fresh.length && document.visibilityState === "visible") onNewRef.current?.(fresh.sort(newestFirst));
  }, []);

  const tick = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    try {
      const qs = latest.current ? `?after=${encodeURIComponent(latest.current)}` : "";
      const res = await fetch(`/api/me/pulse${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as Payload;
      apply(payload);
      channel.current?.postMessage({ kind: "pulse", payload });
    } catch {
      // 网络抖动：下一轮再试
    } finally {
      busy.current = false;
    }
  }, [userId, apply]);

  const markRead = useCallback(async (ids?: string[]) => {
    const pick = (i: NotificationItem) => !ids || ids.includes(i.id);
    setData((prev) =>
      prev && {
        ...prev,
        unread: ids ? Math.max(0, prev.unread - prev.items.filter((i) => !i.read && pick(i)).length) : 0,
        items: prev.items.map((i) => (pick(i) ? { ...i, read: true } : i)),
      },
    );
    const res = await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { unread?: number } | null;
    if (typeof json?.unread === "number") setData((prev) => prev && { ...prev, unread: json.unread! });
    channel.current?.postMessage({ kind: "read", ids: ids ?? null, unread: json?.unread });
  }, []);

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      if (document.visibilityState === "visible") tick();
      timer = setTimeout(loop, INTERVAL);
    };
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    const ch = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`pulse:${userId}`);
    channel.current = ch;
    ch?.addEventListener("message", (e: MessageEvent) => {
      const msg = e.data as { kind: string; payload?: Payload; ids?: string[] | null; unread?: number };
      if (msg.kind === "pulse" && msg.payload) apply(msg.payload);
      if (msg.kind === "read") {
        setData(
          (prev) =>
            prev && {
              ...prev,
              unread: typeof msg.unread === "number" ? msg.unread : prev.unread,
              items: prev.items.map((i) => (!msg.ids || msg.ids.includes(i.id) ? { ...i, read: true } : i)),
            },
        );
      }
    });
    loop();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      ch?.close();
      channel.current = null;
    };
  }, [userId, tick, apply]);

  return <PulseContext.Provider value={{ data, refresh: tick, markRead }}>{children}</PulseContext.Provider>;
}
