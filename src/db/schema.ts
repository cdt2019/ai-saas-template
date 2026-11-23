/**
 * 数据库表结构（Drizzle ORM，Postgres）
 * - user / session / account / verification：Better Auth 必需的 4 张表
 * - credit_transaction：积分流水（余额冗余存在 user.credits 上，流水用于对账和展示）
 * - order / subscription / payment：支付记录；refund_request：网页退款申请
 * - admin_log：后台操作记录
 * - notification：站内通知（支付成功、订阅、退款、积分变动、视频生成等），铃铛和弹出提示读它
 * - job / job_run：定时任务的状态（锁、上次运行）和每次运行的记录；ledger_issue：账务检查发现的问题
 *
 * 改完表结构后运行：npm run db:generate（生成迁移 SQL）
 * 时间字段一律用 timestamptz（withTimezone），避免不同驱动 / 时区下解析不一致
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/* ---------------- Better Auth ---------------- */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    /** 积分余额（通过 credits.ts 修改，保证和流水一致） */
    credits: integer("credits").default(0).notNull(),
    /** user | admin */
    role: text("role").default("user").notNull(),
    /** 封禁：不能登录，封禁时已有的登录全部踢下线；banExpires 为空表示永久 */
    banned: boolean("banned").default(false).notNull(),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("user_created_idx").on(t.createdAt)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ---------------- 积分 ---------------- */

export const creditTransaction = pgTable(
  "credit_transaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 正数为增加，负数为消耗 */
    delta: integer("delta").notNull(),
    /** signup_bonus | purchase | subscription | spend | refund | admin */
    reason: text("reason").notNull(),
    /** 幂等键：同一个 refId 只会记一次（订单号、webhook 事件号等） */
    refId: text("ref_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_tx_user_idx").on(t.userId, t.createdAt),
    index("credit_tx_created_idx").on(t.createdAt),
    uniqueIndex("credit_tx_ref_idx").on(t.refId),
  ],
);

/* ---------------- 支付 ---------------- */

export const order = pgTable(
  "order",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** stripe | creem | waffo | mock */
    provider: text("provider").notNull(),
    /** 支付平台侧的 checkout / session id */
    providerRef: text("provider_ref"),
    planId: text("plan_id").notNull(),
    /** 金额，单位：分。下单时是方案标价，付款成功后改成实付（用了优惠码会更低） */
    amount: integer("amount").notNull(),
    /** 下单时的方案标价（分），amount 被改成实付后，两者一比就知道打了多少折 */
    listAmount: integer("list_amount"),
    currency: text("currency").notNull(),
    /** 下单时带的优惠码（/pricing?code=XXX），没付款的单也能看出用了哪个码 */
    promoCode: text("promo_code"),
    /** pending | paid | failed | refunded */
    status: text("status").default("pending").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("order_user_idx").on(t.userId, t.createdAt)],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** 支付平台侧的订阅 id */
    providerSubId: text("provider_sub_id").notNull().unique(),
    /** 用于跳转到平台的自助管理页（Stripe customer id 等） */
    providerCustomerId: text("provider_customer_id"),
    planId: text("plan_id").notNull(),
    /** active | canceled | past_due | expired | refunded（当期订阅款已全额退回，Pro 立即结束） */
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    /** 最近一次被采用的支付平台事件的时间：比它旧的状态事件（重试、乱序到达）一律忽略，防止旧的「续费成功」把已取消的订阅改回有效 */
    statusEventAt: timestamp("status_event_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscription_user_idx").on(t.userId)],
);

/**
 * 每一笔实际到账的付款（一次性购买、订阅的每一期），由支付回调在发积分时记下。
 * 退款按它算金额，并且带着平台侧的付款 id 去退，不用到支付平台后台找交易。
 * 后面几列是冗余的汇总，一行就能看出这笔钱现在的状态：标价、折扣、实付、退了多少、发了多少积分、是不是试用
 */
