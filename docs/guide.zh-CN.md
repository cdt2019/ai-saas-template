# 开发与运维手册

项目介绍和快速开始见 [README](../README.zh-CN.md)。这里记录各模块在哪、怎么上线，以及支付、退款、对账、定时任务的规则。

## 模块一览

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 数据库表 | `src/db/schema.ts` | user / session / account / verification / credit_transaction / order / subscription |
| 数据库连接 | `src/db/index.ts` | 有 `DATABASE_URL` 连 Postgres，否则用 PGlite；线上要用连接池地址，用了直连会在日志里告警 |
| 登录注册 | `src/lib/auth.ts`、`src/components/auth/` | 邮箱 + 密码，注册后输 6 位邮箱验证码才登录（默认开启，`AUTH_REQUIRE_EMAIL_VERIFICATION=false` 可关；注册积分验证后才发）；找回密码也用验证码；Google / GitHub 配了才显示 |
| 积分 | `src/lib/credits.ts` | `grantCredits`（幂等）/ `spendCredits`（并发安全），注册赠送积分 |
| 价格方案 | `src/config/pricing.ts` | 一次性积分包 + 订阅，改价格只改这里；默认主推一次性积分包（新词、热点站用户大多做完就走） |
| 支付 | `src/lib/payments/` | 统一接口，Stripe / Creem / Waffo / mock 四个实现；发货逻辑在 `fulfill.ts` |
| Webhook | `src/app/api/webhooks/{stripe,creem,waffo}` | 签名校验 + 幂等发货 |
| 订阅管理 | `/api/billing/portal` | Stripe Billing Portal、Waffo 客户门户（配了 `WAFFO_STORE_ID` 才显示按钮） |
| 页面 | `/login` `/signup` `/forgot-password` `/pricing` `/dashboard` `/settings` | 全部支持多语言 |
| 登录保护 | `src/proxy.ts` | `/dashboard`、`/settings`、`/admin` 未登录跳转登录页（页面内再做服务端校验） |
| 付费接口示例 | `src/app/api/credits/spend/route.ts` | 先扣积分再执行付费操作 |
| **AI 配置** | `src/config/ai.ts` | 每个功能的模型、积分价格、输入上限 |
| **AI 调用** | `src/lib/ai/providers.ts` | 文本流式（OpenAI 兼容 / OpenRouter）、图片（fal.ai）、图生视频（fal.ai 队列）、无 key 时 mock |
| **AI 扣费** | `src/lib/ai/billing.ts` | 先扣积分 → 调模型 → 失败自动退款，每次调用记录在 generation 表 |
| **AI 视频任务** | `src/lib/ai/video.ts` | 异步：提交任务 → 轮询或 fal 回调同步状态 → 完成发邮件；失败或 20 分钟超时自动退款 |
| AI 接口 | `/api/ai/text`（流式）、`/api/ai/image`、`/api/ai/video`、`/api/ai/generations/[id]` | 登录、输入校验、限流由 `src/lib/ai/guard.ts` 统一处理；视频只接受用户自己上传的图片 |
| fal 回调 | `/api/webhooks/fal` | 地址带签名；只当作「去查一下」的信号，结果以自己用 key 查到的为准 |
| AI 工作台 | `/studio` | 前端调用示例：流式文本、生图、图生视频（刷新页面后会接着查未完成的任务）、上传 |
| **防刷** | `src/lib/abuse.ts`、`src/lib/rate-limit.ts` | Turnstile 人机验证（注册 / 登录 / 发验证码 / 找回密码）、按 IP / 用户限流（存数据库，无需 Redis）、拦截临时邮箱 |
| **管理后台** | `/admin` | 概览（待处理 + 核心指标）、用户（封禁、手动调积分）、交易、订阅、退款审核、异常与对账、定时任务、支付日志；非管理员访问返回 404（见下方「后台怎么分工」） |
| **网页退款** | `src/lib/payments/refunds.ts`、`src/config/refunds.ts` | 用户在用户中心申请，金额按未用积分算，提交时冻结积分并定下金额；管理员在 `/admin/refunds` 批准后按那一笔付款去平台退（见下方「网页退款」） |
| **文件上传** | `src/lib/storage.ts`、`/api/upload` | 浏览器直传 R2（预签名 URL）；本地存 `.data/uploads` |
| **积分流水** | `/admin/credits`、`src/lib/admin-activity.ts` | 全站每一笔积分变动（只读），带汇总和用户持有余额 |
| **AI 调用记录** | `/admin/ai`、`src/lib/admin-activity.ts` | 调用量、成功率、耗时、失败原因、卡住的任务 |
| **系统检查** | `/admin/system`、`src/lib/system-check.ts` | 哪些配置缺失或有误、迁移有没有跑；只显示变量名，不调用外部平台 |
| **错误监控** | `src/instrumentation.ts`、`src/instrumentation-client.ts`、`src/lib/monitoring.ts`、`src/lib/monitoring-scrub.ts` | 可选 Sentry，没配 DSN 不加载；上报未捕获错误、任务失败、回调处理出错，AI 失败记为 warning，发送前去掉敏感信息 |
| **Newsletter** | `/newsletter`、`/admin/newsletter`、任务 `newsletter.send` | 双重确认订阅、一键退订、纯文本群发、分批投递；线上需要 Resend |
| **文档** | `src/content/docs` | `/docs` 站点的中英文 MDX 页面 |
| **单元测试** | `tests/`、`npm test` | 积分和退款计算、积分流水、监控脱敏 |

