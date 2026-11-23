import "server-only";
import { sql } from "drizzle-orm";
import journal from "../../drizzle/meta/_journal.json";
import { aiFeatures } from "@/config/ai";
import { plans } from "@/config/pricing";
import { siteConfig } from "@/config/site";
import { getDb } from "@/db";
import { adminEmails } from "./admin-emails";
import { isMockAi } from "./ai/providers";
import { isLocalDev } from "./env";
import { schedulerHealth } from "./jobs/runner";

/**
 * 系统配置检查（后台 → 系统检查）：上线前看一眼哪些没配、配错了。
 * - 只返回「有没有配」和变量名，绝不返回变量的值
 * - 只读本机环境变量和数据库，不调用支付、AI、邮件平台（不花钱、不产生数据），所以 key 本身对不对要靠真实走一遍
 * - 同一项在本机开发是提醒（有 mock 兜底），线上是错误
 */
export type CheckStatus = "ok" | "warn" | "error" | "off";
/** key：这一项的名字；msg：结果说明（文案在 dict.admin.system）；names：相关的环境变量名；detail：可以公开的值（回调地址、时间） */
export type Check = { key: string; status: CheckStatus; msg: string; names?: string[]; detail?: string };
export type CheckGroup = { id: string; checks: Check[] };

const env = (n: string) => process.env[n]?.trim() ?? "";
const missing = (...names: string[]) => names.filter((n) => !env(n));

export async function runSystemChecks() {
  const local = isLocalDev();
  const required: CheckStatus = local ? "warn" : "error";
  /** 必填的一组变量 */
  const need = (key: string, names: string[]): Check => {
    const gone = missing(...names);
    return gone.length ? { key, status: required, msg: "missing", names: gone } : { key, status: "ok", msg: "configured" };
  };
  /** 可选但要成对配置的一组变量 */
  const pair = (key: string, names: string[]): Check => {
    const gone = missing(...names);
    if (gone.length === names.length) return { key, status: "off", msg: "notConfigured", names };
    return gone.length ? { key, status: "error", msg: "partial", names: gone } : { key, status: "ok", msg: "configured" };
  };

  const groups: CheckGroup[] = [
    { id: "site", checks: siteChecks(local, required) },
    { id: "database", checks: await databaseChecks(local) },
    { id: "email", checks: emailChecks(local, required) },
    { id: "payments", checks: paymentChecks(local, required, need) },
    { id: "jobs", checks: await jobChecks(local, required) },
    { id: "ai", checks: aiChecks(local, required) },
    { id: "monitoring", checks: monitoringChecks(local) },
    {
      id: "protection",
      checks: [
        (() => {
          const c = pair("turnstile", ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);
          // 线上没有人机验证，注册送积分很容易被刷
          return c.status === "off" && !local ? { ...c, status: "warn" as const, msg: "turnstileOff" } : c;
        })(),
        pair("google", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]),
        pair("github", ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]),
      ],
    },
  ];
  const all = groups.flatMap((g) => g.checks);
  const counts = { error: 0, warn: 0, ok: 0, off: 0 };
  for (const c of all) counts[c.status]++;
  return { groups, counts };
}

/** 概览「待处理」用：配置错误的项数。调度器单独有一行，不重复算 */
export async function configErrorCount() {
  const { groups } = await runSystemChecks();
  return groups.flatMap((g) => g.checks).filter((c) => c.status === "error" && c.key !== "scheduler").length;
}

function siteChecks(local: boolean, required: CheckStatus): Check[] {
  const siteUrl = (): Check => {
    if (local) return { key: "siteUrl", status: "ok", msg: "localSite", detail: siteConfig.url };
    if (!env("NEXT_PUBLIC_SITE_URL")) return { key: "siteUrl", status: "error", msg: "missing", names: ["NEXT_PUBLIC_SITE_URL"] };
    try {
      const u = new URL(siteConfig.url);
      if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return { key: "siteUrl", status: "error", msg: "siteLocalhost", names: ["NEXT_PUBLIC_SITE_URL"], detail: siteConfig.url };
      if (u.protocol !== "https:") return { key: "siteUrl", status: "error", msg: "notHttps", names: ["NEXT_PUBLIC_SITE_URL"], detail: siteConfig.url };
    } catch {
      return { key: "siteUrl", status: "error", msg: "badUrl", names: ["NEXT_PUBLIC_SITE_URL"] };
    }
    return { key: "siteUrl", status: "ok", msg: "configured", detail: siteConfig.url };
  };
  const secret = (): Check => {
    const v = env("BETTER_AUTH_SECRET");
    if (!v) return { key: "authSecret", status: required, msg: local ? "devSecret" : "missing", names: ["BETTER_AUTH_SECRET"] };
    return v.length < 32 ? { key: "authSecret", status: "warn", msg: "shortSecret", names: ["BETTER_AUTH_SECRET"] } : { key: "authSecret", status: "ok", msg: "configured" };
  };
  const authUrl = (): Check => {
    const v = env("BETTER_AUTH_URL");
    if (!v) return { key: "authUrl", status: "ok", msg: "sameAsSite" };
    try {
      if (new URL(v).origin === new URL(siteConfig.url).origin) return { key: "authUrl", status: "ok", msg: "configured" };
    } catch {
      return { key: "authUrl", status: "error", msg: "badUrl", names: ["BETTER_AUTH_URL"] };
    }
    return { key: "authUrl", status: "error", msg: "authUrlMismatch", names: ["BETTER_AUTH_URL", "NEXT_PUBLIC_SITE_URL"] };
  };
  const admins: Check = adminEmails().length ? { key: "admins", status: "ok", msg: "configured" } : { key: "admins", status: "warn", msg: "noAdmins", names: ["ADMIN_EMAILS"] };
  return [siteUrl(), secret(), authUrl(), admins];
}

