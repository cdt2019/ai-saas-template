import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  poweredByHeader: false,
  // PGlite 带 wasm 文件，交给 Node 直接加载，不参与打包
  serverExternalPackages: ["@electric-sql/pglite"],
};

const withMDX = createMDX({
  options: {
    // Turbopack 下插件需用字符串名
    remarkPlugins: ["remark-gfm"],
    // 给标题加 id，文档页的目录靠它跳转
    rehypePlugins: ["rehype-slug"],
  },
});

const config = withMDX(nextConfig);

// 配了 SENTRY_AUTH_TOKEN 才在构建时上传 source map（错误堆栈能看到源码）；不用 Sentry 时构建完全不受影响
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      telemetry: false,
    })
  : config;
