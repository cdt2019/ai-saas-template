#!/usr/bin/env node
/**
 * 支付与积分安全测试（本地，不需要任何支付平台账号）。每个通道跑同一套场景：
 * - 下单参数、一次性购买、全额退款、订阅两期、部分退款（多次）、超额退款、拒付（Stripe 还测拒付赢回）
 * - 当期订阅款全额退回（退款或拒付）→ Pro 立即结束；部分退款保留；只有新一期付款（或拒付赢回）能恢复
 * - 退款后余额变负 → 冻结付费功能
 * - 网页申请退款：按未用积分报价、规则（用掉过半 / 每账号一次）、批准时重算并冻结积分、按这笔付款到平台退、
 *   拒绝 / 撤回、订阅当期全额退结束 Pro；管理员用 ADMIN_EMAILS 里的第二个邮箱，靠 .data/dev-mail 里的验证邮件完成验证
 * - 试用期（标价低于正价）不发整期积分、优惠券打折照发；Stripe 100% 折扣照常发货；/pricing?code= 预填到三家收银台
 * - 支付日志：下单 → 付款 → 退款的完整时间线、冗余字段、付款汇总；问题表：出错 / 被拒的回调、漏单、退款失败
 *   （去重、自动解决、已解决不重复打开、只提醒一次），交易页、概览「待处理」
 * - 回调丢了：用户跳回时主动查单、查单接口 503 重试 / 卡住超时、定时任务补单并提醒管理员、每日对账补续费 / 退款 / 状态，
 *   丢的回调晚到不重复发放、旧的状态事件不回滚
 * - 攻击：伪造签名、改请求体；Waffo 另测别人店铺的真签名事件、生产 / 测试混用、伪造订阅积分
 * - 通用攻击：管理员邮箱抢注、改资料接口改积分 / 角色、线上关闭模拟支付、流式结果读完再断开
 *
 * 做法：脚本在本地起一个「假支付平台」（同时模拟 Waffo / Creem / Stripe 的接口），
 * 并按各平台的规则给回调签名；签名用的测试密钥写在 .env.development.local（只在 npm run dev 时生效）。
 *
 *   node scripts/payment-test.mjs setup [waffo|creem|stripe]  写 .env.development.local（之后重启 npm run dev）
 *   node scripts/payment-test.mjs run [BASE]                   跑测试，默认 http://localhost:3000
 *   node scripts/payment-test.mjs cleanup                      删除 .env.development.local（之后重启 npm run dev）
 *
 * 三个通道各 setup + 重启 + run 一次。测完一定要 cleanup：它会切换支付通道、覆盖 ADMIN_EMAILS 和 Waffo 测试公钥，
 * 不清理的话 smoke-test.sh 的模拟支付会失败，本地也收不了真实平台的测试回调。
 */
import { createHmac, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const KEY_DIR = ".data/waffo-test";
const ENV_FILE = ".env.development.local";
const MARKER = "# payment-test";
const FAKE = "http://127.0.0.1:4010";
const ADMIN_EMAIL = "admin-takeover-check@example.com";
/** 审核退款用的管理员：同样在 ADMIN_EMAILS 里，测试里完成邮箱验证（上面那个故意不验证，用来测抢注） */
const REFUND_ADMIN = "refund-admin-check@example.com";
// Waffo SDK 会校验 id 格式：前缀 + 22 位字母数字
const WAFFO = {
  store: "STO_localtest0000000000000",
  products: { starter: "PROD_localstarter0000000000", pro: "PROD_localpro00000000000000", max: "PROD_localmax00000000000000" },
};
const CREEM_SECRET = "creem_whsec_local_test";
const STRIPE_SECRET = "whsec_local_test";
const CRON_SECRET = "cron_local_test_secret";
const [mode = "run", arg = ""] = process.argv.slice(2);

/* ---------------- setup / cleanup ---------------- */

if (mode === "setup") {
  const provider = arg || "waffo";
  if (!["waffo", "creem", "stripe"].includes(provider)) throw new Error("通道只能是 waffo | creem | stripe");
  if (existsSync(ENV_FILE) && !readFileSync(ENV_FILE, "utf8").includes(MARKER)) {
    console.error(`${ENV_FILE} 已存在且不是本脚本生成的，请先手动处理`);
    process.exit(1);
  }
  mkdirSync(KEY_DIR, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(`${KEY_DIR}/private.pem`, priv);
  const esc = (pem) => pem.trim().replace(/\n/g, "\\n");
  const plans = ["starter", "pro", "max"];
  writeFileSync(
    ENV_FILE,
    [
      `${MARKER}（测试完运行 cleanup 删除）`,
      `PAYMENT_PROVIDER=${provider}`,
      `ADMIN_EMAILS=${ADMIN_EMAIL},${REFUND_ADMIN}`,
      `CRON_SECRET=${CRON_SECRET}`,
      "LIMIT_NEWSLETTER_PER_IP_HOUR=1000",
      "# 支付平台接口超时（测试卡住的接口时不用等 15 秒）",
      "PAYMENT_HTTP_TIMEOUT_MS=2000",
      "# Waffo",
      "WAFFO_MERCHANT_ID=MER_localtest0000000000000",
      `WAFFO_PRIVATE_KEY="${esc(priv)}"`,
      `WAFFO_API_BASE_URL=${FAKE}`,
      `WAFFO_STORE_ID=${WAFFO.store}`,
      ...plans.map((p) => `WAFFO_PRODUCT_${p.toUpperCase()}=${WAFFO.products[p]}`),
      `WAFFO_WEBHOOK_TEST_PUBLIC_KEY="${esc(publicKey.export({ type: "spki", format: "pem" }).toString())}"`,
      "WAFFO_TEST_MODE=true",
      "# Creem",
      "CREEM_API_KEY=creem_test_local",
      `CREEM_WEBHOOK_SECRET=${CREEM_SECRET}`,
      `CREEM_API_BASE_URL=${FAKE}`,
      ...plans.map((p) => `CREEM_PRODUCT_${p.toUpperCase()}=prod_local_${p}`),
      "# Stripe",
      "STRIPE_SECRET_KEY=sk_test_local",
      `STRIPE_WEBHOOK_SECRET=${STRIPE_SECRET}`,
      `STRIPE_API_BASE_URL=${FAKE}`,
      ...plans.map((p) => `STRIPE_PRICE_${p.toUpperCase()}=price_local_${p}`),
      "",
    ].join("\n"),
  );
  console.log(`已写入 ${ENV_FILE}（通道 ${provider}），重启 npm run dev 后运行：node scripts/payment-test.mjs run`);
  process.exit(0);
}

if (mode === "cleanup") {
  if (existsSync(ENV_FILE) && readFileSync(ENV_FILE, "utf8").includes(MARKER)) rmSync(ENV_FILE);
  console.log(`已删除 ${ENV_FILE}，重启 npm run dev 恢复正常配置`);
  process.exit(0);
}

/* ---------------- 假支付平台 ---------------- */

const BASE = arg || "http://localhost:3000";
const PROVIDER = /^PAYMENT_PROVIDER=(\w+)/m.exec(readFileSync(ENV_FILE, "utf8"))?.[1];
const captured = { waffoSessions: [], waffoTokens: [], waffoTickets: [], waffoCancels: [], creem: [], stripe: [], stripeRefunds: [], stripeSubUpdates: [] };
/** Stripe 反查用：PaymentIntent → { invoice } 或 { orderId }；账单 → PaymentIntent */
const stripeMap = new Map();
const stripeInvoices = new Map();
/** 设为 true 时，下一次退款请求（Waffo 建工单 / Stripe 退款）返回错误，模拟平台接口报错 */
let fakeFailNext = false;
const takeFail = () => {
  const f = fakeFailNext;
  fakeFailNext = false;
  return f;
};
const list = (url, data) => ({ object: "list", data, has_more: false, url });

/**
 * 「平台那边」的状态，给主动查单 / 对账的查询接口用。测试里直接改它、不发回调，模拟回调丢了。
 * hits：每个查询目标（Stripe / Creem 的收银台 id，Waffo 的我们的订单号）被查了几次；
 * hang：查询不响应（超过客户端超时）；flaky：接下来返回几次 503
 */
const fakeState = {
  stripeSessions: new Map(),
  stripeSubs: new Map(),
  stripeInvoices: new Map(),
  stripeRefunds: [],
  waffoOrders: [],
  waffoRefunds: [],
  creemCheckouts: new Map(),
  creemSubs: new Map(),
};
const hits = new Map();
const hang = new Set();
const flaky = new Map();
const nowSec = () => Math.floor(Date.now() / 1000);
const stripeSub = (id, status) => ({ id, object: "subscription", status, cancel_at_period_end: false, customer: "cus_t", items: { object: "list", data: [{ current_period_end: nowSec() + 30 * 86400 }] } });
const waffoOrderView = (o) => ({ id: o.id, status: o.status, currentPeriodEnd: o.currentPeriodEnd, payments: o.payments });

/** 查询类接口：返回 { target, respond }，target 用来计数和模拟故障 */
function queryRoute(method, url, body) {
  const p = url.pathname;
  const seg = p.split("/");
  if (method === "GET" && p.startsWith("/v1/checkout/sessions/")) {
    // 不认识的收银台（之前几轮测试留下的订单）当作已过期
    const s = fakeState.stripeSessions.get(seg[4]) ?? { id: seg[4], object: "checkout.session", status: "expired", mode: "payment", payment_status: "unpaid", metadata: {} };
    return { target: seg[4], respond: () => [200, s] };
  }
  if (method === "GET" && p.startsWith("/v1/subscriptions/")) return { target: seg[3], respond: () => [200, fakeState.stripeSubs.get(seg[3]) ?? stripeSub(seg[3], "active")] };
  if (method === "GET" && p.startsWith("/v1/invoices/")) {
    const inv = fakeState.stripeInvoices.get(seg[3]);
    return { target: seg[3], respond: () => (inv ? [200, inv] : [404, { error: { type: "invalid_request_error", message: "No such invoice" } }]) };
  }
  if (method === "GET" && p === "/v1/invoices") return { respond: () => [200, list(p, [...fakeState.stripeInvoices.values()].filter((i) => i.status === "paid"))] };
  if (method === "GET" && p === "/v1/refunds") return { respond: () => [200, list(p, fakeState.stripeRefunds)] };
  if (method === "POST" && p === "/v1/graphql") {
    const { query, variables = {} } = JSON.parse(body);
    if (variables.o) {
      const type = query.includes("subscriptionOrders") ? "subscription" : "onetime";
      return { target: variables.o, respond: () => [200, { data: { orders: fakeState.waffoOrders.filter((o) => o.type === type && o.orderMerchantExternalId === variables.o).map(waffoOrderView) } }] };
    }
    if (variables.ids) return { respond: () => [200, { data: { orders: fakeState.waffoOrders.filter((o) => variables.ids.includes(o.id)).map(waffoOrderView) } }] };
    if (query.includes("payments(")) {
      const payments = fakeState.waffoOrders.flatMap((o) =>
        o.payments.map((pm) => ({ ...pm, orderId: o.id, orderMerchantExternalId: o.orderMerchantExternalId, subscriptionOrder: o.type === "subscription" ? { id: o.id, status: o.status, currentPeriodEnd: o.currentPeriodEnd } : null })),
      );
      return { respond: () => [200, { data: { payments: variables.offset ? [] : payments } }] };
    }
    if (query.includes("refunds(")) return { respond: () => [200, { data: { refunds: variables.offset ? [] : fakeState.waffoRefunds } }] };
  }
  if (method === "GET" && p === "/v1/checkouts") {
    const c = fakeState.creemCheckouts.get(url.searchParams.get("checkout_id"));
    return { target: url.searchParams.get("checkout_id"), respond: () => (c ? [200, c] : [404, { message: "checkout not found" }]) };
  }
  if (method === "GET" && p === "/v1/subscriptions") {
    const sub = fakeState.creemSubs.get(url.searchParams.get("subscription_id"));
    return { respond: () => (sub ? [200, sub] : [404, { message: "subscription not found" }]) };
  }
  return null;
}

const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, FAKE);
    const reply = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    // 查询（主动查单、对账）
    const q = queryRoute(req.method, url, body);
    if (q) {
      if (q.target) {
        hits.set(q.target, (hits.get(q.target) ?? 0) + 1);
        if (hang.has(q.target)) return void setTimeout(() => res.destroy(), 4000);
        if ((flaky.get(q.target) ?? 0) > 0) {
          flaky.set(q.target, flaky.get(q.target) - 1);
          return reply(503, { error: { message: "fake: temporarily unavailable" }, errors: [{ message: "fake: temporarily unavailable" }] });
        }
      }
      return reply(...q.respond());
    }
    // Waffo
    if (url.pathname === "/v1/actions/checkout/create-session") {
      captured.waffoSessions.push(JSON.parse(body));
      if (JSON.parse(body).promotionCode === "BADCODE") return reply(409, { errors: [{ message: "promotion_code_not_found", layer: "discount" }] });
      return reply(200, { data: { sessionId: `cs_${id}`, checkoutUrl: `${FAKE}/waffo/cs_${id}`, expiresAt: new Date(Date.now() + 864e5).toISOString() } });
    }
    if (url.pathname === "/v1/actions/auth/issue-session-token") {
      const json = JSON.parse(body);
      captured.waffoTokens.push(json);
      const data = { token: `tok_${id}`, expiresAt: new Date(Date.now() + 9e5).toISOString() };
      if (json.purpose === "portal") data.portalUrl = `${FAKE}/portal/store/${json.storeId}`;
      return reply(200, { data });
    }
    if (url.pathname === "/v1/actions/refund-ticket/create-ticket") {
      // 商户接口：带 X-Merchant-Id / X-Signature 签名和幂等键，不是买家令牌
      captured.waffoTickets.push({
        body: JSON.parse(body),
        merchant: req.headers["x-merchant-id"],
        signed: !!req.headers["x-signature"] && !req.headers.authorization,
        idem: req.headers["x-idempotency-key"],
      });
      if (takeFail()) return reply(400, { errors: [{ message: "fake: refund rejected", layer: "refund" }] });
      return reply(200, { data: { id: `TKT_${id}`, status: "processing" } });
    }
    if (url.pathname === "/v1/actions/subscription-order/cancel-order") {
      const json = JSON.parse(body);
      captured.waffoCancels.push(json);
      return reply(200, { data: { orderId: json.orderId, status: "canceling" } });
    }
    // Creem
    if (url.pathname === "/v1/checkouts") {
      const json = JSON.parse(body);
      captured.creem.push(json);
      if (json.discount_code === "BADCODE") return reply(400, { message: "discount code not found" });
      fakeState.creemCheckouts.set(`ch_${id}`, { id: `ch_${id}`, status: "pending", request_id: json.request_id, metadata: json.metadata, order: null, subscription: null });
      return reply(200, { id: `ch_${id}`, checkout_url: `${FAKE}/creem/ch_${id}` });
    }
    // Stripe（请求体是表单编码）
    if (url.pathname === "/v1/promotion_codes") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase();
      return reply(200, list("/v1/promotion_codes", code === "SAVE10" ? [{ id: "promo_local_save10", object: "promotion_code", code, active: true }] : []));
    }
    if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
      const params = new URLSearchParams(body);
      captured.stripe.push(params);
      fakeState.stripeSessions.set(`cs_${id}`, { id: `cs_${id}`, object: "checkout.session", mode: params.get("mode"), status: "open", payment_status: "unpaid", metadata: { orderId: params.get("metadata[orderId]") }, payment_intent: null, subscription: null, invoice: null, currency: "usd" });
      return reply(200, { id: `cs_${id}`, object: "checkout.session", url: `${FAKE}/stripe/cs_${id}` });
    }
    if (url.pathname === "/v1/checkout/sessions") {
      const hit = stripeMap.get(url.searchParams.get("payment_intent"));
      return reply(200, list("/v1/checkout/sessions", hit?.orderId ? [{ id: `cs_${id}`, object: "checkout.session", metadata: { orderId: hit.orderId } }] : []));
    }
    if (url.pathname === "/v1/invoice_payments") {
      const invoice = url.searchParams.get("invoice");
      if (invoice) {
        const pi = stripeInvoices.get(invoice);
        return reply(200, list("/v1/invoice_payments", pi ? [{ id: `inpay_${id}`, object: "invoice_payment", invoice, payment: { type: "payment_intent", payment_intent: pi } }] : []));
      }
      const hit = stripeMap.get(url.searchParams.get("payment[payment_intent]"));
      return reply(200, list("/v1/invoice_payments", hit?.invoice ? [{ id: `inpay_${id}`, object: "invoice_payment", invoice: hit.invoice }] : []));
    }
    if (url.pathname === "/v1/refunds" && req.method === "POST") {
      const params = new URLSearchParams(body);
      captured.stripeRefunds.push(params);
      if (takeFail()) return reply(400, { error: { type: "invalid_request_error", message: "fake: refund rejected" } });
      return reply(200, { id: `re_${id}`, object: "refund", amount: Number(params.get("amount")), status: "succeeded" });
    }
    if (url.pathname.startsWith("/v1/subscriptions/") && req.method === "POST") {
      const subId = url.pathname.split("/").pop();
      captured.stripeSubUpdates.push({ id: subId, params: new URLSearchParams(body) });
      return reply(200, { id: subId, object: "subscription", status: "active", cancel_at_period_end: true });
    }
    reply(404, { error: { message: `fake: no route ${req.method} ${url.pathname}` } });
  });
});
await new Promise((r) => fake.listen(4010, "127.0.0.1", r));