export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** 平台侧付款 id：Waffo PAY_…；Stripe 一次性是 PaymentIntent、订阅是账单 in_…；Creem 交易号 */
    providerPaymentId: text("provider_payment_id").notNull().unique(),
    /** 这笔付款发积分时的 refId（order_<订单号> / stripe_<账单号> / creem_tx_<交易号> / waffo_<支付号>） */
    grantRefId: text("grant_ref_id").notNull().unique(),
    planId: text("plan_id").notNull(),
    /** 订阅的平台侧 id；一次性购买为空 */
    providerSubId: text("provider_sub_id"),
    /** 实付金额（含税），单位：分 */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    /** 以下为冗余汇总，方便一眼看出问题 */
    /** 我们的订单号（一次性购买；订阅续费没有订单） */
    orderId: text("order_id"),
    userEmail: text("user_email"),
    /** 这一期的标价（折扣前，分）；试用期是试用价 */
    listAmount: integer("list_amount"),
    /** 折扣（分）= 标价 − 实付 */
    discountAmount: integer("discount_amount"),
    promoCode: text("promo_code"),
    /** 订阅试用期的付款（只发 trialCredits） */
    trial: boolean("trial").default(false).notNull(),
    /** 这笔付款发了多少积分 */
    creditsGranted: integer("credits_granted").default(0).notNull(),
    /** 平台已退的金额（分，累计） */
    refundedAmount: integer("refunded_amount").default(0).notNull(),
    /** paid | partially_refunded | refunded | disputed */
    status: text("status").default("paid").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_user_idx").on(t.userId, t.createdAt)],
);

/**
 * 支付流水日志：支付流程里发生的每一件事一行，只追加不修改 —— 下单、每条支付回调（含被拒的、出错的）、
 * 发积分、试用、优惠码、退款、拒付、订阅状态变化、网页退款申请与审核。
 * 字段故意冗余（邮箱、各方 id、标价 / 折扣 / 实付 / 退款、积分变化和变化后的余额、平台原始数据），
 * 出问题时按邮箱或任一 id 一查就是完整时间线，不用再去支付平台后台对。后台：/admin/payments
 * 不设外键：用户删了流水也要留着对账。
 */
export const paymentEvent = pgTable(
  "payment_event",
  {
    id: text("id").primaryKey(),
    createdAt: createdAt(),
    /** stripe | creem | waffo | mock | system */
    provider: text("provider").notNull(),
    /**
     * 我们归一化的事件：checkout_created | promo_dropped | paid | subscription_started | period_paid | trial_paid
     * | refunded | refund_failed | dispute_opened | dispute_won | subscription_status
     * | refund_requested | refund_approved | refund_rejected | refund_released | webhook
     */
    kind: text("kind").notNull(),
    /** ok | ignored（合法但不处理，如环境不符、重复推送）| rejected（不可信，如别人店铺的事件）| error（处理出错） */
    outcome: text("outcome").notNull(),
    /** 人能看懂的一句话：做了什么、为什么 */
    message: text("message"),
    userId: text("user_id"),
    userEmail: text("user_email"),
    orderId: text("order_id"),
    planId: text("plan_id"),
    /** 我们的 payment 行 id */
    paymentId: text("payment_id"),
    providerPaymentId: text("provider_payment_id"),
    /** 平台侧订单 / 收银台会话 id（Waffo ORD_…、Stripe cs_…、Creem ch_…） */
    providerOrderId: text("provider_order_id"),
    providerSubId: text("provider_sub_id"),
    providerRefundId: text("provider_refund_id"),
    /** 平台原始事件类型和 id（如 order.completed / PAY_…） */
    providerEventType: text("provider_event_type"),
    providerEventId: text("provider_event_id"),
    currency: text("currency"),
    /** 金额都是分：标价、折扣、实付、这次退款 */
    listAmount: integer("list_amount"),
    discountAmount: integer("discount_amount"),
    chargedAmount: integer("charged_amount"),
    refundedAmount: integer("refunded_amount"),
    promoCode: text("promo_code"),
    /** 这件事让用户积分变了多少，以及变化后的余额 */
    creditsDelta: integer("credits_delta"),
    balanceAfter: integer("balance_after"),
    /** 平台回调的原始数据（截断到 8KB） */
    raw: text("raw"),
  },
  (t) => [
    index("payment_event_created_idx").on(t.createdAt),
    index("payment_event_user_idx").on(t.userId),
    index("payment_event_order_idx").on(t.orderId),
    index("payment_event_provider_payment_idx").on(t.providerPaymentId),
  ],
);

