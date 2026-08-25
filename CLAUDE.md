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
- Email: Resend (primary) + nodemailer (fallback)
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
- Rate limits live in `server/middleware/` (or similar) — tighten, don't loosen.
- Helmet CSP is configured; if a feature needs a new script/style source, extend the CSP allowlist explicitly rather than relaxing it globally.
- RSA keys: never commit. `keys/` is gitignored. Rotate independently per environment.
- `.env` is never committed; only `.env.example` is tracked.
- Admin password is stored as a bcrypt hash in `ADMIN_PASSWORD_HASH`. Generate via `node server/scripts/setup-admin.js`.
- Full security posture: see `SECURITY_AUDIT_2026-04-16.md` at repo root.

## Conventions

- Logger: `pino`. Never `console.log` in committed code outside of one-off scripts.
- Error handling: throw typed errors → central error middleware formats response.
- File names: kebab-case for files, PascalCase for component classes, camelCase for functions.
- i18n: keys live in JSON locale files; run `npm run check:i18n` before pushing translation-touching changes.
- Tests live alongside the code under test, or under `__tests__/`. E2E specs under `e2e/`.
- `data/` (gitignored, absent on fresh clones) holds local seed data and fixtures.

## Deployment summary

Push to `main` → CI (lint + `npm audit` + Jest + Playwright + docker build) → on green, `Deploy to Azure` workflow auto-runs via `workflow_run` → image pushed to `hallismileyacr.azurecr.io/hallismiley:<sha>` → App Service container ref updated → restart. Migrations run at container startup.

Emergency manual deploy:
```bash
gh workflow run "Deploy to Azure" --ref main
```

Full deployment guide: `docs/DEPLOYMENT.md`. Operational runbook: `RUNBOOK.md`.

## Reference docs (read these instead of asking me to re-explain)

- `README.md` — setup, env vars, backup strategy
- `RUNBOOK.md` — operational procedures
- `CHANGELOG.md` — version history
- `docs/API.md` — REST API reference (auth, projects, contact, error formats, rate limits)
- `docs/DEPLOYMENT.md` — Azure provisioning, OIDC, custom domain
- `docs/BOOKKEEPING-SYSTEM.md` — the books: ledger, VAT, payroll, till, and why each
  guard exists. **Read this before touching anything under `/admin/books`.**
- `docs/ACCOUNTANT-QUESTIONS.md` — the open questions only an accountant can answer,
  with the current behaviour stated for each. Two of them affect real figures.
- `SECURITY_AUDIT_2026-04-16.md` — security posture
- `PRE_LAUNCH_AUDIT.md` — launch checklist

## Things that have bitten us before

<!-- Append one bullet per real incident. Format:
- YYYY-MM-DD — short symptom — root cause — fix (link to RUNBOOK / commit if applicable)
-->

- 2026-08-07 — dev AR page 500s after a schema edit — migration 072 was edited AFTER the
  dev database had applied it, so the column existed in `schema.js` and not in Postgres —
  dropped the ~21 books tables and the `schema_migrations` rows, re-migrated. **Never edit
  an applied migration; add a new one.**
- 2026-08-07 — new payroll columns silently absent — migration 076 used `CREATE TABLE IF NOT
  EXISTS employees`, but 072 already created that table, so the statement was a no-op and the
  service queried columns that were never added — rewrote 076 as ALTERs on 072's tables.
  **Check whether a table already exists before declaring one.**
- 2026-08-07 — `journal_lines.vat_rate` NULL on every row ever written — `postEntry` prepared
  the value and left it out of the INSERT; nothing failed because the VSK return derives from
  each account's `vat_code` — added the column to both inserts.
- 2026-08-08 — payroll tax bands all started at 0 kr. — migration 072 seeded 2026 as UPPER
  bounds (`{"upTo":498122}`, how Skatturinn prints it) while the loader read LOWER bounds and
  defaulted a missing one to 0, collapsing the slicing so nearly the whole salary would have
  been taxed at the top rate — `normaliseBands()` now accepts either shape and refuses one
  that states neither. **Found by looking at the screen, not by a test.**
- 2026-08-07 — 100+ nondeterministic test failures across unrelated suites — two sessions
  shared `hallismiley_test`, which jest globalSetup DROPs — always set `TEST_DATABASE_URL` to
  a private database name.
- 2026-08-07 — `gh pr checks` reported green for a stale head — it was reading a merged PR's
  old commit — verify with `gh api repos/:owner/:repo/commits/$(git rev-parse HEAD)/check-runs`
  and require `total_count > 0`.
