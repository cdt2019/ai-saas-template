"use client";

import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { useSession } from "@/lib/auth-client";
import { renderNotification, type NotificationItem } from "@/lib/notification-text";
import { localePath } from "@/lib/paths";
import { PulseProvider } from "@/lib/pulse";
import { NotificationIcon } from "./NotificationBell";
import { ToastProvider, useToast } from "./Toaster";

/**
 * 应用里（用户中心、工作台、设置、后台）共用的上下文：弹出提示 + 心跳轮询。
 * 来了新通知：弹提示，并让当前页面在原地重新取一次服务端数据（router.refresh，不整页刷新），
 * 用户中心的积分卡、账单里的订单这些服务端渲染的数字也跟着更新
 */
export function AppProviders({
  locale,
  labels,
  planNames,
  children,
}: {
  locale: Locale;
  labels: Dictionary["notifications"];
  planNames: Record<string, string>;
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  return (
    <ToastProvider closeLabel={labels.close}>
      <PulseWithToasts key={userId ?? "anon"} userId={userId} locale={locale} labels={labels} planNames={planNames}>
        {children}
      </PulseWithToasts>
    </ToastProvider>
  );
}

function PulseWithToasts({
  userId,
  locale,
  labels,
  planNames,
  children,
}: {
  userId: string | null;
  locale: Locale;
  labels: Dictionary["notifications"];
  planNames: Record<string, string>;
  children: ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  const onNew = useCallback(
    (items: NotificationItem[]) => {
      router.refresh();
      for (const i of items.slice(0, 3)) {
        const { title, body } = renderNotification(i, labels, planNames, locale);
        toast({
          id: i.id,
          title,
          body,
          href: i.link ? localePath(locale, i.link) : undefined,
          icon: <NotificationIcon type={i.type} />,
        });
      }
    },
    [toast, router, labels, planNames, locale],
  );
  return (
    <PulseProvider userId={userId} onNew={onNew}>
      {children}
    </PulseProvider>
  );
}
