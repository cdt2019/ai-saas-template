import type { MDXComponents } from "mdx/types";
import { AdSlot } from "@/components/Ads";

/** MDX 全局组件：可以在 .mdx 文章里直接写 <AdSlot slot="..." /> 或 <Callout> */
const components: MDXComponents = {
  AdSlot,
  Callout: ({ children }) => (
    <div className="rounded-2xl border border-line bg-brand-soft/60 p-5 text-fg not-italic">{children}</div>
  ),
};

export function useMDXComponents(): MDXComponents {
  return components;
}
