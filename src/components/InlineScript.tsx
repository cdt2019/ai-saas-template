"use client";

/**
 * 首次绘制前同步执行的内联脚本（见 Next 文档 preventing-flash-before-hydration）。
 * 服务端输出 text/javascript 让浏览器解析时执行；客户端渲染时改成 text/plain，避免 React 的 script 警告
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
