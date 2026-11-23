"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react-dom";
import { ChevronDown, Search } from "lucide-react";

type Item = { slug: string; title: string };
type Group = { section: string; label: string; items: Item[] };
export type SearchItem = Item & { description: string; section: string; headings: string[]; text: string };

/** 侧栏：桌面端固定显示；手机上折叠成一个下拉 */
export function DocsSidebar({ groups, base, menuLabel }: { groups: Group[]; base: string; menuLabel: string }) {
  const pathname = usePathname();
  const links = (
    <nav className="space-y-6">
      {groups.map((g) => (
        <div key={g.section}>
          <p className="label-mono px-3">{g.label}</p>
          <ul className="mt-2 space-y-0.5">
            {g.items.map((d) => {
              const href = `${base}/${d.slug}`;
              const on = pathname === href;
              return (
                <li key={d.slug}>
                  <Link href={href} aria-current={on ? "page" : undefined} className={`block rounded-lg px-3 py-1.5 text-[0.8125rem] transition ${on ? "bg-canvas-2 font-medium text-fg" : "text-fg-2 hover:bg-canvas-2/60 hover:text-fg"}`}>
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <details key={pathname} className="group rounded-xl border border-line lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          {menuLabel} <ChevronDown className="size-4 text-fg-3 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line p-3">{links}</div>
      </details>
      <div className="hidden lg:block">{links}</div>
    </>
  );
}

/** 搜索框：/ 或 Ctrl+K 聚焦；结果浮层用 Floating UI，不被裁切、下面放不下往上弹 */
export function DocsSearch({ index, base, labels }: { index: SearchItem[]; base: string; labels: { placeholder: string; empty: string } }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const panel = useRef<HTMLUListElement | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, rects, elements }) {
          Object.assign(elements.floating.style, { maxHeight: `${Math.min(360, Math.max(140, availableHeight))}px`, width: `${Math.max(rects.reference.width, 300)}px` });
        },
      }),
    ],
  });

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return index
      .map((d) => {
        const title = d.title.toLowerCase();
        const heads = d.headings.join(" ").toLowerCase();
        const body = `${d.description} ${d.text}`.toLowerCase();
        let score = 0;
        for (const w of words) {
          const hit = (title.includes(w) ? 8 : 0) + (heads.includes(w) ? 4 : 0) + (body.includes(w) ? 1 : 0);
          if (!hit) return null;
          score += hit;
        }
        return { d, score };
      })
      .filter((r): r is { d: SearchItem; score: number } => !!r)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((r) => r.d);
  }, [q, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!input.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const go = (d?: SearchItem) => {
    if (!d) return;
    setOpen(false);
    setQ("");
    router.push(`${base}/${d.slug}`);
  };
  const show = open && !!q.trim();

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
      <input
        ref={(el) => {
          input.current = el;
          refs.setReference(el);
        }}
        type="search"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-label={labels.placeholder}
        value={q}
        placeholder={labels.placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="field field-sm pl-9"
      />
      {show &&
        createPortal(
          <ul
            ref={(el) => {
              panel.current = el;
              refs.setFloating(el);
            }}
            id={listId}
            style={floatingStyles}
            role="listbox"
            aria-label={labels.placeholder}
            className="popover z-50 overflow-auto"
          >
            {results.length === 0 ? (
              <li className="px-3 py-3 text-[0.8125rem] text-fg-3">{labels.empty}</li>
            ) : (
              results.map((d, i) => (
                <li key={d.slug} role="option" aria-selected={i === active} onPointerEnter={() => setActive(i)} onClick={() => go(d)} className={`cursor-pointer rounded-lg px-3 py-2 ${i === active ? "bg-canvas-2" : ""}`}>
                  <span className="block text-[0.8125rem] font-medium text-fg">{d.title}</span>
                  <span className="mt-0.5 line-clamp-1 block text-xs text-fg-3">{d.description}</span>
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}

/** 本页目录：滚动时高亮当前小节 */
export function DocsToc({ headings, title }: { headings: { id: string; text: string; level: number }[]; title: string }) {
  const [current, setCurrent] = useState(headings[0]?.id ?? "");
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const update = () => {
      let id = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= 120) id = el.id;
      setCurrent(id);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [headings]);
  if (headings.length === 0) return null;
  return (
    <nav aria-label={title}>
      <p className="label-mono">{title}</p>
      <ul className="mt-3 space-y-1.5 border-l border-line">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l py-0.5 text-xs leading-relaxed transition ${h.level === 3 ? "pl-6" : "pl-3"} ${current === h.id ? "border-brand font-medium text-fg" : "border-transparent text-fg-3 hover:text-fg"}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
