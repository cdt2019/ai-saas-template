import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";
import { LOGO_PATH } from "@/components/Logo";
import en from "@/i18n/dictionaries/en";

// 默认 OG 字体不含中文字形，这里统一用英文文案，避免出现方块字
export const alt = siteConfig.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return siteConfig.locales.map((lang) => ({ lang }));
}

/** 分享图：茄紫底 + 珊瑚光晕 + 品牌标 + 首页大标题 */
export default function OpengraphImage() {
  const { hero } = en;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#1e1530",
          backgroundImage:
            "radial-gradient(circle at 85% 0%, rgba(255,122,89,0.55) 0%, rgba(232,72,138,0.25) 30%, rgba(30,21,48,0) 60%), radial-gradient(circle at 0% 100%, rgba(183,156,255,0.28) 0%, rgba(30,21,48,0) 45%)",
          color: "#f7f1fa",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(135deg, #ff7a59 0%, #e8488a 58%, #9b4bc4 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24">
              <path d={LOGO_PATH} fill="#fff" />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{siteConfig.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 84, lineHeight: 1.02, letterSpacing: -4, fontWeight: 700, maxWidth: 980 }}>{hero.title}</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#bdb0cc", maxWidth: 900 }}>{hero.badges.join("  ·  ")}</div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "2px solid rgba(255,255,255,0.12)",
            paddingTop: 24,
            fontSize: 24,
            color: "#a396b5",
            fontFamily: "monospace",
          }}
        >
          <span>{siteConfig.url.replace(/^https?:\/\//, "")}</span>
          <span style={{ color: "#ff8a6b" }}>{hero.eyebrow}</span>
        </div>
      </div>
    ),
    size,
  );
}
