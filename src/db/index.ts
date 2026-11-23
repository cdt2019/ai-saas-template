import "server-only";
import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * 数据库连接
 * - 配置了 DATABASE_URL（postgres://...）：连接真实 Postgres（Neon / Supabase / 自建）
 * - 未配置：使用 PGlite（嵌入式 Postgres，数据存在 .data/pglite），开发零配置，并自动执行迁移
 *
 * 两种模式用同一套 schema 和 SQL 迁移，行为一致。
 */
export type DB = ReturnType<typeof drizzlePostgres<typeof schema>>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

async function createDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    warnIfDirectConnection(url);
    // 流量一冲，Vercel 会同时起很多实例，每个实例都占数据库连接，直连很快会被打满（页面报 500）。
    // 所以：运行时用连接池地址；每个实例连接数要小；空闲 20 秒就释放。
    // prepare: false 兼容 Neon / Supabase 的连接池（PgBouncer）
    const max = Number(process.env.DB_POOL_MAX) || 5;
    const client = postgres(url, { prepare: false, max, idle_timeout: 20 });
    return drizzlePostgres(client, { schema });
  }

  // 生产环境必须用真实数据库；本地 `next start` 试跑可设 ALLOW_PGLITE=true
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PGLITE !== "true") {
    throw new Error("DATABASE_URL is required in production");
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = path.join(process.cwd(), ".data/pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // PGlite 与 postgres-js 的查询 API 相同，这里统一成一个类型
  return db as unknown as DB;
}

/** 生产环境用了 Neon / Supabase 的直连地址时提醒换成连接池地址 */
function warnIfDirectConnection(url: string) {
  if (process.env.NODE_ENV !== "production") return;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const neonDirect = host.endsWith(".neon.tech") && !host.includes("-pooler.");
  const supabaseDirect = host.endsWith(".supabase.co"); // 连接池地址是 *.pooler.supabase.com
  if (neonDirect || supabaseDirect) {
    console.warn(
      `[db] DATABASE_URL 用的是直连地址（${host}），流量突增时容易把连接打满。` +
        "请换成连接池地址：Neon 用带 -pooler 的主机名，Supabase 用 pooler.supabase.com 的 6543 端口。",
    );
  }
}

/** 获取数据库实例（开发热更新时复用同一个连接） */
export function getDb(): Promise<DB> {
  if (!globalForDb.__db) {
    globalForDb.__db = createDb().catch((e) => {
      globalForDb.__db = undefined; // 初始化失败不缓存，下次请求重试
      throw e;
    });
  }
  return globalForDb.__db;
}

export { schema };
