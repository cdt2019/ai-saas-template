"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { usePulse } from "@/lib/pulse";

/** 账户等级（GET /api/account/tier）：侧栏账号栏、账号菜单显示用；isAdmin 决定显不显示「管理后台」入口 */
export type TierInfo = { kind: "subscription" | "pack" | "free"; planId: string | null; isAdmin?: boolean };

// 同一个用户、同一个积分余额只请求一次；余额变了（买了积分包、订阅到账）就重新查
const cache = new Map<string, Promise<TierInfo | null>>();

export function useAccountTier(): TierInfo | null {
  const { data } = useSession();
  // 应用里有心跳轮询时直接用它的结果（会随付款、退款自动更新）；营销页的页头没有，自己请求一次
  const pulse = usePulse();
  const hasPulse = pulse !== null;
  const pulseTier = pulse?.data?.tier;
  const key = data && !hasPulse ? `${data.user.id}:${data.user.credits ?? 0}` : "";
  const [tier, setTier] = useState<{ key: string; value: TierInfo | null }>({ key: "", value: null });

  useEffect(() => {
    if (!key) return;
    let alive = true;
    if (!cache.has(key)) {
      cache.set(
        key,
        fetch("/api/account/tier")
          .then((r) => (r.ok ? (r.json() as Promise<TierInfo>) : null))
          .catch(() => null),
      );
    }
    cache.get(key)!.then((value) => {
      if (alive) setTier({ key, value });
    });
    return () => {
      alive = false;
    };
  }, [key]);

  if (hasPulse) return pulseTier ?? null;
  return tier.key === key ? tier.value : null;
}

/** 等级的显示名：订阅 / 积分包显示方案名（Pro、Starter），否则 Free */
export function tierLabel(tier: TierInfo | null, labels: { planNames: Record<string, string>; free: string }) {
  if (!tier) return null;
  return tier.planId ? (labels.planNames[tier.planId] ?? tier.planId) : labels.free;
}
