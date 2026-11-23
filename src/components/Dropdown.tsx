"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 原生 <details> 做的下拉：不用 JS 也能展开；有 JS 时点外面、按 Esc、点里面的链接都会收起
 */
export function Dropdown({
  summary,
  children,
  label,
  className = "",
  summaryClassName = "",
  panelClassName = "",
  align = "right",
  side = "bottom",
}: {
  summary: ReactNode;
  children: ReactNode;
  label?: string;
  className?: string;
  summaryClassName?: string;
  panelClassName?: string;
  align?: "left" | "right";
  side?: "top" | "bottom";
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => el.removeAttribute("open");
    const onPointer = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) close();
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a,[data-close]")) close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <details ref={ref} className={`group relative ${className}`}>
      <summary aria-label={label} className={`cursor-pointer list-none [&::-webkit-details-marker]:hidden ${summaryClassName}`}>
        {summary}
      </summary>
      <div
        className={`popover absolute z-50 ${align === "right" ? "right-0" : "left-0"} ${
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
        } ${panelClassName}`}
      >
        {children}
      </div>
    </details>
  );
}