/**
 * 用户在网页上发起的退款申请：金额由系统按未用积分算（src/lib/payments/refunds.ts），管理员在 /admin 审核。
 * 每笔付款只能申请一次（被拒后请联系客服）。
 */
export const refundRequest = pgTable(
  "refund_request",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    paymentId: text("payment_id")
      .notNull()
      .unique()
      .references(() => payment.id, { onDelete: "cascade" }),
    /**
     * pending 待审核 | processing 已批准、积分已冻结，等平台退款到账 | refunded 已退款
     * | rejected 已拒绝 | failed 平台退款失败或被撤回（冻结的积分已还回）
     */
    status: text("status").default("pending").notNull(),
    reason: text("reason").notNull(),
    /** 退款金额（分）和要扣回的积分：申请时算一次，批准时按当时的余额重算取较小值 */
    amount: integer("amount").notNull(),
    credits: integer("credits").notNull(),
    /** 平台侧凭证：Waffo 退款工单号 / Stripe 退款号 */
    providerRefundId: text("provider_refund_id"),
    adminNote: text("admin_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("refund_request_user_idx").on(t.userId)],
);

/* ---------------- 防刷 ---------------- */

/** 固定窗口限流计数（存数据库，多实例 / Serverless 下也能共享，不依赖 Redis） */
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

/* ---------------- AI ---------------- */

/** 每次 AI 生成的记录：用户历史、后台统计、失败排查都靠它 */
export const generation = pgTable(
  "generation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 功能 id，见 src/config/ai.ts */
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    cost: integer("cost").notNull(),
    /** pending | succeeded | failed */
    status: text("status").notNull(),
    /** 输入摘要（截断保存，避免存太多用户数据） */
    input: text("input"),
    /** 文本结果（截断）或图片 / 视频 URL */
    output: text("output"),
    error: text("error"),
    /** 异步任务信息（JSON）：视频这类要排队的生成，存平台返回的任务地址，用来查进度 */
    job: text("job"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("generation_user_idx").on(t.userId, t.createdAt), index("generation_created_idx").on(t.createdAt)],
);

/* ---------------- 后台 ---------------- */

/** 后台操作记录：谁、什么时候、对哪个用户做了什么（改角色、封禁、踢下线、删除、调积分）。不设外键：用户删了记录也要留着 */
export const adminLog = pgTable(
  "admin_log",
  {
    id: text("id").primaryKey(),
    adminEmail: text("admin_email").notNull(),
    /** set_role | ban | unban | revoke_sessions | delete | adjust_credits */
    action: text("action").notNull(),
    targetUserId: text("target_user_id"),
    targetEmail: text("target_email"),
    /** 人能看懂的一句话：改成了什么、原因 */
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [
    index("admin_log_target_idx").on(t.targetUserId, t.createdAt),
    index("admin_log_created_idx").on(t.createdAt),
  ],
);

/* ---------------- 站内通知 ---------------- */

/**
 * 站内通知：服务端在业务事件发生时写一行（src/lib/notify.ts），前端轮询 /api/me/pulse 取新的。
 * 只存类型和参数，文字在前端按用户的语言生成（src/lib/notification-text.ts）。refId 防重复：同一个回调重推只记一条
 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** payment_succeeded | subscription_started | refund_completed | credits_low | video_ready …（见 notify.ts） */
    type: text("type").notNull(),
    /** 文案里用到的参数（JSON）：积分数、套餐、金额等 */
    params: text("params"),
    /** 点通知去哪里（不带语言前缀的站内路径） */
    link: text("link"),
    refId: text("ref_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt), uniqueIndex("notification_ref_idx").on(t.refId)],
);

/* ---------------- Newsletter ---------------- */

/** 订阅者：pending（等邮件确认）| active | unsubscribed。token 用于确认和退订链接，导出时不包含 */
export const newsletterSubscriber = pgTable(
  "newsletter_subscriber",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    locale: text("locale").notNull(),
    status: text("status").default("pending").notNull(),
    token: text("token").notNull().unique(),
    /** 最近一次发确认邮件的时间：1 小时内不重发，防止被拿来轰炸别人的邮箱 */
    confirmSentAt: timestamp("confirm_sent_at", { withTimezone: true }).defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("newsletter_subscriber_status_idx").on(t.status, t.createdAt)],
);

/** 一次群发：audience = all 或语言；status = sending | sent */
export const newsletterCampaign = pgTable("newsletter_campaign", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull(),
  status: text("status").default("sending").notNull(),
  total: integer("total").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** 每个收件人一行，保证一封群发每人最多一封：pending | sending | sent | failed | skipped（发之前退订了） */
export const newsletterDelivery = pgTable(
  "newsletter_delivery",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => newsletterCampaign.id, { onDelete: "cascade" }),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => newsletterSubscriber.id, { onDelete: "cascade" }),
    status: text("status").default("pending").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("newsletter_delivery_once_idx").on(t.campaignId, t.subscriberId), index("newsletter_delivery_status_idx").on(t.status, t.campaignId)],
);

