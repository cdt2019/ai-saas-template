import type { ReactNode } from "react";
import { Plus } from "lucide-react";

/** 区块标题：等宽小标签 + 渐变大标题 + 说明 */
export function SectionHeading({
  label,
  title,
  lead,
  align = "center",
  aside,
}: {
  label: string;
  title: string;
  lead?: string;
  align?: "center" | "left";
  aside?: ReactNode;
}) {
  const center = align === "center";
  return (
    <div className={`flex flex-col gap-3.5 ${center ? "items-center text-center" : "items-start"}`}>
      <p className="label-mono !text-brand">{label}</p>
      <h2 className="text-gradient max-w-3xl text-[clamp(2rem,4.6vw,3rem)] leading-[1.08] font-semibold tracking-[-0.045em] text-balance">
        {title}
      </h2>
      {lead && <p className={`max-w-xl text-[1.0625rem] leading-relaxed text-fg-2 ${center ? "" : ""}`}>{lead}</p>}
      {aside}
    </div>
  );
}

/** FAQ：原生 <details>，内容默认在 HTML 中，对 SEO 友好且无需 JS */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="grid gap-3">
      {items.map((item, i) => (
        <details
          key={item.q}
          className="group rounded-2xl border border-line bg-surface px-5 shadow-[0_1px_2px_rgb(var(--shadow)/0.05),inset_0_1px_0_var(--highlight)] transition open:bg-surface"
          {...(i === 0 ? { open: true } : {})}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4.5 text-[0.9875rem] font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-fg-3 transition group-open:rotate-45 group-open:border-transparent group-open:bg-brand-gradient group-open:text-white">
              <Plus className="size-3.5" />
            </span>
          </summary>
          <p className="max-w-2xl pb-5 text-[0.9375rem] leading-relaxed text-fg-2">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