async function databaseChecks(local: boolean): Promise<Check[]> {
  const database: Check = env("DATABASE_URL")
    ? { key: "database", status: "ok", msg: "connected" }
    : local
      ? { key: "database", status: "ok", msg: "pglite" }
      : { key: "database", status: "error", msg: "pgliteProd", names: ["DATABASE_URL"] };
  const expected = journal.entries.length;
  try {
    const db = await getDb();
    // postgres-js 返回数组，PGlite 返回 { rows }
    const res = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown;
    const row = (Array.isArray(res) ? res[0] : (res as { rows: unknown[] }).rows[0]) as { n: number };
    const applied = Number(row.n);
    const migrations: Check =
      applied >= expected
        ? { key: "migrations", status: "ok", msg: "migrationsOk", detail: `${applied}/${expected}` }
        : { key: "migrations", status: "error", msg: "migrationsPending", detail: `${applied}/${expected}` };
    return [database, migrations];
  } catch {
    return [
      { key: "database", status: "error", msg: "dbFailed", names: ["DATABASE_URL"] },
      { key: "migrations", status: "error", msg: "migrationsUnknown", detail: `?/${expected}` },
    ];
  }
}

function emailChecks(local: boolean, required: CheckStatus): Check[] {
  const verify = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "false";
  const resend: Check = env("RESEND_API_KEY")
    ? { key: "resend", status: "ok", msg: "configured" }
    : local
      ? { key: "resend", status: "warn", msg: "devMail", names: ["RESEND_API_KEY"] }
      : { key: "resend", status: verify ? required : "warn", msg: verify ? "noMailVerify" : "missing", names: ["RESEND_API_KEY"] };
  const from = env("EMAIL_FROM");
  const sender: Check =
    !from || from.includes("resend.dev")
      ? { key: "sender", status: local ? "off" : "error", msg: "testSender", names: ["EMAIL_FROM"] }
      : { key: "sender", status: "ok", msg: "configured" };
  const verification: Check = verify
    ? { key: "verification", status: "ok", msg: "verifyOn" }
    : { key: "verification", status: local ? "off" : "warn", msg: "verifyOff", names: ["AUTH_REQUIRE_EMAIL_VERIFICATION"] };
  return [resend, sender, verification];
}