/* ---------------- 工具函数 ---------------- */

let failed = false;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  console.log(`  ✗ ${m}`);
  failed = true;
};
const check = (ok, m) => (ok ? pass(m) : fail(m));
const run = randomUUID().slice(0, 8); // 平台侧的 id 每次运行都不同（积分流水按它们去重）
const uid = (prefix) => `${prefix}_${run}_${randomUUID().slice(0, 6)}`;
/** Waffo 的 id：前缀 + 22 位字母数字（SDK 调接口前会校验格式，比如建退款工单时的付款 id） */
const wid = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 设了就用它当回调的事件时间（模拟晚到的旧事件），null 用当前时间 */
let eventClock = null;

/** 一个带 cookie 的浏览器会话 */
function client() {
  const jar = new Map();
  const api = async (path, { method = "GET", body, signal, raw = false, headers = {} } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      signal,
      headers: { "Content-Type": "application/json", Origin: BASE, Cookie: [...jar.values()].join("; "), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(";")[0];
      jar.set(kv.slice(0, kv.indexOf("=")), kv);
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };
  // 默认要验证邮箱：注册不直接登录，用本机 .data/dev-mail 里的验证码完成验证（验证后自动登录，返回带 token 的验证结果）
  const verifyEmail = (email) => api("/api/auth/email-otp/verify-email", { method: "POST", body: { email, otp: mailCode(email) } });
  const signUp = async (email) => {
    const r = await api("/api/auth/sign-up/email", { method: "POST", body: { name: "Test", email, password: `Pw-${randomUUID()}` } });
    return r.status === 200 && !r.json?.token ? verifyEmail(email) : r;
  };
  const me = async () => (await api("/api/auth/get-session")).json?.user;
  const credits = async () => (await me())?.credits;
  // 用户中心渲染出的订阅行是「Renews: 日期」或「Ends: 日期」；只查单词会误中页面内嵌给客户端的文案数据
  const dashboard = async () => (await api("/dashboard")).text;
  // 订单列表（状态、实付金额）和申请退款入口在 设置 → 账单
  const billing = async () => (await api("/settings?tab=billing")).text;
  const pro = async () => /(Renews|Ends)<!-- -->:/.test(await dashboard());
  return { api, signUp, verifyEmail, me, credits, dashboard, billing, pro };
}

/** 本机 dev server 发给这个邮箱的最新验证码（未配置 Resend 时写在 .data/dev-mail，邮件标题以验证码开头） */
function mailCode(email) {
  try {
    return /^Subject: (\d{6}) /m.exec(readFileSync(`.data/dev-mail/${email}.txt`, "utf8"))?.[1] ?? "";
  } catch {
    return "";
  }
}

/** 下单，返回我们的订单号和发给平台的请求 */
async function checkout(user, planId, code) {
  const r = await user.api("/api/checkout", { method: "POST", body: { planId, locale: "en", ...(code ? { code } : {}) } });
  const req =
    PROVIDER === "waffo"
      ? { session: captured.waffoSessions.at(-1), token: captured.waffoTokens.at(-1) }
      : PROVIDER === "creem"
        ? captured.creem.at(-1)
        : captured.stripe.at(-1);
  const orderId =
    PROVIDER === "waffo" ? req.session?.metadata?.orderId : PROVIDER === "creem" ? req?.request_id : req?.get("metadata[orderId]");
  return { status: r.status, url: r.json?.url, req, orderId };
}

/* ---------------- 各通道的回调驱动：按平台格式造事件、按平台规则签名 ---------------- */

const waffoKey = readFileSync(`${KEY_DIR}/private.pem`, "utf8");

const drivers = {
  waffo: {
    async send(event, { tamper = false, sign = true } = {}) {
      const body = JSON.stringify(event);
      const t = Date.now();
      const v1 = createSign("RSA-SHA256").update(`${t}.${body}`).sign(waffoKey, "base64");
      const res = await fetch(`${BASE}/api/webhooks/waffo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sign ? { "X-Waffo-Signature": `t=${t},v1=${v1}` } : {}) },
        body: tamper ? body.replace("USD", "EUR") : body,
      });
      return res.status;
    },
    event(eventType, eventId, data, { mode = "test", storeId = WAFFO.store } = {}) {
      return { id: randomUUID(), timestamp: new Date(eventClock ?? Date.now()).toISOString(), eventType, eventId, storeId, storeName: "Local", mode, data: { buyerEmail: "b@example.com", currency: "USD", productName: "T", ...data } };
    },
    rejected: 401,
    /** ref：平台那边已有的这笔付款（回调晚到时带的是同一笔的 id） */
    async payOneTime(orderId, _userId, ref = { waffoOrder: wid("ORD"), payment: wid("PAY"), orderId }) {
      ref.status = await this.send(this.event("order.completed", ref.payment, { orderId: ref.waffoOrder, orderStatus: "completed", orderMetadata: { orderId }, chargedAmount: "5.00" }));
      return ref;
    },
    refundOneTime(ref, fraction) {
      return this.send(this.event("refund.succeeded", wid("REF"), { orderId: ref.waffoOrder, paymentId: ref.payment, orderMetadata: { orderId: ref.orderId }, refundedAmount: (5 * fraction).toFixed(2), originalChargedAmount: "5.00" }));
    },
    async startSubscription(orderId, _userId, sub = { waffoOrder: wid("ORD"), orderId }) {
      await this.send(this.event("subscription.activated", sub.waffoOrder, { orderId: sub.waffoOrder, orderStatus: "active", orderMetadata: { orderId }, currentPeriodEnd: "2026-11-28" }));
      return sub;
    },
    /** 不传 period 是新的一期；传入已有的 period 就是把那一期的扣款通知重推一次 */
    /** list：这一期的标价（折扣前，分；试用期是试用价）；charged：实付 */
    async payPeriod(sub, period = { payment: wid("PAY") }, { list = 1900, charged = list, noList = false } = {}) {
      const usd = (c) => (c / 100).toFixed(2);
      const listPrice = noList ? {} : { listPrice: { total: usd(charged), listTotal: usd(list), discountAmount: usd(list - charged), taxAmount: "0.00" } };
      await this.send(this.event("subscription.payment_succeeded", period.payment, { orderId: sub.waffoOrder, orderMetadata: { orderId: sub.orderId }, chargedAmount: usd(charged), ...listPrice }));
      return period;
    },
    /** fraction：这一笔退款占这期实付的比例（Waffo 每笔退款单独推送） */
    refundPeriod(sub, period, { fraction, refundId = wid("REF") }) {
      return this.send(this.event("refund.succeeded", refundId, { orderId: sub.waffoOrder, paymentId: period.payment, orderMetadata: { orderId: sub.orderId }, refundedAmount: (19 * fraction).toFixed(2), originalChargedAmount: "19.00" }));
    },
    /** 不带付款的状态通知，内容是「订阅正常」 */
    statusActive(sub) {
      return this.send(this.event("subscription.renewed", sub.waffoOrder, { orderId: sub.waffoOrder, orderStatus: "active", currentPeriodEnd: "2026-12-28" }));
    },
    statusCanceled(sub) {
      return this.send(this.event("subscription.canceled", sub.waffoOrder, { orderId: sub.waffoOrder, orderStatus: "canceled" }));
    },
    /** 网页退款申请建的工单没退成（工单号 = 我们的申请号） */
    refundFailed(ref, requestId) {
      return this.send(this.event("refund.failed", wid("REF"), { orderId: ref.waffoOrder, paymentId: ref.payment, orderMetadata: { orderId: ref.orderId }, refundTicketMerchantExternalId: requestId, refundStatus: "failed" }));
    },
    dispute: null, // Waffo 没有单独的拒付事件
  },

  creem: {
    async send(event, { tamper = false, sign = true } = {}) {
      const body = JSON.stringify(event);
      const sig = createHmac("sha256", CREEM_SECRET).update(body).digest("hex");
      const res = await fetch(`${BASE}/api/webhooks/creem`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sign ? { "creem-signature": sig } : {}) },
        body: tamper ? body.replace("refund", "refunX") : body,
      });
      return res.status;
    },
    event: (eventType, object) => ({ id: uid("evt"), eventType, created_at: eventClock ?? Date.now(), object }),
    rejected: 400,
    async payOneTime(orderId, userId, ref = { checkout: uid("ch"), tx: uid("tran"), orderId }) {
      ref.status = await this.send(this.event("checkout.completed", { id: ref.checkout, request_id: orderId, metadata: { orderId, userId, planId: "starter" }, subscription: null, order: { id: uid("ord"), transaction: ref.tx, amount: 500, amount_paid: 500, currency: "USD" }, customer: { id: "cust_t", email: "b@example.com" } }));
      return ref;
    },
    refundOneTime(ref, fraction) {
      return this.send(this.event("refund.created", { id: uid("ref"), object: "refund", status: "succeeded", refund_amount: Math.round(500 * fraction), transaction: { id: ref.tx, amount_paid: 500, subscription: null }, checkout: { id: ref.checkout, request_id: ref.orderId } }));
    },
    async startSubscription(orderId, userId, sub = { id: uid("sub"), orderId, userId }) {
      await this.send(this.event("checkout.completed", { id: uid("ch"), request_id: orderId, metadata: { orderId, userId, planId: "pro" }, subscription: { id: sub.id }, customer: { id: "cust_t" } }));
      return sub;
    },
    async payPeriod(sub, period = { tx: uid("tran") }, { list = 1900, charged = list, trialing = false, noList = false } = {}) {
      await this.send(this.event("subscription.paid", { id: sub.id, status: trialing ? "trialing" : "active", metadata: { orderId: sub.orderId, userId: sub.userId, planId: "pro" }, last_transaction_id: period.tx, last_transaction: { id: period.tx, ...(noList ? {} : { amount: list }), amount_paid: charged, currency: "USD" }, current_period_end_date: "2026-11-28T00:00:00.000Z", customer: { id: "cust_t" } }));
      return period;
    },
    refundPeriod(sub, period, { fraction }) {
      return this.send(this.event("refund.created", { id: uid("ref"), object: "refund", status: "succeeded", refund_amount: Math.round(1900 * fraction), transaction: { id: period.tx, amount_paid: 1900, subscription: sub.id } }));
    },
    statusActive(sub) {
      return this.send(this.event("subscription.active", { id: sub.id, status: "active", customer: { id: "cust_t" } }));
    },
    statusCanceled(sub) {
      return this.send(this.event("subscription.canceled", { id: sub.id, status: "canceled", customer: { id: "cust_t" } }));
    },
    dispute(sub, period) {
      return this.send(this.event("dispute.created", { id: uid("disp"), object: "dispute", amount: 1900, transaction: { id: period.tx, amount_paid: 1900, subscription: sub.id } }));
    },
  },

  stripe: {
    async send(event, { tamper = false, sign = true } = {}) {
      const body = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const v1 = createHmac("sha256", STRIPE_SECRET).update(`${t}.${body}`).digest("hex");
      const res = await fetch(`${BASE}/api/webhooks/stripe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sign ? { "Stripe-Signature": `t=${t},v1=${v1}` } : {}) },
        body: tamper ? body.replace("charge", "chargX") : body,
      });
      return res.status;
    },
    event: (type, object) => ({ id: uid("evt"), object: "event", type, created: Math.floor((eventClock ?? Date.now()) / 1000), livemode: false, data: { object } }),
    rejected: 400,
    async payOneTime(orderId, userId, ref = { pi: uid("pi"), charge: uid("ch"), orderId }) {
      stripeMap.set(ref.pi, { orderId });
      ref.status = await this.send(this.event("checkout.session.completed", { id: uid("cs"), object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: ref.pi, metadata: { orderId, userId, planId: "starter" }, subscription: null, customer: "cus_t" }));
      return ref;
    },
    /** 100% 折扣码：Stripe 不收钱，payment_status 是 no_payment_required、没有 PaymentIntent */
    payOneTimeFree(orderId, userId) {
      return this.send(this.event("checkout.session.completed", { id: uid("cs"), object: "checkout.session", mode: "payment", payment_status: "no_payment_required", amount_total: 0, currency: "usd", payment_intent: null, metadata: { orderId, userId, planId: "starter" }, subscription: null, customer: "cus_t" }));
    },
    refundOneTime(ref, fraction) {
      return this.send(this.event("charge.refunded", { id: ref.charge, object: "charge", amount: 500, amount_refunded: Math.round(500 * fraction), payment_intent: ref.pi }));
    },
    async startSubscription(orderId, userId, sub = { id: uid("sub"), orderId, userId }) {
      await this.send(this.event("checkout.session.completed", { id: uid("cs"), object: "checkout.session", mode: "subscription", payment_status: "paid", metadata: { orderId, userId, planId: "pro" }, subscription: sub.id, customer: "cus_t" }));
      return sub;
    },
    async payPeriod(sub, period = { invoice: uid("in"), pi: uid("pi"), charge: uid("ch") }, { list = 1900, charged = list, noList = false } = {}) {
      stripeMap.set(period.pi, { invoice: period.invoice });
      stripeInvoices.set(period.invoice, period.pi);
      await this.send(this.event("invoice.paid", { id: period.invoice, object: "invoice", customer: "cus_t", ...(noList ? {} : { subtotal: list }), amount_paid: charged, currency: "usd", parent: { subscription_details: { subscription: sub.id, metadata: { orderId: sub.orderId, userId: sub.userId, planId: "pro" } } }, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 2592000 } }] } }));
      return period;
    },
    /** Stripe 的 amount_refunded 是累计值：cumulative 是累计已退比例 */
    refundPeriod(sub, period, { cumulative }) {
      return this.send(this.event("charge.refunded", { id: period.charge, object: "charge", amount: 1900, amount_refunded: Math.round(1900 * cumulative), payment_intent: period.pi }));
    },
    statusActive(sub) {
      return this.send(this.event("customer.subscription.updated", { id: sub.id, object: "subscription", status: "active", cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 2592000 }] } }));
    },
    statusCanceled(sub) {
      return this.send(this.event("customer.subscription.deleted", { id: sub.id, object: "subscription", status: "canceled", cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] } }));
    },
    dispute(sub, period) {
      period.dispute = uid("dp");
      return this.send(this.event("charge.dispute.created", { id: period.dispute, object: "dispute", amount: 1900, charge: period.charge, payment_intent: period.pi, status: "needs_response" }));
    },
    disputeWon(period) {
      return this.send(this.event("charge.dispute.closed", { id: period.dispute, object: "dispute", amount: 1900, charge: period.charge, payment_intent: period.pi, status: "won" }));
    },
  },
};

