# Halli Smiley — Portfolio Site

Personal portfolio for Halli (Icelandic carpenter + computer scientist). Showcases joinery/timber-framing work and software engineering work to two distinct audiences.

- **Live:** https://www.hallismiley.is
- **Owner:** Halli (solo project)
- **Deploy target:** Azure App Service (Linux container) — NOT Railway

## Stack (authoritative — confirm against package.json before changing)

- Node 24 LTS (digest-pinned image; Node 26 is Current-not-LTS — never let dependabot major-bump the base image alone), Express 5 (catch-alls are `app.get('/{*splat}', …)` — keep the braces), CommonJS (`"type": "commonjs"`)
- PostgreSQL 16 via `pg`
- Vanilla JS SPA frontend (MVC + component pattern). **No React/Vue/Svelte — keep it framework-free.**
- Auth: **Lucia v3** sessions. (The old "RS256 JWT (access + refresh)" line was boilerplate — no JWT code exists in this tree; verified 2026-08-22, the same finding icelandicstore made on its copy of the claim.)
- Security: helmet, csrf-csrf, hpp, express-rate-limit, sanitize-html, cors
- Observability: pino + pino-http (logs), Sentry (errors), prom-client (metrics)
- Email: Resend only (`server/services/emailService.js`; no transport when `RESEND_API_KEY` is unset — a loud no-op, not a fallback)
- Payments: Stripe
- Tests: Jest (integration, hits real Postgres) + Playwright (e2e)
- Lint: ESLint 10 (flat config, `eslint.config.js`) + Husky pre-commit
- Deploy: GitHub Actions → ACR → Azure App Service. Migrations run automatically at container start.

## Architecture invariants (do not change without discussing)

1. **Vanilla JS frontend.** No SPA framework, no bundler-required syntax. ES modules + plain DOM.
2. **CommonJS server.** Don't convert to ESM piecemeal.
3. **Lucia owns sessions.** Don't bolt on a second session system. (The JWT half of this line was boilerplate — see the auth note above.)
4. **Migrations are entries appended to the array in `server/config/schema.js`** (applied by `npm run migrate` / at boot, one transaction per migration, advisory-locked against concurrent booters). Never edit a migration that has been applied to prod — always add a new one.
5. **All routes return a consistent error envelope** (see `docs/API.md` "Error formats"). Don't invent new error shapes.
6. **Integration tests hit a real Postgres** — do not mock `pg`.
7. **The books are double-entry, and the ledger is the only source of totals.** Every
   figure in `/admin/books/*` is derived from posted `journal_lines`. Do not add a
   second set of totals — the VSK return, the P&L and the balance sheet cannot
   disagree because there is nothing else to read. Anything that moves money posts a
   balanced entry, enforced by a trigger.
8. **Posted accounting history is append-only** (Reglugerð 505/2013 gr. 9). Corrections
   are reversals or credit notes, never UPDATEs. This is enforced by triggers, so code
   that tries will fail rather than succeed quietly. See `docs/BOOKKEEPING-SYSTEM.md`.

## Security non-negotiables

- CSRF is enforced via `csrf-csrf` on all state-changing routes. Don't disable per-route without leaving a comment + linking the reason.
- Rate limits live where they are applied — `server/app.js` (global + writes), `server/routes/*.js` (auth, contact, party, shop, MCP, system) and `server/middleware/booksLimiters.js` — tighten, don't loosen.
- Helmet CSP is configured; if a feature needs a new script/style source, extend the CSP allowlist explicitly rather than relaxing it globally.
- `keys/` stays gitignored; nothing in the code reads it (a vestige of the JWT boilerplate this repo never had).
- `.env` is never committed; only `.env.example` is tracked.
- Admin credentials live in the `users` table (Scrypt hash, oslo via Lucia); there is no `ADMIN_PASSWORD_HASH` env var. Create or reset with `node server/scripts/setup-admin.js <username> <email> <password>`, or `npm run bootstrap` with `ADMIN_USERNAME` + `ADMIN_EMAIL` + `ADMIN_PASSWORD` all set.
- Full security posture: see `SECURE_SDLC.md` (the 2026-04-16 audit is a frozen point-in-time record).

## Conventions

- Logger: `pino`. Never `console.log` in committed code outside of one-off scripts.
- Error handling: throw typed errors → central error middleware formats response.
- File names: kebab-case for files, PascalCase for component classes, camelCase for functions.
- i18n: keys live in JSON locale files; run `npm run check:i18n` before pushing translation-touching changes.
- Tests live under `tests/unit/` and `tests/integration/` — Jest collects ONLY those two trees (`jest.config.js` `testMatch`), so a test next to its source or under `__tests__/` never runs. E2E specs under `e2e/`.
- `data/` (gitignored, absent on fresh clones) holds local seed data and fixtures.

