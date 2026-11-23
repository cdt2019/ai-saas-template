import { siteConfig } from "@/config/site";

/** 品牌图形：画出来的叶形，不依赖首字母，改名不会坏。OG 图和 favicon 用同一条路径 */
export const LOGO_PATH = "M5 12a7 7 0 0 1 7-7h7v7a7 7 0 0 1-7 7H5z";

/** 渐变方块 + 白色叶形 */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center bg-brand-gradient shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_6px_16px_-4px_rgb(255_106_85/0.55)] ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.29 }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
        <path d={LOGO_PATH} fill="#fff" />
      </svg>
    </span>
  );
}

/** 字标：图形 + 品牌名 */
export function Logo({ className = "", size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="text-[1.02rem] font-semibold tracking-[-0.02em]">{siteConfig.name}</span>
    </span>
  );
}
