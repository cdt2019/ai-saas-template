import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";

/** 表单里的标签 + 输入框 */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-fg-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** 仅开发环境的配置提示（虚线框），生产环境不渲染 */
export function DevNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-dashed border-line-2 bg-surface-2 px-3.5 py-3 text-xs leading-relaxed text-fg-2">
      <Info className="mt-px size-4 shrink-0 text-fg-3" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FormMessage({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${
        tone === "error"
          ? "border-danger/25 bg-danger-soft text-danger-fg"
          : "border-success/25 bg-success-soft text-success-fg"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
