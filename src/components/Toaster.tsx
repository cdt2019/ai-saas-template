"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * 右下角的弹出提示：固定定位、叠在页面上，出现和消失都不挤动页面内容。
 * 最多同时显示 3 条，6 秒后自动消失（鼠标停在上面时不消失）
 */
export type Toast = { id: string; title: string; body?: string; href?: string; icon?: ReactNode };

const ToastContext = createContext<((t: Omit<Toast, "id"> & { id?: string }) => void) | null>(null);

export function useToast() {
  return useContext(ToastContext) ?? (() => {});
}

let seq = 0;

export function ToastProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id"> & { id?: string }) => {
    const id = t.id ?? `t${++seq}`;
    setToasts((all) => [...all.filter((x) => x.id !== id), { ...t, id }].slice(-3));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} closeLabel={closeLabel} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose, closeLabel }: { toast: Toast; onClose: () => void; closeLabel: string }) {
  const [hover, setHover] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (hover) return;
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
  }, [hover, onClose]);

  const content = (
    <span className="flex min-w-0 items-start gap-3">
      {toast.icon && <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">{toast.icon}</span>}
      <span className="min-w-0">
        <span className="block text-[0.8125rem] font-semibold">{toast.title}</span>
        {toast.body && <span className="mt-0.5 block text-xs leading-relaxed [overflow-wrap:anywhere] text-fg-2">{toast.body}</span>}
      </span>
    </span>
  );
  return (
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`popover pointer-events-auto relative flex items-start gap-2 p-3 pr-9 transition duration-200 ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      {toast.href ? (
        <Link href={toast.href} onClick={onClose} className="min-w-0 flex-1">
          {content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}
      <button type="button" onClick={onClose} aria-label={closeLabel} className="absolute top-2 right-2 grid size-6 place-items-center rounded-md text-fg-3 hover:bg-canvas-2 hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
