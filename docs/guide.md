# Development and Operations Guide

中文版: [guide.zh-CN.md](guide.zh-CN.md)

For the project overview and quick start, see the [README](../README.md). This guide covers where each module lives, how to go live, and the rules for payments, refunds, reconciliation and scheduled jobs.

## Modules at a glance

| Module | Files | Notes |
| --- | --- | --- |
| Database tables | `src/db/schema.ts` | user / session / account / verification / credit_transaction / order / subscription |
| Database connection | `src/db/index.ts` | Connects to Postgres when `DATABASE_URL` is set, otherwise uses PGlite. Production must use a pooled connection string; a direct connection logs a warning |
| Sign-in and sign-up | `src/lib/auth.ts`, `src/components/auth/` | Email + password. After sign-up, users must enter a 6-digit email code before they can sign in (on by default, `AUTH_REQUIRE_EMAIL_VERIFICATION=false` turns it off; sign-up credits are granted only after verification). Password reset also uses a code. Google / GitHub shown only when configured |
| Credits | `src/lib/credits.ts` | `grantCredits` (idempotent) / `spendCredits` (concurrency-safe), sign-up bonus credits |
| Pricing plans | `src/config/pricing.ts` | One-time credit packs + subscriptions. Change prices only here. One-time packs are promoted by default (users of new-keyword and trending-topic sites mostly finish one job and leave) |
| Payments | `src/lib/payments/` | One shared interface with four implementations: Stripe / Creem / Waffo / mock. Fulfillment logic is in `fulfill.ts` |
| Webhook | `src/app/api/webhooks/{stripe,creem,waffo}` | Signature verification + idempotent fulfillment |
| Subscription management | `/api/billing/portal` | Stripe Billing Portal and the Waffo customer portal (button shown only when `WAFFO_STORE_ID` is set) |
| Pages | `/login` `/signup` `/forgot-password` `/pricing` `/dashboard` `/settings` | All localized |
| Route protection | `src/proxy.ts` | Redirects signed-out visitors from `/dashboard`, `/settings` and `/admin` to the login page (pages also check on the server) |
| Paid API example | `src/app/api/credits/spend/route.ts` | Deducts credits first, then performs the paid operation |
| **AI config** | `src/config/ai.ts` | Model, credit price and input limits for each feature |
| **AI calls** | `src/lib/ai/providers.ts` | Streaming text (OpenAI-compatible / OpenRouter), images (fal.ai), image-to-video (fal.ai queue), mock when no key is set |
| **AI billing** | `src/lib/ai/billing.ts` | Deduct credits → call the model → refund automatically on failure. Every call is recorded in the generation table |
| **AI video jobs** | `src/lib/ai/video.ts` | Async: submit job → sync status by polling or fal webhook → email on completion. Automatic refund on failure or after a 20-minute timeout |
| AI APIs | `/api/ai/text` (streaming), `/api/ai/image`, `/api/ai/video`, `/api/ai/generations/[id]` | Auth, input validation and rate limiting are handled in `src/lib/ai/guard.ts`. Video accepts only images the user uploaded |
| fal webhook | `/api/webhooks/fal` | The URL is signed. It is treated only as a "go check" signal; the result we fetch with our own key is what counts |
| AI Studio | `/studio` | Frontend examples: streaming text, image generation, image-to-video (resumes unfinished jobs after a page refresh), uploads |
| **Abuse protection** | `src/lib/abuse.ts`, `src/lib/rate-limit.ts` | Turnstile bot check (sign-up / sign-in / send code / password reset), rate limits per IP / user (stored in the database, no Redis needed), disposable email blocking |
| **Admin** | `/admin` | Overview (Needs attention + key metrics), Users (ban, adjust credits manually), Payments, Subscriptions, Refunds review, Issues & reconciliation, Scheduled jobs, Payment log. Non-admins get a 404 (see "How the admin is organized" below) |
| **In-app refunds** | `src/lib/payments/refunds.ts`, `src/config/refunds.ts` | Users request a refund from their account area, with the amount based on unused credits. Credits are held and the amount is fixed on submit. After an admin approves it at `/admin/refunds`, that specific payment is refunded through the provider (see "In-app refunds" below) |
| **File uploads** | `src/lib/storage.ts`, `/api/upload` | Direct browser upload to R2 (presigned URL); stored in `.data/uploads` locally |
| **Credit ledger** | `/admin/credits`, `src/lib/admin-activity.ts` | Every credit movement site-wide, read-only, with totals and balances held |
| **AI call log** | `/admin/ai`, `src/lib/admin-activity.ts` | Call volume, success rate, duration, failure reasons and stuck jobs |
| **System check** | `/admin/system`, `src/lib/system-check.ts` | Missing or wrong settings and pending migrations. Shows variable names only and calls no external provider |
| **Error monitoring** | `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/lib/monitoring.ts`, `src/lib/monitoring-scrub.ts` | Optional Sentry. Nothing loads without a DSN. Reports uncaught errors, failed jobs, webhook processing errors, and AI failures as warnings, with sensitive data removed |
| **Newsletter** | `/newsletter`, `/admin/newsletter`, job `newsletter.send` | Double opt-in, one-click unsubscribe, plain-text campaigns sent in batches. Requires Resend in production |
| **Docs** | `src/content/docs` | English and Chinese MDX pages for the `/docs` site |
| **Unit tests** | `tests/`, `npm test` | Credit and refund math, the credit ledger, and monitoring scrubbing |

