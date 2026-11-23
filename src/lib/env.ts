import "server-only";
import { siteConfig } from "@/config/site";

/**
 * 只在本机开发时才允许的「方便功能」（模拟支付、默认密钥）统一用这里判断。
 * 不能只看 NODE_ENV：线上误用 npm run dev 启动、或容器里没设 NODE_ENV 时，NODE_ENV 就不是 production，
 * 模拟支付会变成「谁都能给自己充值」的接口。所以还要求站点地址是本机地址。
 */
export function isLocalDev(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    const host = new URL(siteConfig.url).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host) || host.endsWith(".localhost") || host.endsWith(".test");
  } catch {
    return false;
  }
}

/** 会话签名、回调签名用的密钥：线上必须配置 BETTER_AUTH_SECRET，只有本机开发才用默认值 */
export function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (isLocalDev()) return "dev-secret-change-me-dev-secret-change-me";
  throw new Error("BETTER_AUTH_SECRET is required (only local development may run without it)");
}