/* ---------------- 定时任务 ---------------- */

/**
 * 每个定时任务一行（任务本身在 src/lib/jobs/registry.ts 里用代码登记）：后台改的开关、频率，运行锁，上次运行。
 * 锁：lockedUntil 没过期时别的实例 / 别的触发不会再跑同一个任务。名为 __tick 的一行记录调度器最近一次被触发的时间
 */
export const job = pgTable("job", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  /** 后台改过的频率（cron 表达式，UTC）；为空用代码里的默认值 */
  schedule: text("schedule"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  /** success | failed | 触发方式（__tick 行） */
  lastStatus: text("last_status"),
  updatedAt: updatedAt(),
});

/** 每次运行一行：谁触发的、跑了多久、结果摘要、错误和日志。后台「定时任务」页的运行历史 */
export const jobRun = pgTable(
  "job_run",
  {
    id: text("id").primaryKey(),
    job: text("job").notNull(),
    /** tick（外部定时调用）| internal（进程内定时器）| manual（后台手动） */
    trigger: text("trigger").notNull(),
    triggeredBy: text("triggered_by"),
    /** running | success | failed */
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    /** 结果摘要（JSON）：查了多少、补了多少 */
    summary: text("summary"),
    error: text("error"),
    /** 运行过程的日志（最多 200 行） */
    log: text("log"),
  },
  (t) => [index("job_run_job_idx").on(t.job, t.startedAt), index("job_run_started_idx").on(t.startedAt)],
);

/**
 * 需要人处理的问题：账务检查（余额和流水对不上、付了款没发积分、退款卡住等）和支付检查（回调出错、退款失败、
 * 漏单、回调被拒等）发现的，规则见 src/lib/issues.ts。key 唯一，同一个问题只有一行；
 * 管理员可以标记已解决 / 忽略；状态类的问题再检查时消失会自动标记已解决
 */
export const ledgerIssue = pgTable(
  "ledger_issue",
  {
    id: text("id").primaryKey(),
    /** kind:实体 id */
    key: text("key").notNull().unique(),
    /** 见 src/lib/issues.ts 的 LEDGER_KINDS、PAYMENT_KINDS */
    kind: text("kind").notNull(),
    /** error | warning */
    severity: text("severity").notNull(),
    userId: text("user_id"),
    entityId: text("entity_id"),
    /** 细节（JSON）：期望值、实际值等 */
    detail: text("detail"),
    /** open | resolved | ignored */
    status: text("status").default("open").notNull(),
    note: text("note"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("ledger_issue_status_idx").on(t.status, t.lastSeenAt)],
);
