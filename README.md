<div align="center">

# AI SaaS Template

**A production-minded Next.js starter for paid AI tools: auth, credits, payments, AI generation and a real admin console.**

Clone it, run it with zero configuration, then replace the demo tool with your product.

[![CI](https://github.com/cdt2019/ai-saas-template/actions/workflows/ci.yml/badge.svg)](https://github.com/cdt2019/ai-saas-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-f97316.svg)](LICENSE)
![Next.js 16](https://img.shields.io/badge/Next.js-16-111?logo=next.js)
![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)

English · [简体中文](README.zh-CN.md)

![Admin overview](docs/screenshots/admin-overview.png)

</div>

> Screenshots use fictional demo data. "Acme" is a placeholder brand you replace in `src/config/site.ts`.

## Why this template

Most starters stop at "checkout works". The hard part of charging for AI comes after that: lost webhooks, forged callbacks, refunds on credits that were already spent, model calls that fail after you charged, and no way to see what went wrong. This template handles those cases.

- **Runs with no accounts or keys.** An embedded Postgres, mock payments, mock AI and terminal emails let you click through the whole product locally.
- **Credits you can audit.** Every change is an idempotent ledger entry, reconciled against balances by a daily job.
- **Payments built for failure.** Signature checks, replay protection, active polling for missed webhooks, daily reconciliation, refunds and disputes.
- **An admin you can operate from.** It opens with what needs a human today, not a wall of charts.

## Features

| Area | What you get |
| --- | --- |
| **Auth** | Email and password with 6-digit email verification, code-based password reset, Google and GitHub sign-in, Better Auth sessions |
| **Abuse protection** | Cloudflare Turnstile, database-backed rate limits (no Redis), disposable email blocking, admin takeover protection |
| **Payments** | Stripe, Creem and Waffo behind one interface, plus a mock provider. One-time packs, subscriptions, coupons and trials |
| **Payment reliability** | Verified and idempotent webhooks, timeouts, safe retries, polling for lost webhooks, daily reconciliation, out-of-order event handling |
| **Credits** | Idempotent ledger, concurrency-safe spending, signup bonus, low-balance alerts, proportional clawback on refunds and disputes |
| **Refunds** | Self-service requests with configurable rules, credits held on submit, admin review, refund through the original provider |
| **AI** | Streaming text (any OpenAI-compatible API, OpenRouter by default), images and async image-to-video (fal.ai), charged up front and refunded on failure |
| **Admin** | Action center, users, payments, subscriptions, refunds, issues and reconciliation, credit ledger, AI calls, newsletter, scheduled jobs, payment log, system check |
| **Scheduled jobs** | Code-registered jobs with locks, timeouts, run history and failure alerts. Trigger from Vercel Cron, GitHub Actions or an in-process timer |
| **Notifications** | In-app bell and toasts, transactional email (Resend), live credit balance across tabs |
| **Newsletter** | Double opt-in, one-click unsubscribe (RFC 8058), campaigns sent in batches, subscriber filters and CSV export |
| **Documentation** | Built-in MDX docs with sidebar, search, table of contents and previous/next links, in English and Chinese |
| **Error monitoring** | Optional Sentry for server, browser, jobs, webhooks and AI failures, with personal data stripped before sending |
| **Product UI** | Landing page, pricing, AI studio, dashboard, settings, blog (MDX), dark and light themes, responsive layouts |
| **SEO and i18n** | English and Chinese routes, metadata, canonical and hreflang, sitemap, robots, JSON-LD |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/landing.png" alt="Landing page"><br><sub><b>Landing page</b></sub></td>
    <td width="50%"><img src="docs/screenshots/pricing.png" alt="Pricing"><br><sub><b>Pricing: packs and subscriptions</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/signup.png" alt="Sign up"><br><sub><b>Sign up</b></sub></td>
    <td><img src="docs/screenshots/dashboard.png" alt="User dashboard"><br><sub><b>User dashboard</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/studio.png" alt="AI studio"><br><sub><b>AI studio: text, image, video</b></sub></td>
    <td><img src="docs/screenshots/settings-usage.png" alt="Usage settings"><br><sub><b>Usage and credit history</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/admin-overview-light.png" alt="Admin overview, light theme"><br><sub><b>Admin overview (light theme)</b></sub></td>
    <td><img src="docs/screenshots/admin-users.png" alt="Users"><br><sub><b>Users</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/admin-payments.png" alt="Payments"><br><sub><b>Payments with date and status filters</b></sub></td>
    <td><img src="docs/screenshots/admin-refunds.png" alt="Refunds"><br><sub><b>Refund review</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/admin-issues.png" alt="Issues and reconciliation"><br><sub><b>Issues and daily reconciliation</b></sub></td>
    <td><img src="docs/screenshots/admin-credits.png" alt="Credit ledger"><br><sub><b>Credit ledger</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/admin-ai.png" alt="AI calls"><br><sub><b>AI calls: success rate, latency, errors</b></sub></td>
    <td><img src="docs/screenshots/admin-jobs.png" alt="Scheduled jobs"><br><sub><b>Scheduled jobs</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/admin-newsletter.png" alt="Newsletter"><br><sub><b>Newsletter campaigns and subscribers</b></sub></td>
    <td><img src="docs/screenshots/admin-system.png" alt="System check"><br><sub><b>System check before go-live</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/docs.png" alt="Documentation"><br><sub><b>Built-in documentation</b></sub></td>
    <td></td>
  </tr>
</table>

## Quick start

Requires **Node.js 22**.

```bash
git clone https://github.com/cdt2019/ai-saas-template.git
```

```bash
cd ai-saas-template
```

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:3000>. With no configuration:

| Service | Local fallback |
| --- | --- |
| Database | PGlite (embedded Postgres in `.data/`), migrated on startup |
| Payments | Mock checkout that grants credits |
| AI | Mock results. Include `__fail__` in a prompt to test the automatic refund |
| Email | Printed to the terminal and saved to `.data/dev-mail/` |
| Uploads | Local disk |

**To open the admin**, create `.env.local` with your email, restart, then sign up with that address and enter the code from the terminal:

```bash
ADMIN_EMAILS=you@example.com
```

Then visit <http://localhost:3000/admin>.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, Floating UI, react-day-picker, Lucide |
| Auth | Better Auth |
| Database | PostgreSQL (Neon, Supabase or self-hosted) with Drizzle ORM, PGlite for local development |
| Payments | Stripe, Creem, Waffo |
| AI | OpenRouter or any OpenAI-compatible API, fal.ai |
| Email and storage | Resend, Cloudflare R2 |
| Bot protection | Cloudflare Turnstile |
| Monitoring | Sentry (optional) |
| Testing | Vitest, end-to-end scripts |

## Project structure

```text
src/
├── app/[lang]/
│   ├── (site)/        Landing, pricing, docs, blog, newsletter, legal pages
│   ├── (auth)/        Login, sign-up, password reset
│   └── (app)/         Dashboard, studio, settings, admin
├── app/api/           Auth, checkout, webhooks, AI, admin, cron
├── components/        UI, account, admin and auth components
├── config/            Site, pricing, AI features, refund rules
├── content/           Docs and blog posts (MDX)
├── db/                Drizzle schema and connection
├── i18n/              English and Chinese dictionaries
└── lib/
    ├── payments/      Providers, fulfillment, refunds, reconciliation
    ├── ai/            Providers, billing, async video
    ├── jobs/          Scheduler, runner, job registry
    └── ...            Auth, credits, notifications, issues, system check
drizzle/               SQL migrations
tests/                 Unit tests (credits, refunds, data scrubbing)
scripts/               End-to-end smoke and payment tests
docs/                  Operations guide and screenshots
```

## Make it yours

1. **Brand:** name, URL and contact in `src/config/site.ts`, colors at the top of `src/app/globals.css`, logo in `src/components/Logo.tsx`.
2. **Copy:** `src/i18n/dictionaries/en.ts` and `zh.ts`. Have the privacy policy and terms reviewed for your business.
3. **Pricing:** `src/config/pricing.ts`.
4. **AI features:** models, credit costs and limits in `src/config/ai.ts`. Price credits at 3x or more of your model cost.
5. **Your product:** replace the demo in `src/app/[lang]/(app)/studio` and `src/tool/`.

## Deploy

The template works on Vercel or any Node.js host.

1. Create a Postgres database. Use a **pooled** connection for `DATABASE_URL` and a direct one for `DATABASE_URL_UNPOOLED`.
2. Copy `.env.example` to your host's environment and fill in what you use. At minimum:

   | Variable | Purpose |
   | --- | --- |
   | `NEXT_PUBLIC_SITE_URL`, `BETTER_AUTH_URL` | Your public URL |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
   | `DATABASE_URL` | Postgres connection |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Verification emails |
   | `PAYMENT_PROVIDER` and its keys | `stripe`, `creem` or `waffo` |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `ADMIN_EMAILS` | Who can open `/admin` |

3. Run migrations:

   ```bash
   npm run db:migrate
   ```

4. Point your provider's webhook to `https://your-domain/api/webhooks/<provider>`.
5. Open **`/admin/system`**. It flags missing or unsafe configuration, unapplied migrations and the exact webhook URL.
6. Run a complete purchase and refund in your provider's sandbox before accepting real payments.

Read the docs at `/docs` once the app is running. Provider setup, job scheduling and payment rules are in the [operations guide](docs/guide.md).

## Testing

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
bash scripts/smoke-test.sh http://localhost:3000
```

`npm test` covers the credit ledger and refund math, including idempotency and concurrent spending, on an in-memory Postgres. The payment suite runs against a local fake provider and needs no accounts. It covers fulfillment, subscriptions, partial and full refunds, disputes, reconciliation, and attacks such as forged webhooks, replays and admin takeover. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run it for each provider.

## Project status

This is a young project. Please read this before relying on it:

| Part | Verified with |
| --- | --- |
| Auth, credits, admin, jobs | End-to-end tests against a local server |
| Waffo | Fake provider tests **and** a real sandbox run: purchases, subscriptions, coupons, trials, refunds |
| Stripe, Creem | Fake provider tests only, not yet run against their real APIs |
| OpenRouter, fal.ai, R2 | Mock providers only, not yet run with real keys |
| Newsletter | End-to-end tests with local email capture, not yet sent through Resend |
| Sentry | Builds and stays inactive without a DSN; not yet run with a real project |
| Production | Not yet deployed to a live production site |

Test the flows you depend on with your own provider accounts before going live.

## Roadmap

- [ ] Verify Stripe and Creem against their sandboxes
- [ ] Verify real AI and storage providers
- [ ] Verify Resend delivery and Sentry reporting
- [ ] First production deployment
- [ ] Translate code comments to English

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Use it for personal and commercial projects. The software is provided as is, and you are responsible for your own payment, tax and legal compliance.