/* ---------------- 平台那边直接变化、不发回调（模拟回调丢了） ---------------- */

const usd = (c) => (c / 100).toFixed(2);
const platform = {
  stripe: {
    target: (k) => k.url.split("/").pop(),
    session(k) {
      return fakeState.stripeSessions.get(this.target(k));
    },
    payOneTime(k) {
      const ref = { pi: uid("pi"), charge: uid("ch"), orderId: k.orderId };
      stripeMap.set(ref.pi, { orderId: k.orderId });
      Object.assign(this.session(k), { status: "complete", payment_status: "paid", payment_intent: ref.pi, amount_total: 500, amount_subtotal: 500 });
      return ref;
    },
    startSubscription(k, userId) {
      const sub = { id: uid("sub"), orderId: k.orderId, userId };
      fakeState.stripeSubs.set(sub.id, stripeSub(sub.id, "active"));
      const period = this.renew(sub);
      Object.assign(this.session(k), { status: "complete", payment_status: "paid", subscription: sub.id, invoice: period.invoice });
      return { sub, period };
    },
    renew(sub) {
      const period = { invoice: uid("in"), pi: uid("pi"), charge: uid("ch") };
      stripeMap.set(period.pi, { invoice: period.invoice });
      stripeInvoices.set(period.invoice, period.pi);
      fakeState.stripeInvoices.set(period.invoice, {
        id: period.invoice, object: "invoice", status: "paid", customer: "cus_t", subtotal: 1900, amount_paid: 1900, currency: "usd", created: nowSec(),
        parent: { subscription_details: { subscription: sub.id, metadata: { orderId: sub.orderId, userId: sub.userId, planId: "pro" } } },
        lines: { object: "list", data: [{ period: { end: nowSec() + 30 * 86400 } }] },
      });
      return period;
    },
    refund(sub, period, fraction) {
      fakeState.stripeRefunds.push({ id: uid("re"), object: "refund", status: "succeeded", created: nowSec(), amount: Math.round(1900 * fraction), charge: { id: period.charge, object: "charge", amount: 1900, amount_refunded: Math.round(1900 * fraction), payment_intent: period.pi } });
    },
    setStatus(sub, status) {
      fakeState.stripeSubs.get(sub.id).status = status;
    },
    expire(k) {
      this.session(k).status = "expired";
    },
  },
  waffo: {
    target: (k) => k.orderId,
    order(k, type) {
      let o = fakeState.waffoOrders.find((x) => x.orderMerchantExternalId === k.orderId);
      if (!o) fakeState.waffoOrders.push((o = { type, id: wid("ORD"), status: "pending", orderMerchantExternalId: k.orderId, currentPeriodEnd: null, payments: [] }));
      return o;
    },
    payment(o, amount) {
      const pm = { id: wid("PAY"), status: "succeeded", periodNumber: o.type === "subscription" ? o.payments.length + 1 : null, createdAt: new Date().toISOString(), amount: { amount: String(amount), currency: "USD" }, snapshotAmountDetails: { listTotal: usd(amount) } };
      o.payments.push(pm);
      return pm;
    },
    payOneTime(k) {
      const o = this.order(k, "onetime");
      o.status = "completed";
      return { waffoOrder: o.id, payment: this.payment(o, 500).id, orderId: k.orderId };
    },
    startSubscription(k) {
      const o = this.order(k, "subscription");
      Object.assign(o, { status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 864e5).toISOString() });
      return { sub: { waffoOrder: o.id, orderId: k.orderId }, period: { payment: this.payment(o, 1900).id } };
    },
    renew(sub) {
      return { payment: this.payment(fakeState.waffoOrders.find((o) => o.id === sub.waffoOrder), 1900).id };
    },
    refund(sub, period, fraction) {
      const id = wid("REF");
      fakeState.waffoRefunds.push({ id, paymentId: period.payment, orderMerchantExternalId: sub.orderId, status: "succeeded", createdAt: new Date().toISOString(), amount: { amount: String(Math.round(1900 * fraction)), currency: "USD" }, payment: { amount: { amount: "1900" } } });
      // 平台上这笔付款的累计已退金额（对账拿它对付款汇总，不能和退款单的扣回算两次）
      const pm = fakeState.waffoOrders.flatMap((o) => o.payments).find((x) => x.id === period.payment);
      pm.refundedAmount = { amount: String(Number(pm.refundedAmount?.amount ?? 0) + Math.round(1900 * fraction)) };
      return id;
    },
    setStatus(sub, status) {
      fakeState.waffoOrders.find((o) => o.id === sub.waffoOrder).status = status;
    },
    expire(k) {
      this.order(k, "onetime").status = "canceled";
    },
  },
  creem: {
    target: (k) => k.url.split("/").pop(),
    payOneTime(k) {
      const ref = { checkout: this.target(k), tx: uid("tran"), orderId: k.orderId };
      Object.assign(fakeState.creemCheckouts.get(ref.checkout), { status: "completed", order: { id: uid("ord"), transaction: ref.tx, amount: 500, amount_paid: 500, currency: "USD" } });
      return ref;
    },
    startSubscription(k, userId) {
      const sub = { id: uid("sub"), orderId: k.orderId, userId };
      const remote = { id: sub.id, status: "active", current_period_end_date: new Date(Date.now() + 30 * 864e5).toISOString(), customer: { id: "cust_t" } };
      fakeState.creemSubs.set(sub.id, remote);
      const period = { tx: uid("tran") };
      Object.assign(fakeState.creemCheckouts.get(this.target(k)), { status: "completed", subscription: remote, order: { id: uid("ord"), transaction: period.tx, amount: 1900, amount_paid: 1900, currency: "USD" } });
      return { sub, period };
    },
    renew: null, // Creem 没有按时间拉付款 / 退款的接口，对账只核对订阅状态
    refund: null,
    setStatus(sub, status) {
      fakeState.creemSubs.get(sub.id).status = status;
    },
    expire(k) {
      fakeState.creemCheckouts.get(this.target(k)).status = "expired";
    },
  },
};

