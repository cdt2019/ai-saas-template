import { defineConfig } from "drizzle-kit";

/**
 * npm run db:generate  —— 根据 schema.ts 生成迁移 SQL（drizzle/ 目录）
 * npm run db:migrate   —— 把迁移应用到数据库（上线前执行）
 *   优先用 DATABASE_URL_UNPOOLED（直连地址，跑迁移更稳），没有就用 DATABASE_URL
 * 本地未配置 DATABASE_URL 时，PGlite 会在启动时自动执行迁移，无需手动操作。
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "" },
});
