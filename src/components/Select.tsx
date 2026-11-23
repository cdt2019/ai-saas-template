"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption<V extends string> = { value: V; label: string };

/**
 * 下拉选择：替代浏览器原生 <select>（原生的选项列表由操作系统画，改不了样式）。
 * - 宽度由 className 固定（如 w-32），选中项变了按钮不会变宽变窄，旁边的元素不会跟着动
 * - 选项列表挂在 body 上、按按钮位置浮动（Floating UI，Radix / shadcn 底层用的同一个定位库）：
 *   不会被外面 overflow:hidden 的面板裁掉；下面放不下就往上弹，贴着屏幕边就往里挪，高度不超过可用空间；滚动时跟着按钮走
 * - 键盘：↑↓ / Home / End 移动，Enter / 空格选中，Esc 关闭；点外面关闭
 * - 传 name 时带一个隐藏 input，可以直接放在 <form> 里
 */
export function Select<V extends string>({
  value,
  onChange,
  options,
  label,
  name,
  className = "w-36",
  align = "left",
}: {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  /** 无障碍名称（屏幕阅读器读的），界面上的标签由外面自己放 */
  label: string;
  name?: string;
  className?: string;
  align?: "left" | "right";
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const { refs, floatingStyles } = useFloating({
    open,
    placement: align === "right" ? "bottom-end" : "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, rects, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.min(256, Math.max(120, availableHeight))}px`,
            minWidth: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    list.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // 当前高亮的选项滚到列表的可见范围（只滚列表自己，不带着页面滚）
  useEffect(() => {
    const l = list.current;
    const el = l?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !l || !el) return;
    if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight;
  }, [open, active]);

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close();
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
    };
    if (moves[e.key]) {
      e.preventDefault();
      setActive(moves[e.key]());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={root} className={`relative shrink-0 ${className}`}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={(el) => {
          button.current = el;
          refs.setReference(el);
        }}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
        className="field field-sm flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="truncate">{options[selected]?.label}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-fg-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={(el) => {
              list.current = el;
              refs.setFloating(el);
            }}
            style={floatingStyles}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={onListKey}
            className="popover z-50 overflow-auto outline-none"
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[0.8125rem] whitespace-nowrap ${
                  i === active ? "bg-canvas-2 text-fg" : "text-fg-2"
                }`}
              >
                {o.label}
                <Check className={`size-3.5 shrink-0 text-brand ${i === selected ? "" : "invisible"}`} />
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