## 上线清单

1. 数据库：在 [Neon](https://neon.tech) 建库 → `DATABASE_URL` 填**连接池**地址（主机名带 `-pooler`），`DATABASE_URL_UNPOOLED` 填直连地址 → `npm run db:migrate`
2. `BETTER_AUTH_SECRET`（`openssl rand -base64 32`）、`BETTER_AUTH_URL`、`NEXT_PUBLIC_SITE_URL`
3. 支付三选一：
   - **Creem**（国内个人推荐）：建产品 → `CREEM_PRODUCT_*`、`CREEM_API_KEY`、webhook 指向 `/api/webhooks/creem` → `CREEM_WEBHOOK_SECRET`，开启 `checkout.completed`、`subscription.paid`、`subscription.active`、`subscription.trialing`、`subscription.scheduled_cancel`、`subscription.canceled`、`subscription.expired`、`subscription.past_due`、`subscription.unpaid`、`subscription.paused`、`refund.created`、`dispute.created`（最后两个用于退款、拒付扣回积分）
   - **Stripe**（需境外主体）：建价格 → `STRIPE_PRICE_*`、`STRIPE_SECRET_KEY`、webhook 指向 `/api/webhooks/stripe`，订阅 `checkout.session.completed`、`invoice.paid`、`customer.subscription.updated`、`customer.subscription.deleted`、`charge.refunded`、`charge.dispute.created`、`charge.dispute.closed`
   - **Waffo Pancake**（MoR）：控制台建产品 → `WAFFO_PRODUCT_*`；`WAFFO_MERCHANT_ID` + `WAFFO_PRIVATE_KEY`（测试、生产各一把 API Key）；
     webhook 在 设置 → Webhooks 添加 `/api/webhooks/waffo`（测试、生产各一条），勾选 `order.completed`、`subscription.activated`、`subscription.payment_succeeded`、`subscription.renewed`、`subscription.recovered`、`subscription.canceling`、`subscription.uncanceled`、`subscription.canceled`、`subscription.past_due`、`refund.succeeded`、`refund.failed`；
     **`WAFFO_STORE_ID` 必填**（webhook 只接受这个店铺的事件）；上线前把产品**发布到生产**、`WAFFO_TEST_MODE=false`
   - 设置 `PAYMENT_PROVIDER=creem`、`stripe` 或 `waffo`
4. **邮件（必须，否则注册收不到验证码）**：Resend 验证域名 → `RESEND_API_KEY`、`EMAIL_FROM`
5. AI：`AI_API_KEY`（OpenRouter）、`FAL_KEY`；按模型成本调整 `src/config/ai.ts` 里的积分价格
   - 视频：`AI_VIDEO_MODEL`（默认 Seedance 2.5 图生视频）；换模型先到 fal 模型页核对输入字段，时长、清晰度在 `extraInput` 里改
   - 第一次接真实 key 后，先自己生成一条走通，再看 fal 后台的单条成本，按成本至少 3 倍定积分价
   - fal 返回的视频地址在 fal 的存储上，要长期保留就转存到 R2
6. **防刷（开放注册前必须配置）**：Turnstile 两个密钥；限流默认值已适合线上
7. 管理员：`ADMIN_EMAILS` 填你的邮箱，然后用 Google / GitHub 登录（或用邮箱注册并输入验证码）；未验证的邮箱不算管理员。上线后到 `/admin` 看一眼用户列表，确认没有陌生的管理员
   （支付出问题的提醒邮件也发到这里）
8. **定时任务**：设 `CRON_SECRET`（`openssl rand -hex 32`），再选一种「时钟」（详见下面「定时任务」）：
   Vercel 上 `vercel.json` 已配好每天调用一次 `/api/cron/tick`；要更及时，配好仓库里的 GitHub Actions 工作流（每 10 分钟）；
   自己的服务器 / Docker 设 `CRON_MODE=internal`。上线后到 `/admin/jobs` 看「调度器正常」
9. 文件上传：R2 的 5 个变量，并给桶配置 CORS
10. 可选：Google / GitHub 登录（两个变量都配了才显示按钮；本地开发没配 Google 时，登录页会显示一条只在开发环境出现的提示）
    - Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID（Web application）
    - Authorized redirect URIs：`http://localhost:3000/api/auth/callback/google` 和 `https://你的域名/api/auth/callback/google`
    - 填 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，`BETTER_AUTH_URL` 设成当前访问地址，重启服务
    - OAuth 同意屏幕在 Testing 状态只有测试用户能登录，上线前点 Publish
    - GitHub 同理：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`，回调 `/api/auth/callback/github`

全部环境变量见 `.env.example`。

## 支付安全（改支付代码前先读）

「伪造充值回调」是这类站最常见的被薅方式。模板里的规则，改代码时不要破坏：

| 规则 | 在哪里 |
| --- | --- |
| 回调必须先用原始请求体验签，验签失败直接拒绝；没配密钥也直接拒绝 | `src/app/api/webhooks/*` |
| Waffo 全平台共用签名密钥：验签之外还要校验 `storeId` 是自己的店铺，以及 `mode` 是当前环境 | `webhooks/waffo` |
| 发多少积分只看我们数据库里订单的方案，回调里的金额、方案、用户字段只用来找订单 | `fulfillOrder`、`webhooks/waffo` |
| 订单必须属于发来回调的通道 | `fulfillOrder(orderId, provider)` |
| 积分发放带 refId 去重，回调重放不会重复加 | `grantCredits` |
| 支付成功跳回的 `?paid=` 本身不能当成「已付款」：只对自己的、还在 pending 的订单去支付平台查一次，平台说付了才补单 | `dashboard`、`reconcileOnReturn` |
| 回调可能丢：主动查单、定时补单、每日对账都走和回调同一个幂等入口、同一个 refId，回调晚到、重复跑都只发一次 | `src/lib/payments/reconcile.ts` |
| 调支付平台接口一律有超时（默认 15 秒）；只重试重放安全的请求（查询、带幂等键的建单 / 退款） | `src/lib/payments/http.ts`、Stripe SDK `maxNetworkRetries` |
| 订阅状态按平台事件时间取最新：重推、乱序到达的旧事件不改状态（积分照常按付款幂等发放） | `upsertSubscription`、`updateSubscriptionStatus`（`statusEventAt`） |
| 模拟支付、默认密钥只在本机开发可用（NODE_ENV 不是 production **且**站点地址是 localhost） | `src/lib/env.ts` |
| 管理员要求邮箱已验证，防止抢注管理员邮箱 | `src/lib/admin.ts` |
| 用户改资料改不了 `credits`、`role`（`input: false`） | `src/lib/auth.ts` |
| 退款、拒付按「当初发放的那一笔」扣回积分：部分退款按比例，累计不超过当初发的数量；余额不够也照扣（负数 = 冻结付费功能）；Stripe 拒付赢了再还 | `clawbackGrant`、`restoreClawback` |
| 订阅按期发积分的 refId 要能对应到「那一笔付款」（`stripe_<账单号>`、`creem_tx_<交易号>`、`waffo_<支付号>`），否则退款时找不到要扣哪一笔 | 各通道 webhook |
| 当期订阅款全额退回（退款或拒付）→ Pro 立即结束（订阅状态 `refunded`，Dashboard 显示 Free），不等支付平台到期：三家平台退款都不会自动结束订阅。部分退款、退的是更早的月份都保留 Pro；只有新一期付款成功或拒付赢回能恢复，平台后续的状态通知、重推的旧扣款通知都改不回来 | `syncRefundedSubscription`、`keepRefunded` |
| 退款 / 拒付对不上发放记录时打 `[clawback] … not found` 告警，不会静默放过 | `clawbackGrant` |

Waffo 文档里没有单独的拒付事件；如果遇到拒付，按控制台的通知到 `/admin/users` 用户详情里手动扣积分。

## 后台怎么分工

按「要不要人动手」分层，同一份信息只在一个地方处理：

| 层 | 在哪 | 看什么 |
| --- | --- | --- |
| 推送 | 铃铛、邮件（`ADMIN_EMAILS`） | 新开了问题、新的退款申请、定时任务失败 —— 只在「新出现」时提醒一次 |
| 待处理 | `/admin` 概览顶部 | 现在有几件事要人管：退款待审核、要到平台手动退的退款、错误级问题、拒付、失败的定时任务、调度器停了、配置错误；提醒级问题和今天失败的 AI 调用单列。全部为 0 显示「一切正常」 |
| 处理 | `/admin/refunds`、`/admin/reconciliation`（异常与对账）、`/admin/payments`（交易）、`/admin/jobs` | 具体的列表和操作 |
| 排查 | `/admin/payment-log`（支付日志） | 一笔交易 / 一个用户的完整经过 |
| 运营 | `/admin/credits`（积分流水）、`/admin/ai`（AI 调用） | 全站积分增减和持有余额；调用量、成功率、耗时、失败原因、卡住的任务 |
| 上线检查 | `/admin/system`（系统检查） | 哪些配置没填、填错、迁移没跑；只显示变量名，不显示值，也不调用外部平台，所以 key 是否有效仍要真实走一遍 |

所有列表（含用户详情的各标签页、每日对账报表）工具栏第一行是日期范围：起止日期（点开是两个月的日历，react-day-picker）+ 快捷按钮
（全部时间、今天、昨天、近 7 天、近 30 天、本月、上月），按 UTC 日期、含首尾两天，和表格里显示的时间同一个时区。

- **默认范围**：流水类列表（交易的到账和结账单、支付日志、定时任务运行历史、每日对账报表）默认近 7 天；
  要处理的队列和实体（用户、订阅、退款、问题表、用户详情）默认全部时间，免得概览「待处理」和侧栏角标的数字在列表里对不上。
  有搜索词时默认不限日期，按单号、邮箱查老记录不会被 7 天挡住
- **网址**：快捷按钮写相对范围 `?range=last7`（明天打开就是明天的近 7 天），日历里选的写 `?from=2026-10-01&to=2026-10-31`，
  选「全部时间」写 `range=all`。搜索、筛选、日期、分页都在网址里，复制链接给别人看到的是同一页；默认每页 10 条。规则在 `src/lib/table.ts` 的 `resolveDates`，
  服务端查询和工具栏显示共用
- 问题表、登录会话按「这段时间里出现过」算（首次发现在结束前、最近一次在开始后）
- 下拉框和日期浮层用 Floating UI 定位：挂在 body 上不会被面板裁掉，下面放不下就往上弹

- **交易**（`/admin/payments`）：「到账」= 每一笔真实收到的钱（`payment` 表，含续费、退款、拒付状态）；「结账单」= 用户发起的每次支付（`order` 表，含没付、过期的）。
  一次性购买两边都有，续费只在到账，放弃的支付只在结账单
- **异常与对账**（`/admin/reconciliation`）：问题表（`ledger_issue`，规则在 `src/lib/issues.ts`）+ 每日对账报表。每个问题有状态（待处理 / 已解决 / 忽略），
  按 key 去重。状态类问题（余额对不上、退款失败……）条件消失自动解决；事件类问题（回调出错、回调被拒、漏单）发生了开一个、管理员关，
  回调出错那次平台重试成功会自动解决。漏单、回调被拒、查单失败按通道汇总成一条，不是一笔一条

| 问题 | 级别 | 从哪来 |
| --- | --- | --- |
| `webhook_error` 回调处理出错 | 错误 | 支付检查（每 10 分钟）：最近 7 天 `outcome=error` 的回调，同一个平台事件只算一个 |
| `refund_failed` 退款失败 | 错误 | 支付检查：处于失败状态的退款申请 |
| `missed_webhook` 回调没到 | 提醒 | 支付检查：24 小时内有靠对账补上的单（钱已补上，要查 webhook 配置） |
| `webhook_rejected` 回调被拒 | 提醒 | 支付检查：签名对但不是本站的回调（有人伪造，或密钥配错） |
| `reconcile_failed` 查单失败 | 提醒 | 支付检查：24 小时内查平台失败 3 次以上 |
| 余额对不上、付了款没发积分、退多了 | 错误 | 账务检查（每天） |
| 退款卡住、余额为负 | 提醒 | 账务检查 |

## 支付日志（排查用）

`/admin/payment-log`（只有管理员）：支付流程里每件事都记在 `payment_event` 表，只追加不修改，字段故意冗余，不用再去支付平台后台对账。

- **记什么**：下单（`checkout_created`，含标价、优惠码、平台收银台 id）、被拒的优惠码（`promo_dropped`）、每条验签通过的回调
  （`paid` / `subscription_started` / `period_paid` / `trial_paid` / `refunded` / `dispute_opened` / `dispute_won` / `subscription_status` …，
  别人店铺的、环境不符的、处理出错的也记，结果分 `ok` / `ignored` / `rejected` / `error`）、网页退款的申请 / 批准 / 拒绝 / 用户撤销 / 撤回冻结
- **每行带**：邮箱、我们的订单号和付款 id、平台的订单 / 付款 / 订阅 / 退款 / 事件 id、标价 / 折扣 / 实付 / 退款金额、优惠码、
  积分变化和变化后的余额、一句人话说明、平台原始数据（截断 8KB）
- **付款汇总**（`payment` 表）：一行看全一笔钱 —— 标价、折扣、实付、累计已退、发了多少积分、是否试用、状态（paid / partially_refunded / refunded / disputed）
- **要处理的不在这里看**：出错 / 被拒的回调、漏单、退款失败由支付检查归纳进问题表，在「异常与对账」处理；日志里「只看问题」筛选还能看到原始记录。
  交易页的到账列表标出 over-refunded、disputed、trial、free credits、折扣
- **查一笔**：搜邮箱或任一 id（`ord_…`、`PAY_…`、`pi_…`、`in_…`、`sub_…`、`REF_…`、事件 id），按时间正序就是完整流转。
  同样的数据也能用 `GET /api/admin/payments?q=` 拿 JSON
- 验签失败的请求不记库（谁都能往回调地址乱发，记库会被刷爆），只打日志

## 支付对账与提醒（回调丢了怎么办）

支付平台的回调是「至少推一次」，但不保证一定送到：地址配错、签名密钥换了、服务器宕机、平台重试次数用完，钱收了积分却没发。
所以不能只等回调，模板做了三道补救，补单全部走和回调相同的幂等入口、相同的 refId，回调晚到也只发一次：

| 时机 | 做什么 | 流水里记 |
| --- | --- | --- |
| 用户付完跳回 `/dashboard?paid=订单号` | 订单还是 pending 就去平台查一次（同一订单 10 秒内只查一次，页面最多等 5 秒，平台慢就先显示「处理中」） | `reconciled`（回调比人慢，正常） |
| 定时任务 `task=pending` | 下单超过 10 分钟还 pending 的订单逐个去平台查：付了补单；收银台过期或 24 小时没付标记 failed | `missed_webhook`（算问题）/ `order_expired` |
| 定时任务 `task=reconcile`（每天） | 拉平台最近 48 小时的付款、退款，和本地比，漏掉的续费补发积分、漏掉的退款补扣；本地有效 / 欠费的订阅逐个核对状态（取消、欠费、恢复的回调丢了） | `missed_webhook` |

- **查什么**：Stripe 收银台会话 / 订阅 / 账单 / `invoices.list` / `refunds.list`；Waffo GraphQL（只读：`onetimeOrders` / `subscriptionOrders` 按 `orderMerchantExternalId`、`payments`、`refunds`）；
  Creem `GET /v1/checkouts`、`GET /v1/subscriptions`（Creem 没有按时间拉付款 / 退款的接口，续费、退款的对账只能靠回调）
- **提醒**：每次定时任务跑完做一遍支付检查（见上面「后台怎么分工」的问题表），新开的问题在铃铛里提醒、邮件发给 `ADMIN_EMAILS`，
  同一个问题只提醒一次；被拒的优惠码只记日志，不算问题
- **旧事件不回滚**：订阅表的 `status_event_at` 记着最近采用的事件时间，更早的状态事件（重推、乱序）只记流水（`ignored`, stale event）不改状态；
  对账改过的状态也记一个时间点，之后晚到的旧回调改不回去
- **怎么跑**：这两个是定时任务 `payments.pending`（每 10 分钟）和 `payments.reconcile`（每天），见下面「定时任务」。
  老接口 `GET /api/cron/payments?task=pending|reconcile|all` 保留兼容，同样记进运行历史

## 定时任务

任务在 `src/lib/jobs/registry.ts` 里用代码登记（名字、默认频率、超时、要做的事），相当于 Spring 的 `@Scheduled`。
后台 `/admin/jobs` 可以改频率（cron，UTC）、开关、立即运行，看每次运行的结果、耗时、日志；失败会通知管理员。

| 任务 | 默认频率 | 做什么 |
| --- | --- | --- |
| `payments.pending` | 每 10 分钟 | 查漏单：没收到付款回调的订单去平台查，付了补单；再做一遍支付检查 |
| `payments.reconcile` | 每天 03:17 | 支付对账：拉平台最近 48 小时的付款、退款，漏掉的补上，核对订阅状态；再做一遍支付检查 |
| `ledger.check` | 每天 03:20 | 账务检查：余额和流水是否一致、付了款没发积分、退多了、退款卡住、余额为负，再复查支付异常 → `/admin/reconciliation` |
| `ai.sweep` | 每 10 分钟 | 检查没人再查询的 AI 任务：已完成的视频结单，超时或中途退出的退积分 |
| `newsletter.send` | 每 10 分钟 | 发送进行中 Newsletter 群发的下一批 |
| `cleanup` | 每天 03:25 | 清理过期的限流记录、验证码、旧通知、旧运行记录 |

**时钟（谁来触发）**：站点只提供 `/api/cron/tick`，每次被调用就执行所有到点的任务；用数据库锁保证多台服务器、多个触发同时到时一个任务只跑一份。
- Vercel：`vercel.json` 已配每天 03:30 调用一次（Hobby 只能每天一次，所有任务每天跑一遍；Pro 可以改成 `*/10 * * * *`）
- GitHub Actions：仓库里的 `.github/workflows/cron.yml` 每 10 分钟调用一次。在仓库设置里加变量 `SITE_URL`、密钥 `CRON_SECRET` 即启用
- 自己的服务器 / Docker（`next start` 常驻）：设 `CRON_MODE=internal`，服务启动时开进程内定时器（`src/instrumentation.ts`），每分钟检查一次
- 其他：任何定时服务（cron-job.org、crontab、Cloudflare Cron Triggers）请求 `curl -H "Authorization: Bearer $CRON_SECRET" https://你的域名/api/cron/tick`

后台会显示最近一次被触发的时间；超过预期间隔（`CRON_TICK_MINUTES`，`CRON_MODE=internal` 时默认 1，否则默认 1440）太久没被触发，页面会提示，线上还会通知管理员。

## 优惠码与试用

- **优惠码链接**：发推广时用 `/pricing?code=XXX`。价格页提示「结账时会自动填入优惠码」，未登录先去登录也会把码带回来；
  码先在支付平台后台建好，我们只校验格式（3–32 位字母、数字、`-`），能不能用、打多少折都由平台判断，**码不能用就当没有，照常付款**
  - Stripe：查到有效的推广码就直接用上；查不到就照常在收银台自己填（`allow_promotion_codes`）
  - Waffo：`promotionCode` 预填、`allowPromotionCodes: true` 打开输入框（用 API Key 建的收银台**默认不显示**优惠码输入框，哪怕店铺有券）；码不能用建单时 409，自动去掉码重建
  - Creem：`discount_code` 预填，码不能用自动去掉重建
- **优惠码只影响付多少钱，积分照发**（便宜买积分）。退款按实付金额折算。Stripe 100% 折扣（`no_payment_required`）照常发货，没收钱的订单不能退款
- **试用**：在支付平台的产品上开（Waffo 产品 `metadata.trialDays` + 可选 `trialAmount`；Stripe / Creem 的 trial 设置）。
  试用期那一期的标价（折扣前）低于正价，只发方案里的 `trialCredits`（默认 0），第一次正式扣款才发整期积分 ——
  否则开个试用、把积分用光、到期前取消就能白拿。识别依据：Waffo `listPrice.listTotal`、Stripe 账单 `subtotal`、Creem `last_transaction.amount` 或订阅状态 `trialing`；
  回调里拿不到标价时，实付 0 也按试用算（宁可少发）

## 网页退款

用户在用户中心的订单（积分包）或套餐卡片（订阅当期）上点「申请退款」，管理员在 `/admin` → Refund requests 审核。
不用到支付平台后台找交易、填金额：每笔付款到账时回调已经把平台侧的付款 id 和实付金额记进 `payment` 表。

- **金额按未用积分算，不按时间**：退款 = 实付 × 未用积分 ÷ 这笔发的积分，向下取整到分；扣回的积分和平台退款回调扣的一致。
  发放之后用掉的积分保守地算在这一笔头上，且不超过当前余额
- **规则**在 `src/config/refunds.ts`：积分包 14 天内、订阅只退当期、这笔积分用掉超过 50% 不能自助申请、每个账号自助退款 1 次、低于 $0.50 不受理。
  不符合规则的不显示申请入口（找客服，管理员到平台后台退，积分照样按回调扣回）
- **提交**：用户一提交，可退的积分就冻结（从余额里扣出），金额也在这时定下；全额退当期订阅时 Pro 立即暂停。待审核的申请用户可以撤销，积分立即还回（Pro 恢复），之后还能重新申请
- **批准**：按提交时定下的金额，不重新计算，直接到平台：
  - Stripe：直接按 PaymentIntent 退款（订阅账单先找到它的 PaymentIntent），订阅同时关掉自动续费
  - Waffo：用商户 API Key 建退款工单（绑定这笔付款、金额已填好，申请号做幂等键），商户建的工单**自动通过**、直接进入退款；订阅同时取消续费。
    SDK 0.26 没封装这个商户接口（它的 `customer.createRefundTicket` 是买家侧的，Waffo 已不让买家建工单，会 403），模板里自己签名调 REST；
    接口实际要 `requestedAmount: { amount, currency }`（文档写的是 `amount`）。私钥写成不带头尾的 base64 也行，签名前会补成 PEM
  - Creem：没有退款接口，后台会显示交易号和金额，到 Creem 后台手动退
- **到账**：平台退款回调里冻结的积分算作扣回（不重复扣），平台实际退多了 / 少了就补扣 / 还回，申请变成 refunded；当期订阅全额退款时 Pro 立即结束
- **没退成**（Waffo 工单被拒等）：后台点 Release，冻结的积分还给用户；Waffo 发来 `refund.failed` 时自动撤回。
  批准时平台接口报错也会自动撤回，申请变成 failed，修好配置后在后台点 **Retry** 重新批准
- 管理员直接在平台后台退了款、或批准时报错但平台其实受理了：回调到达时同一笔付款上没结的申请（待审核 / 处理中 / 失败）一并结掉，积分照常扣回，不会再批准一次重复退钱
- 本地联调 Waffo：webhook 地址要填完整的 `<隧道地址>/api/webhooks/waffo`。只填域名的话回调打到首页也返回 200，Waffo 当成功不重试，订单一直 pending

## 改了表结构之后

```bash
npm run db:generate   # 生成迁移 SQL（drizzle/ 目录，要提交到 git）
npm run db:migrate    # 应用到线上数据库；本地 PGlite 会在启动时自动应用
```