function paymentChecks(local: boolean, required: CheckStatus, need: (key: string, names: string[]) => Check): Check[] {
  const id = env("PAYMENT_PROVIDER") || (process.env.NODE_ENV === "production" ? "" : "mock");
  if (id === "mock") return [local ? { key: "provider", status: "warn", msg: "mockPayments", detail: "mock" } : { key: "provider", status: "error", msg: "mockProd", names: ["PAYMENT_PROVIDER"] }];
  if (!["stripe", "creem", "waffo"].includes(id)) return [{ key: "provider", status: "error", msg: id ? "badProvider" : "missing", names: ["PAYMENT_PROVIDER"] }];

  const products = (prefix: string) => need("products", plans.map((p) => `${prefix}_${p.id.toUpperCase()}`));
  /** 测试模式：线上是提醒（真实用户付不了钱），本机正常 */
  const mode = (isTest: boolean, name: string): Check =>
    isTest ? { key: "mode", status: local ? "ok" : "warn", msg: "testMode", names: [name] } : { key: "mode", status: "ok", msg: "liveMode" };
  const webhook: Check = { key: "webhookUrl", status: "ok", msg: "webhookUrl", detail: `${siteConfig.url}/api/webhooks/${id}` };
  const head: Check = { key: "provider", status: "ok", msg: "configured", detail: id };

  if (id === "stripe") {
    return [head, need("apiKey", ["STRIPE_SECRET_KEY"]), need("webhookSecret", ["STRIPE_WEBHOOK_SECRET"]), products("STRIPE_PRICE"), mode(env("STRIPE_SECRET_KEY").startsWith("sk_test_"), "STRIPE_SECRET_KEY"), webhook];
  }
  if (id === "creem") {
    return [head, need("apiKey", ["CREEM_API_KEY"]), need("webhookSecret", ["CREEM_WEBHOOK_SECRET"]), products("CREEM_PRODUCT"), mode(process.env.CREEM_TEST_MODE === "true", "CREEM_TEST_MODE"), webhook];
  }
  const key: Check =
    env("WAFFO_PRIVATE_KEY") || env("WAFFO_PRIVATE_KEY_BASE64")
      ? { key: "privateKey", status: "ok", msg: "configured" }
      : { key: "privateKey", status: required, msg: "missing", names: ["WAFFO_PRIVATE_KEY"] };
  // 没有 WAFFO_STORE_ID 就分不清回调是不是本店的：Waffo 所有商户共用一对签名密钥
  return [head, need("merchant", ["WAFFO_MERCHANT_ID"]), key, need("store", ["WAFFO_STORE_ID"]), products("WAFFO_PRODUCT"), mode(process.env.WAFFO_TEST_MODE === "true", "WAFFO_TEST_MODE"), webhook];
}

async function jobChecks(local: boolean, required: CheckStatus): Promise<Check[]> {
  const internal = process.env.CRON_MODE === "internal";
  const trigger: Check =
    internal && process.env.VERCEL
      ? { key: "cronTrigger", status: "error", msg: "internalServerless", names: ["CRON_MODE"] }
      : internal
        ? { key: "cronTrigger", status: "ok", msg: "cronInternal" }
        : env("CRON_SECRET")
          ? { key: "cronTrigger", status: "ok", msg: "cronExternal" }
          : { key: "cronTrigger", status: required, msg: "missing", names: ["CRON_SECRET"] };
  try {
    const h = await schedulerHealth();
    const at = h.lastTickAt?.toISOString().slice(0, 19).replace("T", " ");
    const scheduler: Check = !h.stale
      ? { key: "scheduler", status: "ok", msg: "schedulerOk", detail: at }
      : { key: "scheduler", status: local ? "off" : "error", msg: at ? "schedulerStale" : "schedulerNever", detail: at };
    return [trigger, scheduler];
  } catch {
    return [trigger, { key: "scheduler", status: "error", msg: "dbFailed" }];
  }
}

function monitoringChecks(local: boolean): Check[] {
  const server: Check = env("SENTRY_DSN")
    ? { key: "sentryServer", status: "ok", msg: "configured" }
    : { key: "sentryServer", status: local ? "off" : "warn", msg: "sentryOff", names: ["SENTRY_DSN"] };
  const browser: Check = env("NEXT_PUBLIC_SENTRY_DSN")
    ? { key: "sentryBrowser", status: "ok", msg: "configured" }
    : { key: "sentryBrowser", status: "off", msg: "notConfigured", names: ["NEXT_PUBLIC_SENTRY_DSN"] };
  const gone = missing("SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT");
  const maps: Check = !gone.length
    ? { key: "sentrySourcemaps", status: "ok", msg: "configured" }
    : gone.length === 3
      ? { key: "sentrySourcemaps", status: "off", msg: "notConfigured", names: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"] }
      : { key: "sentrySourcemaps", status: "error", msg: "partial", names: gone };
  return [server, browser, maps];
}

function aiChecks(local: boolean, required: CheckStatus): Check[] {
  const kinds = [...new Set(aiFeatures.map((f) => f.kind))];
  const checks = kinds.map((kind): Check => {
    const name = kind === "text" ? "AI_API_KEY" : "FAL_KEY";
    const model = aiFeatures.find((f) => f.kind === kind)?.model;
    if (isMockAi(kind)) return { key: `ai_${kind}`, status: "warn", msg: "aiMock", names: [name], detail: model };
    return env(name) ? { key: `ai_${kind}`, status: "ok", msg: "configured", detail: model } : { key: `ai_${kind}`, status: required, msg: "missing", names: [name], detail: model };
  });
  const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"];
  const gone = missing(...r2);
  const storage: Check = !gone.length
    ? { key: "storage", status: "ok", msg: "configured" }
    : gone.length === r2.length
      ? { key: "storage", status: required, msg: local ? "localStorage" : "missing", names: r2 }
      : { key: "storage", status: "error", msg: "partial", names: gone };
  return [...checks, storage];
}