## Launch checklist

1. Database: create a database on [Neon](https://neon.tech) → set `DATABASE_URL` to the **pooled** connection string (hostname contains `-pooler`) and `DATABASE_URL_UNPOOLED` to the direct one → `npm run db:migrate`
2. `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL`
3. Pick one payment provider:
   - **Creem** (works well for individual sellers): create products → `CREEM_PRODUCT_*`, `CREEM_API_KEY`, point the webhook at `/api/webhooks/creem` → `CREEM_WEBHOOK_SECRET`, and enable `checkout.completed`, `subscription.paid`, `subscription.active`, `subscription.trialing`, `subscription.scheduled_cancel`, `subscription.canceled`, `subscription.expired`, `subscription.past_due`, `subscription.unpaid`, `subscription.paused`, `refund.created`, `dispute.created` (the last two claw back credits on refunds and disputes)
   - **Stripe** (requires a business entity in a Stripe-supported country): create prices → `STRIPE_PRICE_*`, `STRIPE_SECRET_KEY`, point the webhook at `/api/webhooks/stripe`, and subscribe to `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
   - **Waffo Pancake** (MoR): create products in the console → `WAFFO_PRODUCT_*`; `WAFFO_MERCHANT_ID` + `WAFFO_PRIVATE_KEY` (one API key each for test and production);
     under Settings → Webhooks, add `/api/webhooks/waffo` (one entry each for test and production) and select `order.completed`, `subscription.activated`, `subscription.payment_succeeded`, `subscription.renewed`, `subscription.recovered`, `subscription.canceling`, `subscription.uncanceled`, `subscription.canceled`, `subscription.past_due`, `refund.succeeded`, `refund.failed`;
     **`WAFFO_STORE_ID` is required** (the webhook accepts events only from this store). Before launch, **publish the products to production** and set `WAFFO_TEST_MODE=false`
   - Set `PAYMENT_PROVIDER=creem`, `stripe` or `waffo`
4. **Email (required, otherwise sign-up codes never arrive)**: verify your domain in Resend → `RESEND_API_KEY`, `EMAIL_FROM`
5. AI: `AI_API_KEY` (OpenRouter), `FAL_KEY`; adjust the credit prices in `src/config/ai.ts` to match model costs
   - Video: `AI_VIDEO_MODEL` (defaults to Seedance 2.5 image-to-video). Before switching models, check the input fields on the fal model page; change duration and resolution in `extraInput`
   - The first time you use a real key, run one generation yourself end to end, check its cost in the fal dashboard, and set the credit price to at least 3x that cost
   - Video URLs returned by fal live on fal's storage. Copy them to R2 if you need to keep them long term
6. **Abuse protection (required before opening sign-ups)**: the two Turnstile keys. The default rate limits are suitable for production
7. Admin: put your email in `ADMIN_EMAILS`, then sign in with Google / GitHub (or sign up by email and enter the code). Unverified emails do not count as admins. After launch, check the user list in `/admin` to confirm there are no unknown admins
   (payment alert emails are also sent to these addresses)
8. **Scheduled jobs**: set `CRON_SECRET` (`openssl rand -hex 32`), then choose a "clock" (see "Scheduled jobs" below):
   on Vercel, `vercel.json` already calls `/api/cron/tick` once a day; for more frequent runs, set up the GitHub Actions workflow in the repo (every 10 minutes);
   on your own server / Docker, set `CRON_MODE=internal`. After launch, confirm `/admin/jobs` shows "Scheduler is running"
9. File uploads: the 5 R2 variables, plus CORS on the bucket
10. Optional: Google / GitHub sign-in (the button appears only when both variables are set; in local development without Google configured, the login page shows a development-only hint)
    - Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application)
    - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` and `https://your-domain/api/auth/callback/google`
    - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `BETTER_AUTH_URL` to the address you are using, and restart the server
    - While the OAuth consent screen is in Testing, only test users can sign in. Click Publish before launch
    - GitHub works the same way: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, callback `/api/auth/callback/github`

See `.env.example` for all environment variables.

## Payment safety (read before changing payment code)

Forged top-up webhooks are the most common way sites like this get exploited. Do not break these rules when changing the code:

| Rule | Where |
| --- | --- |
| Webhooks must verify the signature against the raw request body first. Reject on failure, and also reject when no secret is configured | `src/app/api/webhooks/*` |
| Waffo uses one signing key across its whole platform: besides the signature, also verify that `storeId` is your store and `mode` matches the current environment | `webhooks/waffo` |
| The credits granted come only from the plan on the order in our database. Amount, plan and user fields in the webhook are used only to find the order | `fulfillOrder`, `webhooks/waffo` |
| An order must belong to the provider that sent the webhook | `fulfillOrder(orderId, provider)` |
| Credit grants are deduplicated by refId, so replayed webhooks never add credits twice | `grantCredits` |
| The `?paid=` return parameter does not by itself mean "paid": only for the user's own order that is still pending, query the provider once, and fulfill only if the provider says it was paid | `dashboard`, `reconcileOnReturn` |
| Webhooks can get lost: active lookups, scheduled recovery and daily reconciliation all use the same idempotent entry point and the same refId as the webhook, so late webhooks and repeat runs grant credits only once | `src/lib/payments/reconcile.ts` |
| Every provider API call has a timeout (15 seconds by default). Retry only requests that are safe to replay (queries, and order creation / refunds with an idempotency key) | `src/lib/payments/http.ts`, Stripe SDK `maxNetworkRetries` |
| Subscription status follows the latest provider event time: redelivered or out-of-order old events do not change status (credits are still granted idempotently per payment) | `upsertSubscription`, `updateSubscriptionStatus` (`statusEventAt`) |
| Mock payments and default secrets work only in local development (NODE_ENV is not production **and** the site URL is localhost) | `src/lib/env.ts` |
| Admins must have a verified email, so nobody can take over an admin address by registering it first | `src/lib/admin.ts` |
| Users cannot change `credits` or `role` through profile updates (`input: false`) | `src/lib/auth.ts` |
| Refunds and disputes claw back credits from the original grant: partial refunds are proportional, and the total never exceeds what was originally granted. The clawback applies even if the balance is too low (a negative balance freezes paid features). Credits are returned if a Stripe dispute is won | `clawbackGrant`, `restoreClawback` |
| The refId of each subscription-period credit grant must map to that specific payment (`stripe_<invoice_id>`, `creem_tx_<transaction_id>`, `waffo_<payment_id>`), otherwise a refund cannot find which grant to claw back | Each provider's webhook |
| When the current period's subscription payment is fully returned (refund or dispute) → Pro ends immediately (subscription status `refunded`, Dashboard shows Free) without waiting for the provider's period end, because none of the three providers ends the subscription automatically on refund. Partial refunds and refunds of earlier months keep Pro. Only a new successful period payment or a won dispute restores it; later provider status notifications and redelivered old charge notifications cannot change it back | `syncRefundedSubscription`, `keepRefunded` |
| When a refund or dispute cannot be matched to a grant, a `[clawback] … not found` warning is logged; it is never silently ignored | `clawbackGrant` |

Waffo's docs do not list a separate dispute event. If a dispute happens, follow the console notification and deduct credits manually on the user's detail page under `/admin/users`.

## How the admin is organized

Layers are split by whether a person needs to act, and each piece of information is handled in only one place:

| Layer | Where | What it shows |
| --- | --- | --- |
| Push | Bell, email (`ADMIN_EMAILS`) | Newly opened issues, new refund requests, failed scheduled jobs. Each alerts once, only when it first appears |
| Needs attention | Top of the `/admin` Overview | How many things need a person right now: refunds to review, refunds to issue manually at the provider, error-level issues, disputes, failed scheduled jobs, a stopped scheduler, configuration errors. Warning-level issues and today's failed AI calls are listed separately. When everything is 0, it shows "All clear." |
| Act | `/admin/refunds`, `/admin/reconciliation` (Issues & reconciliation), `/admin/payments` (Payments), `/admin/jobs` | The specific lists and actions |
| Investigate | `/admin/payment-log` (Payment log) | The full history of one transaction / one user |
| Operations | `/admin/credits` (Credit ledger), `/admin/ai` (AI calls) | Site-wide credit movements and balances held; call volume, success rate, duration, failure reasons, stuck jobs |
| Launch check | `/admin/system` (System check) | Which settings are missing or wrong and whether migrations have run. It shows variable names only, never values, and calls no external provider, so you still need a real end-to-end run to confirm keys are valid |

The first toolbar row of every list (including the tabs on the user detail page and the daily reconciliation report) is a date range: start and end dates (opens a two-month calendar, react-day-picker) + preset buttons
(All time, Today, Yesterday, Last 7 days, Last 30 days, This month, Last month). Dates are UTC and include both ends, the same time zone as the times shown in the tables.

- **Default range**: log-style lists (Received and Checkouts under Payments, Payment log, Scheduled jobs run history, daily reconciliation report) default to the last 7 days;
  work queues and entities (Users, Subscriptions, Refunds, the issues table, user details) default to All time, so the Needs attention and sidebar badge counts always match the lists.
  With a search term, the date filter is off by default, so looking up an old record by ID or email isn't blocked by the 7-day window
- **URLs**: preset buttons write a relative range, `?range=last7` (opened tomorrow, it means tomorrow's last 7 days). Calendar picks write `?from=2026-10-01&to=2026-10-31`,
  and All time writes `range=all`. Search, filters, dates and pagination all live in the URL, so a copied link shows the same page; the default is 10 rows per page. The rules are in `resolveDates` in `src/lib/table.ts`,
  shared by server queries and the toolbar display
- The issues table and login sessions count as in range if they occurred during the period (first seen before the end, last seen after the start)
- Dropdowns and date popovers are positioned with Floating UI: they mount on body so panels don't clip them, and flip upward when there isn't room below

- **Payments** (`/admin/payments`): **Received** = every payment actually collected (`payment` table, including renewals and refund / dispute status); **Checkouts** = every payment a user started (`order` table, including unpaid and expired ones).
  One-time purchases appear in both, renewals only in Received, abandoned payments only in Checkouts
- **Issues & reconciliation** (`/admin/reconciliation`): the issues table (`ledger_issue`, rules in `src/lib/issues.ts`) + the daily reconciliation report. Each issue has a status (Open / Resolved / Ignored)
  and is deduplicated by key. State issues (balance mismatch, failed refund, and so on) resolve automatically when the condition goes away. Event issues (webhook error, webhook rejected, missed webhook) open when they happen and are closed by an admin;
  a webhook error resolves automatically if the provider's retry succeeds. Missed webhooks, rejected webhooks and failed provider queries are rolled up into one issue per provider, not one per payment

| Issue | Level | Source |
| --- | --- | --- |
| `webhook_error` Webhook failed | Error | Payment check (every 10 minutes): webhooks with `outcome=error` in the last 7 days, counting each provider event once |
| `refund_failed` Refund failed | Error | Payment check: refund requests in a failed state |
| `missed_webhook` Webhooks missing | Warning | Payment check: orders recovered by reconciliation in the last 24 hours (the payment has been filled in; check the webhook configuration) |
| `webhook_rejected` Webhooks rejected | Warning | Payment check: webhooks with a valid signature that aren't for this site (someone forging them, or a misconfigured key) |
| `reconcile_failed` Provider queries failing | Warning | Payment check: provider queries failed 3 or more times in 24 hours |
| Balance doesn't match history / Paid, no credits / Refunded more than paid | Error | Ledger check (daily) |
| Refund stuck / Negative balance | Warning | Ledger check |

## Payment log (for troubleshooting)

`/admin/payment-log` (admins only): every step of the payment flow is recorded in the `payment_event` table. It is append-only and intentionally denormalized, so you don't need to cross-check in the provider's dashboard.

- **What is recorded**: checkout creation (`checkout_created`, with list price, promo code and provider checkout ID), rejected promo codes (`promo_dropped`), every webhook that passes signature verification
  (`paid` / `subscription_started` / `period_paid` / `trial_paid` / `refunded` / `dispute_opened` / `dispute_won` / `subscription_status` …,
  including those for other stores, the wrong environment, or that failed processing, with outcomes `ok` / `ignored` / `rejected` / `error`), and in-app refund requests / approvals / rejections / cancellations / releases
- **Each row includes**: email, our order ID and payment ID, the provider's order / payment / subscription / refund / event IDs, list price / discount / amount paid / refund amount, promo code,
  credit change and resulting balance, a plain-language description, and the provider's raw payload (truncated to 8KB)
- **Payment summary** (`payment` table): one row for each payment with list price, discount, amount paid, total refunded, credits granted, whether it was a trial, and status (paid / partially_refunded / refunded / disputed)
- **Things to act on are not handled here**: failed / rejected webhooks, missed webhooks and failed refunds are summarized into the issues table by the payment check and handled in Issues & reconciliation. The log's "Problems only" filter still shows the raw records.
  The Received list on the Payments page marks over-refunded, disputed, trial, free credits and discounts
- **Looking up a payment**: search by email or any ID (`ord_…`, `PAY_…`, `pi_…`, `in_…`, `sub_…`, `REF_…`, event ID). Sorted oldest first, this is the complete flow.
  The same data is available as JSON from `GET /api/admin/payments?q=`
- Requests that fail signature verification are not stored (anyone can post to a webhook URL, and storing them would let attackers flood the database); they are only logged

## Payment reconciliation and alerts (when webhooks go missing)

Provider webhooks are "at least once", but delivery isn't guaranteed: a wrong URL, a rotated signing secret, server downtime or exhausted provider retries can mean the money arrived but no credits were granted.
So you can't rely on webhooks alone. The template has three recovery layers, all using the same idempotent entry point and refId as the webhook, so a late webhook still grants credits only once:

| When | What it does | Logged as |
| --- | --- | --- |
| User returns to `/dashboard?paid=<order-id>` after paying | If the order is still pending, query the provider once (at most once per order every 10 seconds; the page waits up to 5 seconds and shows "Confirming your payment…" if the provider is slow) | `reconciled` (normal: the user beat the webhook) |
| Scheduled job `task=pending` | Queries the provider for each order still pending more than 10 minutes after creation: fulfills paid orders; marks orders failed if checkout expired or they remain unpaid after 24 hours | `missed_webhook` (counts as an issue) / `order_expired` |
| Scheduled job `task=reconcile` (daily) | Pulls the provider's payments and refunds from the last 48 hours and compares them with local records, granting credits for missed renewals and clawing back for missed refunds; checks the status of each locally active / past-due subscription (for lost cancel, past-due and recovery webhooks) | `missed_webhook` |

- **What it queries**: Stripe checkout sessions / subscriptions / invoices / `invoices.list` / `refunds.list`; Waffo GraphQL (read-only: `onetimeOrders` / `subscriptionOrders` by `orderMerchantExternalId`, `payments`, `refunds`);
  Creem `GET /v1/checkouts`, `GET /v1/subscriptions` (Creem has no API to list payments / refunds by time, so renewal and refund reconciliation relies on webhooks only)
- **Alerts**: a payment check runs after each scheduled job (see the issues table under "How the admin is organized" above). Newly opened issues appear in the bell and are emailed to `ADMIN_EMAILS`,
  once per issue. Rejected promo codes are only logged and do not count as issues
- **Old events don't roll back state**: `status_event_at` on the subscription table stores the time of the latest applied event. Older status events (redelivered or out of order) are only logged (`ignored`, stale event) and don't change status;
  status changes made by reconciliation also record a timestamp, so late old webhooks can't revert them
- **How it runs**: these are the scheduled jobs `payments.pending` (every 10 minutes) and `payments.reconcile` (daily); see "Scheduled jobs" below.
  The legacy endpoint `GET /api/cron/payments?task=pending|reconcile|all` remains for compatibility and is also recorded in run history

## Scheduled jobs

Jobs are registered in code in `src/lib/jobs/registry.ts` (name, default schedule, timeout, and what to run), similar to Spring's `@Scheduled`.
In the admin at `/admin/jobs` you can change the schedule (cron, UTC), turn jobs on or off, run one now, and see each run's result, duration and logs. Failures notify admins.

| Job | Default schedule | What it does |
| --- | --- | --- |
| `payments.pending` | Every 10 minutes | Finds missed payments: queries the provider for orders with no payment webhook and fulfills the paid ones, then runs the payment check |
| `payments.reconcile` | Daily at 03:17 | Payment reconciliation: pulls the provider's payments and refunds from the last 48 hours, fills in anything missed, and checks subscription status, then runs the payment check |
| `ledger.check` | Daily at 03:20 | Ledger check: balance vs. credit history, paid without credits, over-refunds, stuck refunds, negative balances, then rechecks payment issues → `/admin/reconciliation` |
| `ai.sweep` | Every 10 minutes | Checks AI jobs nobody is polling: finishes ready videos, refunds timed-out or interrupted calls |
| `newsletter.send` | Every 10 minutes | Sends the next batch of any newsletter campaign in progress |
| `cleanup` | Daily at 03:25 | Removes expired rate-limit records, verification codes, old notifications and old run records |

**The clock (what triggers jobs)**: the site only exposes `/api/cron/tick`. Each call runs all jobs that are due. A database lock ensures only one copy of a job runs, even with multiple servers or simultaneous triggers.
- Vercel: `vercel.json` already calls it once a day at 03:30 (Hobby allows only one run per day, so all jobs run daily; Pro can change this to `*/10 * * * *`)
- GitHub Actions: `.github/workflows/cron.yml` in the repo calls it every 10 minutes. To enable it, add the variable `SITE_URL` and the secret `CRON_SECRET` in the repo settings
- Your own server / Docker (long-running `next start`): set `CRON_MODE=internal`. An in-process timer starts with the server (`src/instrumentation.ts`) and checks once a minute
- Other: any cron service (cron-job.org, crontab, Cloudflare Cron Triggers) can request `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/tick`

The admin shows when the clock last fired. If it hasn't fired for well past the expected interval (`CRON_TICK_MINUTES`, default 1 with `CRON_MODE=internal`, otherwise 1440), the page shows a warning, and in production admins are also notified.

## Promo codes and trials

- **Promo links**: use `/pricing?code=XXX` for promotions. The pricing page shows "Code XXX will be applied at checkout.", and the code is preserved if the user has to sign in first.
  Create the code in the payment provider's dashboard first. We only validate the format (3–32 letters, digits or `-`); the provider decides whether it is valid and what discount applies. **If a code can't be used, it is treated as absent and payment continues normally**
  - Stripe: applies a valid promotion code directly; otherwise the user can enter one at checkout as usual (`allow_promotion_codes`)
  - Waffo: `promotionCode` prefills the code and `allowPromotionCodes: true` shows the input (checkouts created with an API key **hide** the promo code input by default, even if the store has coupons). An unusable code returns 409 at creation, and the checkout is recreated without it
  - Creem: `discount_code` prefills the code; an unusable code is removed and the checkout is recreated
- **Promo codes only change the price; credits are granted in full** (cheaper credits). Refunds are calculated from the amount actually paid. Stripe 100% discounts (`no_payment_required`) are fulfilled normally, and orders with no payment can't be refunded
- **Trials**: enable them on the provider's product (Waffo product `metadata.trialDays` + optional `trialAmount`; Stripe / Creem trial settings).
  When the trial period's list price (before discount) is below the regular price, only the plan's `trialCredits` are granted (default 0). The full period's credits are granted on the first real charge,
  otherwise someone could start a trial, use all the credits and cancel before it ends. Detection uses Waffo `listPrice.listTotal`, Stripe invoice `subtotal`, Creem `last_transaction.amount` or subscription status `trialing`;
  when the webhook has no list price, a payment of 0 also counts as a trial (better to grant too little)

## In-app refunds

Users click "Request a refund" on an order (credit pack) or plan card (current subscription period) in their account area, and admins review it at `/admin` → Refunds.
There's no need to find the transaction or enter an amount in the provider's dashboard: when each payment arrives, the webhook has already stored the provider's payment ID and the amount paid in the `payment` table.

- **The amount is based on unused credits, not time**: refund = amount paid × unused credits ÷ credits granted by this payment, rounded down to the cent. The credits clawed back match what the provider's refund webhook would claw back.
  Credits spent after the grant are conservatively counted against this payment, and the unused amount never exceeds the current balance
- **Rules** are in `src/config/refunds.ts`: credit packs within 14 days, subscriptions for the current period only, no self-service request if more than 50% of this payment's credits are used, 1 self-service refund per account, nothing below $0.50.
  Requests that don't qualify get no request button (they contact support, an admin refunds in the provider's dashboard, and credits are still clawed back by the webhook)
- **Submitting**: the refundable credits are held (taken out of the balance) as soon as the user submits, and the amount is fixed at that moment. A full refund request on the current subscription period pauses Pro right away. Users can cancel a pending request: the credits return immediately (and Pro resumes), and they can request again later
- **Approval**: uses the amount fixed at submission and does not recalculate, then goes to the provider:
  - Stripe: refunds directly by PaymentIntent (for subscription invoices, it finds the PaymentIntent first) and also turns off auto-renewal for subscriptions
  - Waffo: creates a refund ticket with the merchant API key (bound to this payment, amount prefilled, request ID as idempotency key). Merchant-created tickets are **approved automatically** and go straight to refund. Subscription renewal is also canceled.
    SDK 0.26 doesn't wrap this merchant endpoint (its `customer.createRefundTicket` is buyer-side, and Waffo no longer lets buyers create tickets, so it returns 403), so the template signs and calls the REST API itself.
    The endpoint actually requires `requestedAmount: { amount, currency }` (the docs say `amount`). The private key can be base64 without header and footer; it is converted to PEM before signing
  - Creem: has no refund API. The admin shows the transaction ID and amount, and you refund manually in the Creem dashboard
- **When the refund lands**: the credits held are counted as the clawback from the provider's refund webhook (not deducted twice). If the provider refunded more or less, the difference is clawed back or returned, and the request becomes refunded. A full refund of the current subscription period ends Pro immediately
- **If the refund doesn't go through** (a rejected Waffo ticket, etc.): click Release in the admin to return the held credits to the user. When Waffo sends `refund.failed`, this happens automatically.
  If the provider API errors during approval, the hold is also released automatically and the request becomes failed. After fixing the configuration, click **Retry** in the admin to approve it again
- If an admin refunds directly in the provider's dashboard, or approval reported an error but the provider actually accepted it: when the webhook arrives, any unsettled request on that payment (pending / processing / failed) is closed too, credits are clawed back as usual, and it can't be approved again to refund twice
- Testing Waffo locally: the webhook URL must be the full `<tunnel-url>/api/webhooks/waffo`. If you enter only the domain, the webhook hits the homepage and gets a 200, Waffo treats that as success and doesn't retry, and the order stays pending

## After changing the schema

```bash
npm run db:generate   # Generate migration SQL (in drizzle/, commit it to git)
npm run db:migrate    # Apply to the production database; local PGlite applies migrations automatically on startup
```
