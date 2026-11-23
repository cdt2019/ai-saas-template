# Security Policy

This template handles sign-in, payments and credits, so security reports are very welcome.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/cdt2019/ai-saas-template/security/advisories/new).

Include what you can of the following:

- the affected file, route or flow
- steps to reproduce, or a proof of concept
- the impact, for example forged credits, account takeover or data exposure

This is a community project with no paid support, so response times are best effort. Please give it a reasonable time to ship a fix before disclosing publicly.

## Supported versions

Only the latest commit on `master` receives fixes. If you forked the template, watch this repository and apply security fixes to your copy.

## In scope

- Webhook signature checks, forged or replayed payment events
- Credit grants, refunds, clawbacks and race conditions
- Authentication, session handling and admin access
- Secrets or personal data exposed by the app

Vulnerabilities in dependencies should go to their maintainers. If one affects this template in a specific way, tell us too.

## If you deploy this template

- Never commit `.env*` files. Only `.env.example` belongs in the repository.
- Set your own `BETTER_AUTH_SECRET` and `CRON_SECRET`.
- Open `/admin/system` after deploying. It lists missing or unsafe configuration.
- Test the full payment flow in your provider's sandbox before taking real money.
- Keep `next` and `better-auth` up to date.
