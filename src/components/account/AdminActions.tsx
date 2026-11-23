"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * 后台退款申请的操作：待审核 → 批准 / 拒绝；处理中（积分已冻结、等平台退款）→ 撤回（平台那边没退成时用）；
 * 失败（平台报错或撤回过）→ 重试批准
 * hint：批准后还要做什么（Waffo 去后台批准工单、Creem 去后台手动退款）
 */
export function RefundReview({ id, status, hint }: { id: string; status: string; hint?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState("");
  const act = async (action: "approve" | "reject" | "release") => {
    if (action !== "approve" && !confirm(action === "reject" ? "Reject this refund request?" : "Release the held credits back to the user?")) return;
    setPending(true);
    const res = await fetch("/api/admin/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    setPending(false);
    setMsg(res.ok ? "done" : [data.error, data.message].filter(Boolean).join(": ") || "error");
    if (res.ok) router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status === "pending" && (
        <>
          <button type="button" disabled={pending} onClick={() => act("approve")} className="btn btn-brand btn-sm h-7 px-2.5 text-xs">
            Approve
          </button>
          <button type="button" disabled={pending} onClick={() => act("reject")} className="btn btn-danger btn-sm h-7 px-2.5 text-xs">
            Reject
          </button>
        </>
      )}
      {status === "failed" && (
        <button type="button" disabled={pending} onClick={() => act("approve")} className="btn btn-secondary btn-sm h-7 px-2.5 text-xs">
          Retry
        </button>
      )}
      {status === "processing" && (
        <>
          {hint && <span className="text-xs text-fg-2">{hint}</span>}
          <button type="button" disabled={pending} onClick={() => act("release")} className="btn btn-secondary btn-sm h-7 px-2.5 text-xs">
            Release
          </button>
        </>
      )}
      {msg && <span className="font-mono text-xs text-fg-3">{msg}</span>}
    </div>
  );
}

/** 后台用户列表里的“调整积分”小表单 */
export function AdjustCredits({ userId }: { userId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const delta = Number(new FormData(form).get("delta"));
    const res = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, delta }),
    });
    const data = (await res.json().catch(() => ({}))) as { balance?: number; error?: string };
    setMsg(res.ok ? `= ${data.balance}` : (data.error ?? "error"));
    if (res.ok) {
      form.reset();
      router.refresh();
    }
  };
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-1.5">
      <input
        name="delta"
        type="number"
        required
        placeholder="±"
        aria-label="Credits delta"
        className="field h-7 w-20 rounded-lg px-2 font-mono text-xs"
      />
      <button type="submit" className="btn btn-secondary btn-sm h-7 px-2.5 text-xs">
        OK
      </button>
      {msg && <span className="font-mono text-xs text-fg-3">{msg}</span>}
    </form>
  );
}
