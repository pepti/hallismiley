# Halli Smiley — Portfolio Site

Personal portfolio for Halli (Icelandic carpenter + computer scientist). Showcases joinery/timber-framing work and software engineering work to two distinct audiences.

- **Live:** https://www.hallismiley.is
- **Owner:** Halli (solo project)
- **Deploy target:** Azure App Service (Linux container) — NOT Railway

## Stack (authoritative — confirm against package.json before changing)

- Node.js 20, Express 4.18, CommonJS (`"type": "commonjs"`)
- PostgreSQL 16 via `pg`
- Vanilla JS SPA frontend (MVC + component pattern). **No React/Vue/Svelte — keep it framework-free.**
- Auth: **Lucia v3** + RS256 JWT (access + refresh). RSA keys in `keys/` locally, env vars `PRIVATE_KEY`/`PUBLIC_KEY` in prod.
- Security: helmet, csrf-csrf, hpp, express-rate-limit, sanitize-html, cors
- Observability: pino + pino-http (logs), Sentry (errors), prom-client (metrics)
- Email: Resend (primary) + nodemailer (fallback)
- Payments: Stripe
- Tests: Jest (integration, hits real Postgres) + Playwright (e2e)
- Lint: ESLint 8 + Husky pre-commit
- Deploy: GitHub Actions → ACR → Azure App Service. Migrations run automatically at container start.

## Architecture invariants (do not change without discussing)

1. **Vanilla JS frontend.** No SPA framework, no bundler-required syntax. ES modules + plain DOM.
2. **CommonJS server.** Don't convert to ESM piecemeal.
3. **Lucia owns sessions; JWT for stateless API auth.** Don't bolt on a second session system.
4. **Migrations are sequential SQL files** under `server/scripts/migrations/` (or wherever `migrate.js` reads). Never edit a migration that has been applied to prod — always add a new one.
5. **All routes return a consistent error envelope** (see `docs/API.md` "Error formats"). Don't invent new error shapes.
6. **Integration tests hit a real Postgres** — do not mock `pg`.

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

## Where things live

```
server/         Express app, routes, middleware, db, scripts
server/scripts/ migrate.js, bootstrap.js, seed.js, setup-admin.js
public/         Vanilla JS SPA — HTML, CSS, ES module JS
e2e/            Playwright specs
docs/           API.md (REST reference), DEPLOYMENT.md (Azure runbook)
keys/           RSA keypair (gitignored, local dev only)
data/           seed data / fixtures
scripts/        repo-level helper scripts (e.g. check-i18n-keys.js)
```

## Commands you'll reach for

```bash
npm run dev              # nodemon
npm run migrate          # run migrations
npm run seed             # seed sample data
npm test                 # jest (needs Postgres)
npm run test:e2e         # playwright
npm run lint
npm run check:i18n
```

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
- `SECURITY_AUDIT_2026-04-16.md` — security posture
- `PRE_LAUNCH_AUDIT.md` — launch checklist

## Slash commands available

- `/security-check` — review pending changes against this project's security invariants
- `/pre-deploy` — pre-deploy verification (CI green, migrations safe, env vars, rollback plan)
- `/migration-new <name>` — scaffold a new sequential SQL migration

## Things that have bitten us before

<!-- Append one bullet per real incident. Format:
- YYYY-MM-DD — short symptom — root cause — fix (link to RUNBOOK / commit if applicable)
-->
