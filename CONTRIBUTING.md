# Contributing

Thanks for helping improve this template. Bug reports, docs fixes and focused pull requests are all welcome.

## Set up

```bash
git clone https://github.com/cdt2019/ai-saas-template.git
cd ai-saas-template
npm install
npm run dev
```

No accounts or keys are needed: without configuration the app uses an embedded Postgres (PGlite), mock payments, mock AI, and prints emails to the terminal.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If you touch auth, credits or payments, run the end-to-end tests against a local dev server too:

```bash
bash scripts/smoke-test.sh http://localhost:3000
```

```bash
node scripts/payment-test.mjs setup stripe
```

Restart `npm run dev`, then:

```bash
node scripts/payment-test.mjs run http://localhost:3000
```

Repeat for `creem` and `waffo`, then remove the test configuration:

```bash
node scripts/payment-test.mjs cleanup
```

The smoke test creates many accounts, so raise `LIMIT_SIGNUP_PER_IP_HOUR` and `LIMIT_OTP_PER_IP_10MIN` in `.env.local` if the rate limiter blocks it.

## Guidelines

- Keep pull requests small and about one thing.
- Match the surrounding code: naming, comment density and structure.
- Put user-facing text in both `src/i18n/dictionaries/en.ts` and `zh.ts`.
- Schema changes need a migration: `npm run db:generate`.
- Read "Payment safety" in [docs/guide.md](docs/guide.md) before changing payment code. Webhooks must verify signatures, stay idempotent, and never trust amounts or user IDs from the callback.
- Never commit secrets, real customer data or `.env*` files.

Report security problems privately, as described in [SECURITY.md](SECURITY.md).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
