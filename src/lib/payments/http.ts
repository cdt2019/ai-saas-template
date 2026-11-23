import "server-only";

/**
 * 调支付平台的出站请求统一走这里：
 * - 超时：默认 15 秒（PAYMENT_HTTP_TIMEOUT_MS 可改），平台卡住时不会把我们的请求一起拖死
 * - 重试：只给「重放安全」的请求开（查询、带幂等键的写、重复了也无害的操作），网络错误 / 超时 / 429 / 5xx 时
 *   指数退避重试；不带幂等键、会产生新资源的写不要开
 */
export const providerTimeoutMs = () => Number(process.env.PAYMENT_HTTP_TIMEOUT_MS) || 15_000;

const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 300 * 3 ** attempt));

export async function providerFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  opts: { retries?: number; label?: string } = {},
): Promise<Response> {
  const retries = opts.retries ?? 0;
  const timeoutMs = providerTimeoutMs();
  const label = opts.label ?? "provider request";
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        console.warn(`[payments] ${label}: HTTP ${res.status}, retrying (${attempt + 1}/${retries})`);
        await backoff(attempt);
        continue;
      }
      return res;
    } catch (e) {
      const reason = (e as Error).name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : (e as Error).message;
      if (attempt >= retries) throw new Error(`${label} failed after ${attempt + 1} attempt(s): ${reason}`);
      console.warn(`[payments] ${label}: ${reason}, retrying (${attempt + 1}/${retries})`);
      await backoff(attempt);
    }
  }
}

/** 给支持自定义 fetch 的 SDK 用（Waffo）：带超时和重试 */
export const timedFetch =
  (label: string, retries: number): typeof fetch =>
  (input, init) =>
    providerFetch(input, init, { retries, label });