## Deployment summary

Push to `main` (any file — CI has no paths filter, so a docs-only merge deploys too) → CI (lint + `npm audit` + `check:i18n` + Jest + Playwright + docker build) → on green, `Deploy to Azure` workflow auto-runs via `workflow_run` → image pushed to `hallismileyacr.azurecr.io/hallismiley:<sha>` (also `:latest`, `:sha-<sha>`) → App Service container ref updated → restart. Migrations run at container startup. A red Deploy run after red CI is the designed alert (`docs/DEPLOYMENT.md` §6).

Emergency manual deploy:
```bash
gh workflow run "Deploy to Azure" --ref main
```

Full deployment guide: `docs/DEPLOYMENT.md`. Operational runbook: `RUNBOOK.md`.

## Reference docs (read these instead of asking me to re-explain)

- `docs/ARCHITECTURE.md` — **start a feature request here**: every domain with its routes,
  controllers, models, services, views, tests, migrations and the rules that must hold.
  `tests/unit/architectureIndex.test.js` fails CI when the index and the tree disagree.
- `docs/HISTORY.md` — dated incidents and programmes, indexed; the *why* behind the rules.
- `README.md` — setup, env vars, backup strategy
- `RUNBOOK.md` — operational procedures
- `CHANGELOG.md` — version history
- `docs/API.md` — REST API reference (auth, projects, contact, error formats, rate limits)
- `docs/DEPLOYMENT.md` — Azure provisioning, OIDC, custom domain
- `docs/BOOKKEEPING-SYSTEM.md` — the books: ledger, VAT, payroll, till, and why each
  guard exists. **Read this before touching anything under `/admin/books`.**
- `docs/ACCOUNTANT-QUESTIONS.md` — the open questions only an accountant can answer,
  with the current behaviour stated for each. Two of them affect real figures.
- `SECURE_SDLC.md` — the security process (living)
- `SECURITY_AUDIT_2026-04-16.md` — frozen point-in-time record (banner says what is since fixed)
- `PRE_LAUNCH_AUDIT.md` — frozen point-in-time record (2026-03-30)

## Domain map — start a feature request here

Full per-domain index: **`docs/ARCHITECTURE.md`**. `tests/unit/architectureIndex.test.js`
fails CI when a routes/controller/model/service/view file has no row there, when a cited
migration is not in `schema.js` (or an applied one is not cited), or when a link does not
resolve — the failure message names the missing row.

| # | Domain |
|---|---|
| 1 | [Auth, users, RBAC, 2FA](docs/ARCHITECTURE.md#1-auth-users-rbac-2fa) |
| 2 | [Admin shell, UI kit](docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-ui-kit) |
| 3 | [Public site, SSR meta, SEO](docs/ARCHITECTURE.md#3-public-site--home-contact-legal-ssr-meta-sitemap-seo) |
| 4 | [Themes](docs/ARCHITECTURE.md#4-themes) |
| 5 | [i18n](docs/ARCHITECTURE.md#5-i18n) |
| 6 | [Shop](docs/ARCHITECTURE.md#6-shop--storefront-cart-checkout-orders-products-collections-bins-discounts-customers-sales) |
| 7 | [News, projects, party, bio, Aron13](docs/ARCHITECTURE.md#7-news-projects-party-bio-aron13) |
| 8 | [Monitoring](docs/ARCHITECTURE.md#8-monitoring--event-logs-metrics-analytics-health) |
| 9 | [Self-update](docs/ARCHITECTURE.md#9-self-update) |
| 10 | [MCP connector](docs/ARCHITECTURE.md#10-mcp-connector) |
| 11 | [Change requests](docs/ARCHITECTURE.md#11-change-requests--in-app-feedback) |
| 12 | [Content, settings, background](docs/ARCHITECTURE.md#12-content-settings-background) |
| 13 | [Uploads, media](docs/ARCHITECTURE.md#13-uploads-and-media) |
| 14 | [Email](docs/ARCHITECTURE.md#14-email) |
| 15 | [Bookkeeping](docs/ARCHITECTURE.md#15-bookkeeping--invoices-expenses-ar-vsk-bank-ledger-payroll-pos) |
| 16 | [Infrastructure](docs/ARCHITECTURE.md#16-infrastructure-and-cross-cutting) |

**Recording a change (since 2026-09-22)**: an incident or programme write-up goes to
`docs/HISTORY.md` (dated section with an `<a id>` anchor + index row); the rule it establishes
goes to the domain's "Rules that must hold" in `docs/ARCHITECTURE.md`, linking back. This
file changes only when a *rule* changes. The former "Things that have bitten us before" list
is `docs/HISTORY.md` now; the lesson each one taught is in the domain it belongs to.
