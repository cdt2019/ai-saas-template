"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { usePulse } from "@/lib/pulse";

/**
 * 付完跳回来、订单还没确认时的横幅：每 2 秒问一次订单状态（后端顺便去支付平台查，回调丢了也能到账），
 * 到账就刷新页面数据（横幅变成「支付成功」，右上角积分、铃铛同步）。约 1 分钟还没到就停止追问，
 * 改成提示「到账时会通知你」—— 之后由心跳轮询的通知接上，不用用户手动刷新
 */
export function PaymentPending({ orderId, pending, slow }: { orderId: string; pending: string; slow: string }) {
  const router = useRouter();
  const pulse = usePulse();
  const refreshPulse = useRef(pulse?.refresh);
  useEffect(() => {
    refreshPulse.current = pulse?.refresh;
  }, [pulse?.refresh]);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let tries = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      tries++;
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { status?: string } | null;
      if (stopped) return;
      if (data?.status && data.status !== "pending") {
        refreshPulse.current?.();
        router.refresh();
        return;
      }
      if (tries >= 30) return setGaveUp(true);
      timer = setTimeout(check, 2000);
    };
    timer = setTimeout(check, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderId, router]);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current/20 bg-surface">
        <LoaderCircle className={`size-4 ${gaveUp ? "" : "animate-spin"}`} />
      </span>
      <p>{gaveUp ? slow : pending}</p>
    </div>
  );
}
