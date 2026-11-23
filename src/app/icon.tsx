import { ImageResponse } from "next/og";
import { LOGO_PATH } from "@/components/Logo";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** 自动生成 favicon：品牌渐变方块 + 叶形（和页面里的 LogoMark 同一个图形） */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #ff7a59 0%, #e8488a 58%, #9b4bc4 100%)",
          borderRadius: 18,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24">
          <path d={LOGO_PATH} fill="#fff" />
        </svg>
      </div>
    ),
    size,
  );
}