/* ---------------- 场景 ---------------- */

const d = drivers[PROVIDER];
if (!d) throw new Error(`${ENV_FILE} 里的 PAYMENT_PROVIDER 不是 waffo | creem | stripe，先运行 setup`);
console.log(`支付通道：${PROVIDER}`);

try {
  const user = client();
  const email = `pay+${Date.now()}@example.com`;
  console.log("1. 准备测试用户");
  check(!!(await user.signUp(email)).json?.token, "注册");
  const me = await user.me();
  let bal = me.credits;

  console.log("2. 下单参数");
  const c1 = await checkout(user, "starter");
  check(c1.status === 200 && !!c1.url, "返回收银台地址");
  check(c1.orderId?.startsWith("ord_"), "请求里带我们的订单号");
  if (PROVIDER === "waffo") {
    check(c1.req.session?.productId === WAFFO.products.starter && c1.req.session?.metadata?.userId === me.id, "Waffo：产品 ID 和 metadata 正确");
    check(c1.req.token?.buyerIdentity === me.id && c1.url.includes("#token="), "Waffo：买家身份是我们的用户 id");
  } else if (PROVIDER === "creem") {
    check(c1.req.product_id === "prod_local_starter" && c1.req.metadata?.userId === me.id, "Creem：产品 ID 和 metadata 正确");
  } else {
    check(c1.req.get("mode") === "payment" && c1.req.get("line_items[0][price]") === "price_local_starter", "Stripe：一次性付款、价格 ID 正确");
    check(c1.req.get("payment_intent_data[metadata][orderId]") === c1.orderId, "Stripe：PaymentIntent 上带订单号（退款时用来找回订单）");
  }

  console.log("3. 一次性购买 → 全额退款");
  const pay1 = await d.payOneTime(c1.orderId, me.id);
  check(pay1.status === 200 && (await user.credits()) === bal + 100, "付款成功：积分 +100");
  check((await d.refundOneTime(pay1, 1)) === 200 && (await user.credits()) === bal, "全额退款：积分 -100");
  await d.refundOneTime(pay1, 1);
  check((await user.credits()) === bal, "同一笔退款再推一次（新事件 id）：不会多扣");
  check((await user.billing()).includes(">refunded<"), "订单状态变成 refunded");

  console.log("4. 订阅两期 → 部分退款 → 拒付");
  const c2 = await checkout(user, "pro");
  if (PROVIDER === "stripe") check(c2.req.get("subscription_data[metadata][planId]") === "pro", "Stripe：订阅账单上带方案");
  const sub = await d.startSubscription(c2.orderId, me.id);
  const p1 = await d.payPeriod(sub);
  const p2 = await d.payPeriod(sub);
  check((await user.credits()) === bal + 2000 && (await user.pro()), "两期扣款：积分 +2000，Pro 生效");
  bal += 2000;
  await d.refundPeriod(sub, p1, { fraction: 0.5, cumulative: 0.5 });
  check((await user.credits()) === bal - 500, "第一期退一半：扣回 500");
  await d.refundPeriod(sub, p1, { fraction: 0.5, cumulative: 1 });
  check((await user.credits()) === bal - 1000, "第一期再退剩下一半：再扣 500");
  await d.refundPeriod(sub, p1, { fraction: 0.5, cumulative: 1 });
  check((await user.credits()) === bal - 1000, "第一期已全部扣回，再来退款也不会多扣");
  check(await user.pro(), "退满的是上一期：当期 Pro 不受影响");
  bal -= 1000;
  if (d.dispute) {
    await d.dispute(sub, p2);
    check((await user.credits()) === bal - 1000 && !(await user.pro()), "当期（第二期）拒付：扣回 1000，Pro 立即结束");
    if (d.disputeWon) {
      await d.disputeWon(p2);
      check((await user.credits()) === bal && (await user.pro()), "拒付赢回：积分还回 1000，Pro 恢复");
      await d.disputeWon(p2);
      check((await user.credits()) === bal, "赢回通知重推：不会重复还");
    } else bal -= 1000;
  } else console.log("  - Waffo 没有单独的拒付事件，跳过");

  console.log("5. 当期退款 → 部分保留 Pro，退满立即结束，只有新一期付款能恢复");
  const p3 = await d.payPeriod(sub);
  check((await user.credits()) === bal + 1000 && (await user.pro()), "新一期扣款：积分 +1000，Pro 生效");
  await d.refundPeriod(sub, p3, { fraction: 0.5, cumulative: 0.5 });
  check((await user.credits()) === bal + 500 && (await user.pro()), "当期退一半：扣回 500，Pro 保留");
  await d.refundPeriod(sub, p3, { fraction: 0.5, cumulative: 1 });
  check((await user.credits()) === bal && !(await user.pro()), "当期退满：再扣 500，Pro 立即结束");
  await d.statusActive(sub);
  check(!(await user.pro()), "之后平台发来「订阅正常」的状态通知：Pro 仍然结束");
  await d.payPeriod(sub, p3);
  check((await user.credits()) === bal && !(await user.pro()), "被退那一期的扣款通知重推：不加积分，也不恢复 Pro");
  await d.payPeriod(sub);
  check((await user.credits()) === bal + 1000 && (await user.pro()), "下一期付款成功：积分 +1000，Pro 恢复");
  bal += 1000;

  console.log("6. 退款后余额变负 → 冻结");
  const u2 = client();
  await u2.signUp(`pay2+${Date.now()}@example.com`);
  const c3 = await checkout(u2, "starter");
  const pay3 = await d.payOneTime(c3.orderId, (await u2.me()).id);
  const up = (await u2.api("/api/upload", { method: "POST", body: { contentType: "image/png", size: 8 } })).json;
  await u2.api(up.uploadUrl, { method: "PUT", body: "\x89PNG\r\n\x1a\n", headers: { "Content-Type": "image/png" } });
  for (let i = 0; i < 2; i++) await u2.api("/api/ai/video", { method: "POST", body: { feature: "video", input: "wave", imageUrl: up.publicUrl } });
  check((await u2.credits()) === 10, "充值 100 后用掉 100（两条视频），剩 10");
  await d.refundOneTime(pay3, 1);
  check((await u2.credits()) === -90, "全额退款：照扣 100，余额变成 -90");
  check((await u2.api("/api/credits/spend", { method: "POST" })).status === 402, "余额为负时用不了付费功能");

  console.log("7. 网页申请退款：系统按未用积分报价，管理员批准后按这笔付款去平台退");
  const admin = client();
  const adminPw = "Refund-admin-test-pw-123"; // 本地数据库保留上一轮的账号：已存在就登录
  const areg = await admin.api("/api/auth/sign-up/email", { method: "POST", body: { name: "Refund admin", email: REFUND_ADMIN, password: adminPw } });
  if (!areg.json?.token) {
    const si = await admin.api("/api/auth/sign-in/email", { method: "POST", body: { email: REFUND_ADMIN, password: adminPw } });
    // 邮箱还没验证：登录时服务端已自动发了新验证码
    if (si.json?.code === "EMAIL_NOT_VERIFIED") await admin.verifyEmail(REFUND_ADMIN);
  }
  if (!(await admin.me())?.emailVerified) {
    // 不要求验证邮箱时（AUTH_REQUIRE_EMAIL_VERIFICATION=false）：主动发一次验证码，走真实的验证
    await admin.api("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email: REFUND_ADMIN, type: "email-verification" } });
    await admin.verifyEmail(REFUND_ADMIN);
  }
  check((await admin.api("/admin")).status === 200, "ADMIN_EMAILS 里的邮箱验证后能进后台");
  const review = (id, action) => admin.api("/api/admin/refunds", { method: "POST", body: { id, action } });
  const runChecks = () => admin.api("/api/admin/jobs", { method: "POST", body: { name: "ledger.check", action: "run" } });
  const issuesOf = async (query) => (await admin.api(`/api/admin/issues?size=100&${query}`)).json?.rows ?? [];
  const issueAction = (id, action) => admin.api("/api/admin/issues", { method: "POST", body: { id, action } });
  const refundables = async (u) => (await u.api("/api/refunds")).json?.items ?? [];
  const spend = async (u, n) => {
    for (let i = 0; i < n; i++) await u.api("/api/credits/spend", { method: "POST" });
  };
  const newUser = async (tag) => {
    const u = client();
    await u.signUp(`${tag}+${Date.now()}@example.com`);
    return { u, id: (await u.me()).id };
  };

  // 积分包：用了一部分 → 报价 → 申请（提交即冻结可退的积分）→ 冻结的不能再用 → 批准按申请时的金额 → 平台退款到账
  const { u: r1, id: r1Id } = await newUser("refund1");
  const pay5 = await d.payOneTime((await checkout(r1, "starter")).orderId, r1Id);
  await spend(r1, 20);
  let [it1] = await refundables(r1);
  check(it1?.quote?.ok && it1.quote.amount === 400 && it1.quote.credits === 80, "报价：100 积分用了 20 → 退 $4.00、扣 80 积分（按未用积分，不按时间）");
  check((await r1.billing()).includes(">Request a refund<"), "账单页显示申请退款入口");
  const q1 = await r1.api("/api/refunds", { method: "POST", body: { paymentId: it1?.paymentId, reason: "Not what I expected", amount: 500 } });
  check(q1.status === 200 && q1.json?.amount === 400, "提交申请：请求里塞的金额被忽略，按系统算的 $4.00");
  check((await r1.credits()) === 10, "提交申请即冻结 80 积分：余额 110 − 20 − 80 = 10");
  check((await r1.api("/api/refunds", { method: "POST", body: { paymentId: it1?.paymentId, reason: "again" } })).status === 409, "同一笔付款不能重复申请");
  check((await r1.api("/api/admin/refunds", { method: "POST", body: { id: q1.json?.id, action: "approve" } })).status === 403, "普通用户不能批准退款");
  const { u: r2 } = await newUser("refund2");
  check((await r2.api("/api/refunds", { method: "POST", body: { paymentId: it1?.paymentId, reason: "not mine" } })).status === 404, "不能拿别人的付款申请退款");
  await spend(r1, 10);
  check(
    (await r1.credits()) === 0 && (await r1.api("/api/credits/spend", { method: "POST" })).status === 402,
    "冻结的积分不能再用：剩下的 10 用完后再用返回 402",
  );
  const a1 = await review(q1.json?.id, "approve");
  check(a1.status === 200 && a1.json?.amount === 400 && (await r1.credits()) === 0, "批准按申请时定下的金额：退 $4.00，不重算、不重复冻结");
  check((await review(q1.json?.id, "approve")).status === 409, "重复点批准：不会退两次");
  if (PROVIDER === "waffo") {
    const tk = captured.waffoTickets.at(-1);
    check(
      tk?.body.paymentId === pay5.payment &&
        tk.body.requestedAmount?.amount === "4.00" &&
        tk.merchant === "MER_localtest0000000000000" &&
        tk.signed &&
        tk.idem === `refund_${q1.json?.id}`,
      "Waffo：用商户签名的接口建退款工单，绑定这笔付款、金额 4.00，幂等键是申请号",
    );
  } else if (PROVIDER === "stripe") {
    const rf = captured.stripeRefunds.at(-1);
    check(rf?.get("payment_intent") === pay5.pi && rf.get("amount") === "400", "Stripe：按这笔 PaymentIntent 退 400 分");
  } else check(a1.json?.providerRefundId == null, "Creem：没有退款接口，等管理员到 Creem 后台按显示的金额退");
  [it1] = await refundables(r1);
  check(it1?.request?.status === "processing", "申请变成处理中（积分已冻结，等平台退款到账）");
  await d.refundOneTime(pay5, 0.8);
  [it1] = await refundables(r1);
  check(it1?.request?.status === "refunded" && (await r1.credits()) === 0, "平台退款 $4.00 到账：冻结的积分算作扣回，不重复扣，申请变成已退款");
  {
    // 站内通知：付款成功 → 申请退款 → 批准 → 退款到账，每一步都有一条（回调重推不重复）
    const types = ((await r1.api("/api/me/pulse")).json?.items ?? []).map((i) => i.type);
    const want = ["payment_succeeded", "refund_requested", "refund_approved", "refund_completed"];
    check(want.every((t) => types.includes(t)) && types.filter((t) => t === "refund_completed").length === 1, `退款流程的站内通知齐全：${want.join(" → ")}`);
    const adminTypes = ((await admin.api("/api/me/pulse")).json?.items ?? []).map((i) => i.type);
    check(adminTypes.includes("admin_refund_request"), "管理员收到「新的退款申请」通知");
  }
  await d.payOneTime((await checkout(r1, "starter")).orderId, r1Id);
  check((await refundables(r1)).find((i) => !i.request)?.quote?.reason === "limit", "每个账号只能自助退款 1 次");

  // 拒绝；另一笔批准后平台没退成 → 撤回冻结
  const { u: r3, id: r3Id } = await newUser("refund3");
  await d.payOneTime((await checkout(r3, "starter")).orderId, r3Id);
  const [it3] = await refundables(r3);
  const q3 = await r3.api("/api/refunds", { method: "POST", body: { paymentId: it3?.paymentId, reason: "changed my mind" } });
  check((await r3.credits()) === 10, "提交申请即冻结 100 积分");
  check((await review(q3.json?.id, "reject")).status === 200 && (await r3.credits()) === 110, "拒绝申请：冻结的积分还回去");
  check((await r3.api("/api/refunds", { method: "POST", body: { paymentId: it3?.paymentId, reason: "again" } })).status === 409, "被拒的付款不能再自助申请（找客服）");
  const pay7 = await d.payOneTime((await checkout(r3, "starter")).orderId, r3Id);
  const it7 = (await refundables(r3)).find((i) => i.paymentId !== it3?.paymentId);
  const q7 = await r3.api("/api/refunds", { method: "POST", body: { paymentId: it7?.paymentId, reason: "bought twice" } });
  check(q7.status === 200 && q7.json?.amount === 500, "被拒的不占自助退款次数：另一笔还能申请（没用过 → 全额 $5.00）");
  await review(q7.json?.id, "approve");
  check((await r3.credits()) === 110, "批准：提交时冻结的 100 积分继续冻结，不重复扣");
  if (PROVIDER === "waffo") await d.refundFailed(pay7, q7.json?.id);
  else await review(q7.json?.id, "release");
  const st7 = (await refundables(r3)).find((i) => i.paymentId === it7?.paymentId);
  check(
    st7?.request?.status === "failed" && (await r3.credits()) === 210,
    PROVIDER === "waffo" ? "Waffo 回调退款失败：自动撤回，冻结的 100 积分还回去" : "平台那边没退成：管理员撤回，冻结的 100 积分还回去",
  );
  check((await review(q7.json?.id, "approve")).status === 200 && (await r3.credits()) === 110, "失败的申请可以重试批准：重新冻结 100 积分");
  await d.refundOneTime(pay7, 1);
  const rt7 = (await refundables(r3)).find((i) => i.paymentId === it7?.paymentId);
  check(rt7?.request?.status === "refunded" && (await r3.credits()) === 110, "重试后平台退款到账：结单，不重复扣");

  if (PROVIDER !== "creem") {
    // 平台接口报错 → 批准失败、积分还回去；但平台那边其实受理了（或管理员手动退了），退款回调照样能结单
    const { u: r6, id: r6Id } = await newUser("refund6");
    const pay8 = await d.payOneTime((await checkout(r6, "starter")).orderId, r6Id);
    const [it8] = await refundables(r6);
    const q8 = await r6.api("/api/refunds", { method: "POST", body: { paymentId: it8?.paymentId, reason: "provider error case" } });
    fakeFailNext = true;
    const a8 = await review(q8.json?.id, "approve");
    check(a8.status === 502 && (await r6.credits()) === 110 && (await refundables(r6))[0]?.request?.status === "failed", "平台接口报错：批准失败，冻结的积分还回去");
    await runChecks();
    const failedIssue = (await issuesOf("status=open&kind=refund_failed")).find((i) => i.entityId === q8.json?.id);
    check(failedIssue?.severity === "error" && /fake: refund rejected/.test(String(failedIssue?.detail?.message ?? "")), "退款失败进问题表（错误），带着平台的报错");
    await d.refundOneTime(pay8, 1);
    check((await refundables(r6))[0]?.request?.status === "refunded" && (await r6.credits()) === 10, "之后平台的退款还是到了：申请结为已退款，积分照常扣回");
    await runChecks();
    const fixedIssue = (await issuesOf("kind=refund_failed&status=resolved")).find((i) => i.entityId === q8.json?.id);
    check(fixedIssue?.resolvedBy === "system", "退款结单后再检查：这个问题自动标为已解决");

    // 批准失败、积分解冻后用户又用掉了：重试按现在的未用积分重算，余额不会变负
    const { u: r9, id: r9Id } = await newUser("refund9");
    await d.payOneTime((await checkout(r9, "starter")).orderId, r9Id);
    const [it9] = await refundables(r9);
    const q9 = await r9.api("/api/refunds", { method: "POST", body: { paymentId: it9?.paymentId, reason: "retry after spending" } });
    fakeFailNext = true;
    await review(q9.json?.id, "approve");
    for (let i = 0; i < 30; i++) await r9.api("/api/credits/spend", { method: "POST" });
    const a9 = await review(q9.json?.id, "approve");
    check(a9.status === 200 && a9.json?.amount === 350 && a9.json?.credits === 70 && (await r9.credits()) === 10, "重试前用掉 30 积分：只退剩下 70 积分对应的钱，余额不变负");

    const { u: r10, id: r10Id } = await newUser("refund10");
    await d.payOneTime((await checkout(r10, "starter")).orderId, r10Id);
    const [it10] = await refundables(r10);
    const q10 = await r10.api("/api/refunds", { method: "POST", body: { paymentId: it10?.paymentId, reason: "retry after spending all" } });
    fakeFailNext = true;
    await review(q10.json?.id, "approve");
    for (let i = 0; i < 110; i++) await r10.api("/api/credits/spend", { method: "POST" });
    const a10 = await review(q10.json?.id, "approve");
    check(a10.status === 409 && a10.json?.error === "nothing_left" && (await r10.credits()) === 0 && (await refundables(r10))[0]?.request?.status === "failed", "重试前积分全用完：不退款，余额保持 0");
  }

  // 撤销：审核中的申请可以撤销，冻结的积分立即退回，之后这笔付款还能重新申请
  const { u: rc, id: rcId } = await newUser("refundc");
  await d.payOneTime((await checkout(rc, "starter")).orderId, rcId);
  const [itc] = await refundables(rc);
  const qc = await rc.api("/api/refunds", { method: "POST", body: { paymentId: itc?.paymentId, reason: "changed my mind" } });
  check(qc.status === 200 && (await rc.credits()) === 10, "撤销测试：提交申请即冻结 100 积分");
  check((await r1.api(`/api/refunds?id=${qc.json?.id}`, { method: "DELETE" })).status === 404, "不能撤销别人的申请");
  check(
    (await rc.api(`/api/refunds?id=${qc.json?.id}`, { method: "DELETE" })).status === 200 && (await rc.credits()) === 110,
    "撤销申请：冻结的 100 积分立即退回",
  );
  check((await review(qc.json?.id, "approve")).status === 409, "撤销后的申请不能再批准");
  const [itc2] = await refundables(rc);
  check(!itc2?.request && itc2?.quote?.ok === true, "撤销后这笔付款可以重新申请");
  const qc2 = await rc.api("/api/refunds", { method: "POST", body: { paymentId: itc?.paymentId, reason: "really want it" } });
  check(qc2.status === 200 && qc2.json?.id === qc.json?.id && (await rc.credits()) === 10, "重新申请：沿用同一个申请号，再次冻结 100 积分");
  check(
    (await rc.api(`/api/refunds?id=${qc.json?.id}`, { method: "DELETE" })).status === 200 && (await rc.credits()) === 110,
    "再次撤销：积分再次退回，不会多退",
  );

  const { u: r5, id: r5Id } = await newUser("refund5");
  await d.payOneTime((await checkout(r5, "starter")).orderId, r5Id);
  await spend(r5, 60);
  check((await refundables(r5))[0]?.quote?.reason === "used", "这笔积分用掉超过一半：不能自助申请");
  check(!(await r5.billing()).includes(">Request a refund<"), "不符合规则时不显示申请入口");

  // 订阅只退当期：全额退 → 批准即结束 Pro，并关掉平台的自动续费
  const { u: r4, id: r4Id } = await newUser("refund4");
  const sub4 = await d.startSubscription((await checkout(r4, "pro")).orderId, r4Id);
  const per4 = await d.payPeriod(sub4);
  const [it4] = await refundables(r4);
  check(it4?.quote?.ok && it4.quote.amount === 1900 && it4.quote.credits === 1000 && (await r4.pro()), "订阅当期还没用：报价全额 $19.00、扣 1000 积分");
  const q4 = await r4.api("/api/refunds", { method: "POST", body: { paymentId: it4?.paymentId, reason: "forgot to cancel" } });
  check((await r4.credits()) === 10 && !(await r4.pro()), "提交全额退当期：立即冻结 1000 积分，Pro 暂停");
  await review(q4.json?.id, "approve");
  check((await r4.credits()) === 10 && !(await r4.pro()), "批准全额退当期：冻结 1000 积分，Pro 立即结束");
  if (PROVIDER === "waffo") check(captured.waffoCancels.at(-1)?.orderId === sub4.waffoOrder, "Waffo：同时取消自动续费");
  if (PROVIDER === "stripe") {
    const upd = captured.stripeSubUpdates.at(-1);
    check(
      captured.stripeRefunds.at(-1)?.get("payment_intent") === per4.pi && upd?.id === sub4.id && upd.params.get("cancel_at_period_end") === "true",
      "Stripe：从账单找到 PaymentIntent 退款，并关掉自动续费",
    );
  }
  await d.refundPeriod(sub4, per4, { fraction: 1, cumulative: 1 });
  check((await refundables(r4))[0]?.request?.status === "refunded" && (await r4.credits()) === 10 && !(await r4.pro()), "平台退款到账：不重复扣，Pro 保持结束");

  console.log("8. 试用期与优惠码：试用期不发整期积分，优惠码照发，链接带的码预填到收银台");
  // 试用：这一期的标价（折扣前）低于正价 → 只发 trialCredits（默认 0），Pro 照常；第一次正式扣款发整期
  const { u: t1, id: t1Id } = await newUser("trial1");
  const tsub = await d.startSubscription((await checkout(t1, "pro")).orderId, t1Id);
  await d.payPeriod(tsub, undefined, { list: 0, charged: 0, trialing: true });
  check((await t1.credits()) === 10 && (await t1.pro()), "免费试用开始：不发整期积分（trialCredits 默认 0），Pro 照常生效");
  await d.payPeriod(tsub, undefined, { list: 100, charged: 100, trialing: true });
  check((await t1.credits()) === 10, "付费试用（$1）：同样不发整期积分");
  await d.payPeriod(tsub);
  check((await t1.credits()) === 1010, "试用结束后第一次正式扣款：发整期 1000 积分");
  await d.payPeriod(tsub, undefined, { list: 1900, charged: 950 });
  check((await t1.credits()) === 2010, "优惠券打五折的一期：标价不变，照发整期积分");
  check((await refundables(t1)).some((i) => i.amount === 950), "记下的是实付金额 $9.50，退款按实付算");
  const { u: t2, id: t2Id } = await newUser("trial2");
  const tsub2 = await d.startSubscription((await checkout(t2, "pro")).orderId, t2Id);
  await d.payPeriod(tsub2, undefined, { charged: 0, noList: true });
  check((await t2.credits()) === 10, "回调里没有标价、实付 0：也按试用算，不发整期积分（宁可少发）");

  if (PROVIDER === "stripe") {
    const { u: f1, id: f1Id } = await newUser("free1");
    await d.payOneTimeFree((await checkout(f1, "starter")).orderId, f1Id);
    check((await f1.credits()) === 110 && (await f1.billing()).includes(">paid<"), "100% 折扣码（Stripe 报 no_payment_required）：照常发货 +100");
    check((await refundables(f1))[0]?.quote?.reason === "nothing", "没收钱的订单没有可退的金额");
    check((await f1.billing()).includes(">$0<"), "订单金额改成实付 $0（订单列表、后台收入不会按标价多算）");
  }

  // 优惠码链接 /pricing?code=XXX：前端把码交给 /api/checkout，服务端只校验格式，交给平台预填
  const sentCode = (k) => (PROVIDER === "stripe" ? k.req?.get("discounts[0][promotion_code]") : PROVIDER === "waffo" ? k.req?.session?.promotionCode : k.req?.discount_code);
  const { u: cu } = await newUser("coupon1");
  const k1 = await checkout(cu, "starter", "save10");
  if (PROVIDER === "stripe") {
    check(k1.status === 200 && sentCode(k1) === "promo_local_save10" && !k1.req.has("allow_promotion_codes"), "Stripe：链接带的码查到推广码，直接用上");
    const k2 = await checkout(cu, "starter", "NOSUCH");
    check(k2.status === 200 && !sentCode(k2) && k2.req.get("allow_promotion_codes") === "true", "Stripe：查不到的码不用，收银台照常可以自己填");
  } else if (PROVIDER === "waffo") {
    check(k1.status === 200 && sentCode(k1) === "SAVE10" && k1.req.session?.allowPromotionCodes === true, "Waffo：码预填（promotionCode），并打开收银台的优惠码输入框");
    const k2 = await checkout(cu, "starter", "BADCODE");
    check(k2.status === 200 && !sentCode(k2) && k2.req.session?.allowPromotionCodes === true, "Waffo：码不能用（409）就去掉码重建收银台，照常付款");
  } else {
    check(k1.status === 200 && sentCode(k1) === "SAVE10", "Creem：码预填到收银台（discount_code）");
    const k2 = await checkout(cu, "starter", "BADCODE");
    check(k2.status === 200 && !sentCode(k2), "Creem：码不能用就去掉码重建收银台，照常付款");
  }
  const k3 = await checkout(cu, "starter", "<script>");
  check(k3.status === 200 && !sentCode(k3), "格式不对的码直接忽略");

  console.log("9. 支付日志：每一步都有记录，按邮箱 / 任一 id 一查就是完整时间线；要处理的异常归纳进问题表");
  const trailOf = async (q = "", extra = "") => (await admin.api(`/api/admin/payments?q=${encodeURIComponent(q)}${extra}`)).json ?? {};
  const { u: l1, id: l1Id } = await newUser("trail1");
  const l1email = (await l1.me()).email;
  const lc = await checkout(l1, "starter", "SAVE10");
  const lpay = await d.payOneTime(lc.orderId, l1Id);
  await d.refundOneTime(lpay, 0.4);
  const tr = await trailOf(lc.orderId);
  const kinds = tr.events?.map((e) => e.kind) ?? [];
  check(kinds[0] === "checkout_created" && kinds.includes("paid") && kinds.includes("refunded"), "按订单号查：下单 → 付款 → 退款，按时间排好");
  check(tr.events?.[0]?.promoCode === "SAVE10", "下单那一行记着用了哪个优惠码");
  const paidEv = tr.events?.find((e) => e.kind === "paid");
  check(
    paidEv?.userEmail === l1email && paidEv?.creditsDelta === 100 && paidEv?.balanceAfter === 110 && paidEv?.chargedAmount === 500 && !!paidEv?.raw,
    "付款那一行带着邮箱、实付 $5.00、积分 +100、变化后的余额 110、平台原始数据",
  );
  const refEv = tr.events?.find((e) => e.kind === "refunded");
  check(refEv?.refundedAmount === 200 && refEv?.creditsDelta === -40 && refEv?.balanceAfter === 70, "退款那一行：退了 $2.00、扣回 40 积分、余额 70");
  const lp = (await trailOf(l1email)).payments?.find((p) => p.orderId === lc.orderId);
  check(lp?.refundedAmount === 200 && lp?.status === "partially_refunded" && lp?.creditsGranted === 100, "付款汇总一行看全：已退 $2.00、部分退款、发了 100 积分");
  const t1trail = await trailOf(t1Id);
  check(
    t1trail.events?.some((e) => e.kind === "trial_paid" && e.creditsDelta === 0) && t1trail.payments?.some((p) => p.trial),
    "试用那一期：流水是 trial_paid、+0 积分，付款汇总标着 trial",
  );

  // 异常进问题表：出错的回调、别人店铺的回调；被拒的优惠码只记日志
  const bogus =
    PROVIDER === "waffo"
      ? d.event("order.completed", wid("PAY"), { orderId: wid("ORD"), orderMetadata: { orderId: "ord_does_not_exist" } })
      : PROVIDER === "creem"
        ? d.event("checkout.completed", { id: uid("ch"), request_id: "ord_does_not_exist", metadata: { orderId: "ord_does_not_exist" }, subscription: null })
        : d.event("checkout.session.completed", { id: uid("cs"), object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: uid("pi"), metadata: { orderId: "ord_does_not_exist" } });
  check((await d.send(bogus)) === 500, "回调里的订单本站没有：返回 500 让平台重试");
  await checkout(l1, "starter", PROVIDER === "stripe" ? "NOSUCH" : "BADCODE");
  if (PROVIDER === "waffo") {
    await d.send(d.event("order.completed", wid("PAY"), { orderId: wid("ORD"), orderMetadata: { orderId: lc.orderId } }, { storeId: "STO_attacker000000000000000" }));
  }
  const chk1 = await runChecks();
  check(chk1.json?.status === "success" && chk1.json?.summary?.issues?.new >= 1, `立即检查：新开 ${chk1.json?.summary?.issues?.new} 个问题，提醒管理员`);
  const errIssue = (await issuesOf("status=open&kind=webhook_error")).find((i) => /ord_does_not_exist/.test(String(i.detail?.message ?? "")));
  check(errIssue?.severity === "error" && errIssue?.detail?.provider === PROVIDER, "出错的回调进问题表（错误），带着原因");
  const overview = (await admin.api("/admin")).text;
  check(overview.includes("Needs attention") && overview.includes("to fix"), "概览顶部「待处理」列出要处理的错误数，点进去是过滤好的问题列表");
  check(
    ((await trailOf(l1email)).events ?? []).some((e) => e.kind === "promo_dropped") && !(await issuesOf("status=open")).some((i) => /promo/.test(i.kind)),
    "被平台拒掉的优惠码只记在日志里，不算问题",
  );
  if (PROVIDER === "waffo") {
    const rej = (await issuesOf("status=open&kind=webhook_rejected")).find((i) => i.entityId === "waffo");
    check(rej?.severity === "warning" && /another store/.test(String(rej?.detail?.message ?? "")), "别人店铺的回调：按通道汇总成一条提醒（可能有人伪造回调）");
  }
  const chk2 = await runChecks();
  check(chk2.json?.summary?.issues?.new === 0, "再检查一次：同样的问题不重复开、不重复提醒");
  check(
    (await issueAction(errIssue?.id, "resolve")).status === 200 && (await runChecks()).json?.summary?.issues?.new === 0 && (await issuesOf("kind=webhook_error&status=resolved")).some((i) => i.id === errIssue?.id),
    "管理员标为已解决：没有新情况，再检查也不会重新打开",
  );
  check((await user.api("/api/admin/issues")).status === 403 && (await user.api("/api/admin/issues", { method: "POST", body: { id: errIssue?.id, action: "reopen" } })).status === 403, "普通用户看不到、改不了问题表");
  check((await admin.api(`/admin/payment-log?q=${lc.orderId}`)).text.includes("checkout_created"), "支付日志页按订单号能看到时间线");
  check((await admin.api(`/admin/payments?view=checkouts&q=${lc.orderId}`)).text.includes(lc.orderId), "交易页的结账单能按订单号搜到");
  check((await admin.api(`/admin/payments?q=${lc.orderId}`)).text.includes(l1email), "交易页的到账列表能按订单号搜到那笔付款");
  // 日期范围（UTC，含首尾两天）：今天的能查到，很久以前的范围查不到；起止填反了自动对调
  const today = new Date().toISOString().slice(0, 10);
  const longAgo = "from=2000-01-01&to=2000-01-31";
  check(
    (await admin.api(`/admin/payment-log?q=${lc.orderId}&from=${today}&to=${today}`)).text.includes("checkout_created") &&
      (await admin.api(`/admin/payment-log?q=${lc.orderId}&${longAgo}`)).text.includes("Nothing matches.") &&
      (await admin.api(`/admin/payments?q=${lc.orderId}&from=${today}&to=2000-01-01`)).text.includes(l1email) &&
      (await admin.api(`/admin/payments?view=checkouts&q=${lc.orderId}&${longAgo}`)).text.includes("Nothing matches."),
    "支付日志、交易按日期范围筛选：今天的查得到，2000 年 1 月的查不到；起止填反了照样能查",
  );
  check(
    (await issuesOf(`status=open&from=${today}&to=${today}`)).length >= 1 && (await issuesOf(`status=open&${longAgo}`)).length === 0,
    "问题表按日期范围：这段时间里出现过的才列",
  );
  // 运营页：积分流水、AI 调用、系统检查（只显示变量名，绝不显示值）
  const ledgerPage = (await admin.api(`/admin/credits?range=all&q=${encodeURIComponent(l1email)}`)).text;
  check(ledgerPage.includes("Credit ledger") && ledgerPage.includes(l1email) && (await admin.api(`/admin/credits?q=${encodeURIComponent(l1email)}&from=2000-01-01&to=2000-01-31`)).text.includes("Nothing matches."), "积分流水按邮箱、日期能筛出来");
  check((await admin.api("/admin/ai?range=all")).status === 200, "AI 调用页能打开");
  const sysPage = (await admin.api("/admin/system")).text;
  const envSecrets = readFileSync(".env.development.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]*(SECRET|KEY)[A-Z0-9_]*=/.test(l)).map((l) => l.slice(l.indexOf("=") + 1).trim()).filter((v) => v.length >= 12);
  check(sysPage.includes("System check") && sysPage.includes(`/api/webhooks/${PROVIDER}`) && envSecrets.length > 0 && !envSecrets.some((v) => sysPage.includes(v)), `系统检查显示回调地址，页面里没有任何密钥的值（查了 ${envSecrets.length} 个）`);
  check((await user.api("/admin/credits")).status === 404 && (await user.api("/admin/ai")).status === 404 && (await user.api("/admin/system")).status === 404, "普通用户看不到积分流水、AI 调用、系统检查");
  const billing = async (query) => (await l1.api(`/settings?tab=billing${query}`)).text.includes("<tbody");
  check((await billing("")) && !(await billing("&from=2000-01-01&to=2000-01-31")) && (await billing("&status=pending")) && !(await billing("&status=refunded")), "用户的账单订单能按日期、状态筛选");
  // Newsletter：双重确认、不暴露是否已订阅、群发、一键退订
  const nlEmail = `news+${Date.now()}-${PROVIDER}@example.com`;
  const subscribe = (email, extra = {}) => user.api("/api/newsletter", { method: "POST", body: { email, locale: "en", ...extra } });
  const csv = async (status) => (await admin.api(`/api/admin/newsletter/export?status=${status}`)).text;
  check((await subscribe(nlEmail)).json?.ok === true, "订阅 Newsletter：回 ok，发确认邮件");
  const nlToken = /[?&]token=([A-Za-z0-9_-]+)/.exec(readFileSync(`.data/dev-mail/${nlEmail}.txt`, "utf8"))?.[1];
  check(!!nlToken, "确认邮件里带确认链接");
  check((await user.api(`/newsletter?action=confirm&token=${nlToken}`)).status === 200 && !(await csv("active")).includes(nlEmail), "只打开确认链接不算订阅（邮箱扫描不会自动确认）");
  check((await user.api("/api/newsletter/confirm", { method: "POST", body: { token: "wrong" } })).status === 404, "错误的令牌不能确认");
  check((await user.api("/api/newsletter/confirm", { method: "POST", body: { token: nlToken } })).status === 200 && (await csv("active")).includes(nlEmail), "按按钮确认后才生效");
  check((await csv("active")).includes(nlEmail) && !(await csv("active")).includes(nlToken), "导出 CSV 不含退订令牌");
  check((await subscribe(nlEmail)).json?.ok === true, "已订阅的邮箱再提交，响应一样（不暴露是否已订阅）");
  check((await subscribe("not-an-email")).status === 400 && (await subscribe("x@mailinator.com")).status === 400, "无效邮箱、临时邮箱被拒绝");
  const botEmail = `bot+${Date.now()}@example.com`;
  check((await subscribe(botEmail, { website: "spam" })).json?.ok === true && !(await csv("pending")).includes(botEmail), "蜜罐字段：机器人以为成功，实际没入库");
  check(
    (await user.api("/api/admin/newsletter", { method: "POST", body: { action: "send", subject: "x", body: "y", audience: "all" } })).status === 403 &&
      (await user.api("/api/admin/newsletter/export")).status === 403 &&
      (await user.api("/admin/newsletter")).status === 404,
    "普通用户不能群发、导出、进 Newsletter 后台",
  );
  const nlSubject = `Launch ${Date.now()}`;
  const nlSend = await admin.api("/api/admin/newsletter", { method: "POST", body: { action: "send", subject: nlSubject, body: "Hello <script>alert(1)</script>", audience: "all" } });
  check(nlSend.status === 200 && nlSend.json?.total >= 1, `创建群发：${nlSend.json?.total} 位收件人`);
  let nlMail = "";
  for (let i = 0; i < 40 && !nlMail.includes(nlSubject); i++) {
    await admin.api("/api/admin/jobs", { method: "POST", body: { name: "newsletter.send", action: "run" } });
    nlMail = readFileSync(`.data/dev-mail/${nlEmail}.txt`, "utf8");
    if (!nlMail.includes(nlSubject)) await new Promise((r) => setTimeout(r, 250));
  }
  check(nlMail.includes(nlSubject), "定时任务把群发送到订阅者");
  check(nlMail.includes("&lt;script&gt;") && !nlMail.includes("<script>"), "群发正文里的 HTML 被转义");
  const oneClick = await fetch(`${BASE}/api/newsletter/unsubscribe?token=${encodeURIComponent(nlToken)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  check(oneClick.status === 200 && (await csv("unsubscribed")).includes(nlEmail) && !(await csv("active")).includes(nlEmail), "RFC 8058 一键退订生效");
  check((await admin.api("/admin/newsletter")).status === 200, "Newsletter 后台页能打开");

  // 文档站
  const docsPage = (await user.api("/docs/quick-start")).text;
  check((await user.api("/docs")).status === 200 && docsPage.includes("On this page") && (await user.api("/zh/docs/quick-start")).text.includes("本页目录"), "文档页中英文都能打开，带目录");
  check((await user.api("/docs/does-not-exist")).status === 404, "不存在的文档返回 404");
  check((await user.api("/sitemap.xml")).text.includes("/docs/quick-start"), "文档进了 sitemap");
  check((await t1.billing()).includes(">$0<"), "订阅首期是试用：订单金额记成实付 $0（订单列表、后台收入不按标价多算）");
  check((await admin.api("/admin")).text.includes("Revenue (net)"), "后台收入按实付减退款算（Revenue (net)）");
  check(
    (await l1.api("/api/admin/payments")).status === 403 && (await l1.api("/admin/payments")).status === 404 && (await l1.api("/admin/payment-log")).status === 404,
    "普通用户看不到交易和支付日志",
  );

  console.log("10. 回调丢了也不漏单：跳回时主动查单、超时重试、定时任务补单与邮件提醒、每日对账、旧事件不回滚");
  const P = platform[PROVIDER];
  const anon = client();
  const cron = (q) => admin.api(`/api/cron/payments?${q}`);
  check((await anon.api("/api/cron/payments?task=pending")).status === 401, "定时任务接口：不带密钥、也不是管理员 → 401");
  check((await anon.api("/api/cron/payments?task=pending", { headers: { Authorization: "Bearer wrong" } })).status === 401, "密钥不对 → 401");

  // 用户付完跳回来，回调还没到
  const { u: q1u, id: q1Id } = await newUser("return1");
  const qk1 = await checkout(q1u, "starter");
  const qref1 = P.payOneTime(qk1);
  const page1 = (await q1u.api(`/dashboard?paid=${qk1.orderId}`)).text;
  check(page1.includes(">Payment received") && (await q1u.credits()) === 110, "回调还没到：跳回用户中心时主动查单，当场到账 +100");
  check((await trailOf(qk1.orderId)).events?.some((e) => e.kind === "reconciled"), "流水记 reconciled（回调比人慢是正常的，不算问题）");
  check((await d.payOneTime(qk1.orderId, q1Id, qref1)).status === 200 && (await q1u.credits()) === 110, "同一笔的回调随后才到：不重复加积分");

  const { u: q2u, id: q2Id } = await newUser("return2");
  const qk2 = await checkout(q2u, "pro");
  const { sub: qsub, period: qp1 } = P.startSubscription(qk2, q2Id);
  await q2u.api(`/dashboard?paid=${qk2.orderId}`);
  check((await q2u.credits()) === 1010 && (await q2u.pro()), "订阅首期：跳回时查到已付，建好订阅、+1000、Pro 生效");
  await d.startSubscription(qk2.orderId, q2Id, qsub);
  await d.payPeriod(qsub, qp1);
  check((await q2u.credits()) === 1010 && (await q2u.pro()), "订阅的回调随后才到：不重复发积分");

  // 查单接口临时故障 / 卡住
  const { u: q3u } = await newUser("flaky1");
  const qk3 = await checkout(q3u, "starter");
  P.payOneTime(qk3);
  flaky.set(P.target(qk3), 1);
  await q3u.api(`/dashboard?paid=${qk3.orderId}`);
  check((await q3u.credits()) === 110 && hits.get(P.target(qk3)) === 2, `查单遇到 503：自动重试，第二次成功到账（共请求 ${hits.get(P.target(qk3))} 次）`);
  const { u: q4u } = await newUser("hang1");
  const qk4 = await checkout(q4u, "starter");
  P.payOneTime(qk4);
  hang.add(P.target(qk4));
  const t0 = Date.now();
  const page4 = (await q4u.api(`/dashboard?paid=${qk4.orderId}`)).text;
  const waited = Date.now() - t0;
  check(waited < 7500 && page4.includes(">Confirming your payment") && (await q4u.credits()) === 10, `查单接口卡住：页面 ${(waited / 1000).toFixed(1)} 秒后先显示「处理中」，不会一直等`);
  let failEv;
  for (let i = 0; i < 25 && !failEv; i++) {
    await sleep(1000);
    failEv = (await trailOf(qk4.orderId)).events?.find((e) => e.kind === "reconcile_failed");
  }
  check(/timed? ?out/i.test(failEv?.message ?? "") && hits.get(P.target(qk4)) === 3, `每次请求 2 秒超时、重试 2 次，最后记一条 reconcile_failed（请求 ${hits.get(P.target(qk4))} 次：${failEv?.message ?? "无"}）`);
  hang.delete(P.target(qk4));

  // 定时任务：回调彻底丢了的订单补上，放弃付款的订单标记失败，新开的问题提醒管理员。
  // 之前跑过测试留下的同通道「回调没到」先标成已解决，这次的漏单才会重新打开它
  for (const i of await issuesOf("status=open&kind=missed_webhook")) if (i.entityId === PROVIDER) await issueAction(i.id, "resolve");
  const { u: q5u } = await newUser("cron1");
  const qk5 = await checkout(q5u, "starter");
  P.payOneTime(qk5);
  const { u: q6u } = await newUser("cron2");
  const qk6 = await checkout(q6u, "starter");
  P.expire(qk6);
  const job = await anon.api("/api/cron/payments?task=pending&minAgeMinutes=0", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  check(job.status === 200 && job.json?.pending?.paid >= 2, `带 CRON_SECRET 调定时任务（Vercel Cron 的做法）：补了 ${job.json?.pending?.paid} 单`);
  check((await q5u.credits()) === 110 && (await q4u.credits()) === 110, "一直没收到回调的订单、和刚才查单超时的订单都补上了 +100");
  const missed = (await issuesOf("status=open&kind=missed_webhook")).find((i) => i.entityId === PROVIDER);
  check(
    (await trailOf(qk5.orderId)).events?.some((e) => e.kind === "missed_webhook") && missed?.detail?.count >= 2 && missed?.detail?.orders?.includes(qk5.orderId),
    `定时任务补的单记 missed_webhook；按通道汇总成一条「回调没到」提醒（${missed?.detail?.count} 笔，说明 webhook 配置或服务器有问题）`,
  );
  check((await q6u.billing()).includes(">failed<") && (await trailOf(qk6.orderId)).events?.some((e) => e.kind === "order_expired"), "收银台已过期、没付款的订单标记 failed");
  const alertMail = readFileSync(`.data/dev-mail/${REFUND_ADMIN}.txt`, "utf8");
  check(job.json?.issues?.new >= 1 && job.json?.issues?.sentTo === 2 && alertMail.includes("new issue") && alertMail.includes(qk5.orderId), "新开了问题：邮件发给 ADMIN_EMAILS 里的管理员，列出漏掉的订单");
  const job2 = await cron("task=pending&minAgeMinutes=0");
  check(job2.status === 200 && job2.json?.issues?.new === 0 && job2.json?.pending?.paid === 0, "管理员登录后也能手动跑；再跑一次：不重复补单，问题没变就不再提醒");

  // 定时任务中心：统一入口 /api/cron/tick、手动运行、运行历史、账务检查
  check((await anon.api("/api/cron/tick")).status === 401, "不带 CRON_SECRET 不能触发调度器");
  const tick1 = await anon.api("/api/cron/tick", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  check(tick1.status === 200 && Array.isArray(tick1.json?.runs) && tick1.json.runs.every((r) => r.status !== "failed"), `带 CRON_SECRET 触发调度器：执行了 ${tick1.json?.ran} 个到点的任务，没有失败`);
  const tick2 = await anon.api("/api/cron/tick", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  check(tick2.status === 200 && tick2.json?.ran <= 1, `紧接着再触发：没到点的不重复跑（这次跑了 ${tick2.json?.ran} 个）`);
  check((await user.api("/api/admin/jobs", { method: "POST", body: { name: "ledger.check", action: "run" } })).status === 403, "普通用户不能运行定时任务");
  const ledger = await admin.api("/api/admin/jobs", { method: "POST", body: { name: "ledger.check", action: "run" } });
  const lcheck = ledger.json?.summary?.checked;
  check(ledger.status === 200 && ledger.json?.status === "success" && lcheck?.balanceMismatch === 0 && lcheck?.paidWithoutCredits === 0, "手动运行账务检查：所有用户余额和积分流水对得上，付了款的都发了积分");
  check(ledger.json?.summary?.issues?.open >= 1, `账务检查顺带复查支付异常：现在待处理 ${ledger.json?.summary?.issues?.open} 个`);
  check(lcheck?.negativeBalance >= 1, `账务检查发现余额为负的账户（退款扣回后冻结的）：${lcheck?.negativeBalance} 个`);
  check((await admin.api("/api/admin/jobs", { method: "POST", body: { name: "cleanup", action: "schedule", schedule: "61 * * * *" } })).status === 400, "改频率：不合法的 cron 被拒绝");
  check((await admin.api("/api/admin/jobs", { method: "POST", body: { name: "cleanup", action: "schedule", schedule: "0 5 * * *" } })).status === 200, "改频率：合法的 cron 保存成功");
  const jobsPage = (await admin.api("/admin/jobs")).text;
  check(jobsPage.includes("0 5 * * *") && jobsPage.includes("ledger.check"), "后台定时任务页：显示改过的频率和运行历史");
  check((await admin.api("/admin/reconciliation")).status === 200 && (await user.api("/admin/reconciliation")).status === 404, "异常与对账页只有管理员能看");

  // 每日对账：续费、退款、取消订阅的回调都丢了
  let qp2, qref;
  if (P.renew) {
    qp2 = P.renew(qsub);
    qref = P.refund(qsub, qp1, 0.5);
  }
  P.setStatus(qsub, "canceled");
  const rec = await cron("task=reconcile");
  const tally = rec.json?.reconcile?.[PROVIDER];
  if (P.renew) check((await q2u.credits()) === 1510, `对账补上漏掉的续费 +1000、漏掉的半额退款 -500（${await q2u.credits()}）`);
  check(!(await q2u.pro()) && tally?.fixed === (P.renew ? 3 : 1), `对账发现平台上订阅已取消：本地同步，Pro 结束（补了 ${tally?.fixed} 项）`);
  const rec2 = await cron("task=reconcile");
  check(rec2.json?.reconcile?.[PROVIDER]?.fixed === 0 && (await q2u.credits()) === (P.renew ? 1510 : 1010), "再对一次账：没有可补的，积分不变");
  if (P.renew) {
    eventClock = Date.now() - 5 * 60_000; // 晚到的回调带的是事情发生时的时间
    await d.payPeriod(qsub, qp2);
    await d.refundPeriod(qsub, qp1, { fraction: 0.5, cumulative: 0.5, refundId: qref });
    eventClock = null;
    check((await q2u.credits()) === 1510 && !(await q2u.pro()), "丢的回调后来又到了：续费不重复发、退款不重复扣，旧的续费事件也不会把已取消的订阅改回有效");
  } else console.log("  - Creem 没有按时间拉付款 / 退款的接口：续费、退款的对账跳过（pending 订单靠主动查单）");

  // 旧的状态事件（重推、乱序到达）不回滚订阅状态
  const { u: s1u, id: s1Id } = await newUser("stale1");
  const ssub = await d.startSubscription((await checkout(s1u, "pro")).orderId, s1Id);
  await d.payPeriod(ssub);
  const tCancel = Date.now();
  await d.statusCanceled(ssub);
  check(!(await s1u.pro()), "取消订阅的回调：Pro 结束");
  eventClock = tCancel - 60_000;
  await d.statusActive(ssub);
  check(!(await s1u.pro()), "比它早的「订阅正常」事件后到：不采用，Pro 仍然结束");
  await d.payPeriod(ssub);
  check((await s1u.credits()) === 2010 && !(await s1u.pro()), "比它早的一期扣款后到：积分照发（钱确实收了），但不把订阅改回有效");
  eventClock = null;
  check(((await trailOf(ssub.waffoOrder ?? ssub.id)).events ?? []).some((e) => e.outcome === "ignored" && /stale/.test(e.message ?? "")), "流水里记为 ignored（stale event），一眼能看出为什么没生效");
  eventClock = Date.now() + 1000;
  await d.statusActive(ssub);
  eventClock = null;
  check(await s1u.pro(), "更新的事件照常生效：订阅恢复");

  console.log("11. 攻击：伪造回调");
  const forged = PROVIDER === "waffo" ? d.event("order.completed", uid("PAY"), { orderId: uid("ORD"), orderMetadata: { orderId: c1.orderId } }) : PROVIDER === "creem" ? d.event("refund.created", { id: uid("ref") }) : d.event("charge.refunded", { id: uid("ch") });
  check((await d.send(forged, { sign: false })) === d.rejected, `没有签名 → ${d.rejected}`);
  check((await d.send(forged, { tamper: true })) === d.rejected, `签名后改过请求体 → ${d.rejected}`);
  if (PROVIDER === "waffo") {
    const c4 = await checkout(user, "max");
    const foreign = d.event("order.completed", uid("PAY"), { orderId: uid("ORD"), orderMetadata: { orderId: c4.orderId } }, { storeId: "STO_attacker000000000000000" });
    check((await d.send(foreign)) === 403 && (await user.credits()) === bal, "别人店铺的真签名事件 → 403，不加积分");
    const prod = d.event("order.completed", uid("PAY"), { orderId: uid("ORD"), orderMetadata: { orderId: c4.orderId } }, { mode: "prod" });
    check((await d.send(prod)) === 200 && (await user.credits()) === bal, "测试模式下忽略生产事件");
    await d.send(d.event("subscription.payment_succeeded", uid("PAY"), { orderId: uid("ORD"), orderMetadata: { userId: me.id, planId: "pro" } }));
    check((await user.credits()) === bal, "只带 userId / planId 的伪造订阅扣款 → 不发积分");
    await d.send(d.event("subscription.payment_succeeded", uid("PAY"), { orderId: uid("ORD"), orderMetadata: { orderId: c1.orderId } }));
    check((await user.credits()) === bal, "拿一次性订单冒充订阅 → 不发积分");
    await d.send(d.event("refund.succeeded", uid("REF"), { orderId: uid("ORD"), paymentId: uid("PAY"), orderMetadata: {} }));
    check((await user.credits()) === bal, "退款事件找不到对应的发放记录 → 不扣");
  }

  console.log("12. 攻击：管理员与资料接口");
  const attacker = client();
  const attackerPw = "Admin-takeover-test-pw-123"; // 本地数据库保留上一轮的账号：已存在就登录
  const reg = await attacker.api("/api/auth/sign-up/email", { method: "POST", body: { name: "Attacker", email: ADMIN_EMAIL, password: attackerPw } });
  if (!reg.json?.token) await attacker.api("/api/auth/sign-in/email", { method: "POST", body: { email: ADMIN_EMAIL, password: attackerPw } });
  const att = await attacker.me();
  // 要求验证邮箱时攻击者拿不到登录态（收不到验证码）；不要求时能登录，但邮箱未验证
  check(
    att ? att.emailVerified === false : reg.status === 200 && !reg.json?.token,
    att ? "攻击者用管理员邮箱注册成功（邮箱未验证）" : "攻击者用管理员邮箱注册：没有验证码就登录不了",
  );
  // 能登录（不要求验证邮箱）时后台返回 404；登录不了时被重定向到登录页
  check([307, 404].includes((await attacker.api("/admin")).status), "抢注管理员邮箱 → 看不到后台");
  check(
    [401, 403].includes((await attacker.api("/api/admin/credits", { method: "POST", body: { userId: att?.id ?? "x", delta: 100000 } })).status),
    "抢注管理员邮箱 → 不能调积分",
  );
  await user.api("/api/auth/update-user", { method: "POST", body: { name: "Hacker", credits: 999999, role: "admin" } });
  const after = await user.me();
  check(after.credits === bal && after.role !== "admin", "改资料接口改不了积分和角色");
  check((await user.api("/api/mock/complete", { method: "POST", body: { orderId: c1.orderId } })).status === 404, "非模拟通道时模拟支付接口关闭");

  console.log("12b. 后台用户管理：搜索、封禁 / 解封、删除限制");
  const userAdmin = (id, body) => admin.api(`/api/admin/users/${id}`, { method: "POST", body });
  check((await user.api("/api/admin/users/x", { method: "POST", body: { action: "unban" } })).status === 403, "普通用户不能调用用户管理接口");
  check((await user.api("/admin/users")).status === 404, "普通用户看不到后台用户列表");
  check((await admin.api(`/admin/users?q=${encodeURIComponent(email)}`)).text.includes(email), "后台用户列表能按邮箱搜到");
  check((await admin.api(`/admin/users/${me.id}?tab=payments`)).status === 200, "后台用户详情页能打开");
  const victim = client();
  const victimEmail = `ban+${Date.now()}@example.com`;
  const victimPw = `Ban-${randomUUID()}`;
  const vreg = await victim.api("/api/auth/sign-up/email", { method: "POST", body: { name: "Victim", email: victimEmail, password: victimPw } });
  if (vreg.status === 200 && !vreg.json?.token) await victim.verifyEmail(victimEmail);
  const vid = (await victim.me())?.id;
  check(!!vid, "封禁测试用户注册并登录");
  check((await userAdmin(vid, { action: "ban", reason: "" })).status === 400, "封禁必须填原因");
  check((await userAdmin(vid, { action: "ban", reason: "payment test", days: 1 })).status === 200, "管理员封禁用户");
  check(!(await victim.me()), "封禁后已有的登录立即失效");
  const blocked = await victim.api("/api/auth/sign-in/email", { method: "POST", body: { email: victimEmail, password: victimPw } });
  check(blocked.status === 403 && blocked.json?.code === "BANNED", "封禁后不能登录（BANNED）");
  check((await admin.api("/admin/users?status=banned")).text.includes(victimEmail), "按「已封禁」筛选能看到");
  check((await userAdmin(vid, { action: "unban" })).status === 200, "管理员解除封禁");
  const back = await victim.api("/api/auth/sign-in/email", { method: "POST", body: { email: victimEmail, password: victimPw } });
  check(!!back.json?.token, "解封后可以登录");
  check((await userAdmin(me.id, { action: "delete", confirmEmail: email })).status === 409, "付过款的账号不能删除");
  check((await userAdmin(vid, { action: "delete", confirmEmail: "wrong@example.com" })).status === 400, "删除要输入正确的邮箱确认");
  check((await userAdmin(vid, { action: "delete", confirmEmail: victimEmail })).status === 200 && !(await victim.me()), "没付过款的账号可以删除");
  check((await admin.api("/api/admin/credits", { method: "POST", body: { userId: me.id, delta: 5 } })).status === 400, "调积分必须填原因");
  const adj = await admin.api("/api/admin/credits", { method: "POST", body: { userId: me.id, delta: 5, note: "payment test" } });
  const adj2 = await admin.api("/api/admin/credits", { method: "POST", body: { userId: me.id, delta: -5, note: "payment test undo" } });
  check(adj.status === 200 && adj2.status === 200 && (await admin.api(`/admin/users/${me.id}?tab=log`)).text.includes("adjust_credits"), "调积分写进管理记录");
  console.log("13. 攻击：流式结果读完再断开");
  const before = await user.credits();
  const ctrl = new AbortController();
  const res = await user.api("/api/ai/text", { method: "POST", body: { feature: "rewrite", input: "make this sentence a lot better please" }, signal: ctrl.signal, raw: true });
  const reader = res.body.getReader();
  await reader.read();
  await reader.read();
  ctrl.abort();
  await new Promise((r) => setTimeout(r, 1500));
  check((await user.credits()) === before - 1, "已看到部分结果再断开：照常扣 1 积分，不退款");
} finally {
  fake.close();
}

console.log(failed ? "有失败项 ✗" : "全部通过 ✅");
process.exit(failed ? 1 : 0);
