"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { usePulse } from "@/lib/pulse";

/** 设置页通知列表的「全部标为已读」：同时更新铃铛（心跳里的未读数）和列表 */
export function MarkAllRead({ label, disabled }: { label: string; disabled: boolean }) {
  const router = useRouter();
  const pulse = usePulse();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        if (pulse) await pulse.markRead();
        else await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        setBusy(false);
        router.refresh();
      }}
      className="btn btn-secondary btn-sm"
    >
      <CheckCheck className="size-3.5" /> {label}
    </button>
  );
}
