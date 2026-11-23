/**
 * 防刷规则集中配置 —— 调参数只改这里
 *
 * 为什么重要：注册送积分 + 按次付费的站，最常见的损失是被脚本批量注册“薅积分”，
 * 或者被人拿接口当免费 AI 代理。三道防线：
 *   1. Turnstile 人机验证（注册 / 登录 / 找回密码）
 *   2. 限流（按 IP 限注册、登录；按用户和 IP 限 AI 调用）
 *   3. 拦截一次性临时邮箱注册
 */
const envInt = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** 默认值适合线上；本地开发可在 .env.local 里调大（如反复跑测试时） */
export const limits = {
  /**
   * 同一 IP 每小时最多注册账号数。
   * 热点流量里大量手机用户共用运营商的出口 IP，设太低会挡住真实付费用户，所以默认放宽到 20；
   * 防薅积分主要靠 Turnstile 和临时邮箱拦截。热梗站建议同时把 SIGNUP_BONUS_CREDITS 设为 0。
   */
  signUpPerIpPerHour: envInt("LIMIT_SIGNUP_PER_IP_HOUR", 20),
  /** 同一 IP 每 10 分钟最多登录 / 找回密码尝试次数 */
  signInPerIpPer10Min: envInt("LIMIT_SIGNIN_PER_IP_10MIN", 20),
  /** 同一 IP 每 10 分钟最多发验证码 / 输验证码次数（每个验证码本身还限输错 5 次） */
  otpPerIpPer10Min: envInt("LIMIT_OTP_PER_IP_10MIN", 30),
  /** 每个用户每分钟最多 AI 调用次数 */
  aiPerUserPerMinute: envInt("LIMIT_AI_PER_USER_MIN", 10),
  /** 每个 IP 每分钟最多 AI 调用次数（防止多账号共用一个 IP 刷） */
  aiPerIpPerMinute: envInt("LIMIT_AI_PER_IP_MIN", 30),
  /** 每个用户每小时最多上传文件数 */
  uploadsPerUserPerHour: envInt("LIMIT_UPLOADS_PER_USER_HOUR", 30),
  /** 同一 IP 每小时最多提交几次 Newsletter 订阅 */
  newsletterPerIpPerHour: envInt("LIMIT_NEWSLETTER_PER_IP_HOUR", 5),
};

/** 常见一次性邮箱域名（可按需补充；也可以接入第三方黑名单服务） */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "20minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "mailinator.com",
  "maildrop.cc",
  "yopmail.com",
  "yopmail.net",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "moakt.com",
  "spamgourmet.com",
  "burnermail.io",
  "mail.tm",
  "tmpmail.org",
  "tmail.ws",
  "linshiyouxiang.net",
  "chacuo.net",
  "bccto.me",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  // 同时拦截子域名，如 abc.mailinator.com
  return [...DISPOSABLE_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`));
}
