/**
 * 发给错误监控之前去掉敏感内容：Cookie、Authorization、查询参数、请求体、用户资料，以及报错文字里的邮箱和疑似密钥。
 * 前后端共用（不依赖 Node），单元测试在 tests/monitoring-scrub.test.ts
 */
type Scrubbable = {
  message?: string;
  user?: unknown;
  request?: { cookies?: unknown; data?: unknown; query_string?: unknown; headers?: Record<string, string>; url?: string };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string; data?: unknown }[];
};

/** 请求头只留这几个排查用的，其余（Cookie、签名、Referer 里可能带的令牌）一律不发 */
const SAFE_HEADER = /^(user-agent|content-type|accept-language)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9+/=]+|\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]+|\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/** Sentry 默认会收集用户信息、Cookie、请求头和请求体，这里全部关掉 */
export const PRIVATE_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
};

export const scrubText = (s: string) => s.replace(SECRET, "[secret]").replace(EMAIL, "[email]");

export function scrubEvent<T>(input: T): T {
  const event = input as T & Scrubbable;
  delete event.user;
  if (event.message) event.message = scrubText(event.message);
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
    if (event.request.headers) {
      for (const k of Object.keys(event.request.headers)) if (!SAFE_HEADER.test(k)) delete event.request.headers[k];
    }
  }
  for (const v of event.exception?.values ?? []) if (v.value) v.value = scrubText(v.value);
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    delete b.data;
  }
  return event;
}
