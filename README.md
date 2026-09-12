# Orange Smiley — company site (orangesmiley.is)

The public instance of **Orange Smiley ehf.**: the company site of an AI-driven
software agency serving Icelandic SMBs, and the seed of its customer portal.
Its product, **Rekstrarkerfið**, has its own site (`rekstrarkerfi.is`, sibling
repo `rekstrarkerfid`). This repo dogfoods the site factory: it was scaffolded
2026-08-09 from the HalliProjects base (`hallismiley` @ `562c637`) with every
base module kept — shop, bookkeeping, admin + RBAC, projects, news, party — and
the surfaces that do not fit the business hidden from nav, sitemap and search
but left functional (`server/config/publicSurface.js`).

`CLAUDE.md` is the authoritative project memory (conventions, every programme
that has landed, what is still Halli's to decide). `PLAN.md` is the build plan,
`ENHANCEMENTS.md` the proposal queue, `LESSONS.md` the lessons log,
`CHANGELOG.md` the release notes the promote workflow reads.

**There is no deployed instance yet** — see `docs/DEPLOYMENT.md`.

---

## Tech stack (read from the repo 2026-09-11)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js **24** (`Dockerfile` `node:24-alpine`, digest-pinned; `ci.yml` `node-version: 24` — the two move together) |
| Framework | Express **5** (`^5.2.1`, CommonJS; catch-alls are `'/{*splat}'`) |
| Database | PostgreSQL 16 via `pg`; migrations are the array in `server/config/schema.js`, applied at boot (chain ends `102_commission_settlement`) |
| Frontend | Vanilla JS SPA — ES modules, no framework, no bundler; three themes (`ember`/Glóð default, `classic`/Bjart, `midnight`/Miðnætti); IS is the visitor default locale, EN mirrors it |
| Auth | **Lucia v3 server-side sessions** (`auth_session` cookie), csrf-csrf double-submit, admin TOTP; no JWT layer |
| Email | Resend (`RESEND_API_KEY`); sender `EMAIL_FROM` |
| Payments | Stripe (shop checkout; the shop is a hidden surface here) |
| Security | helmet/CSP, hpp, express-rate-limit, sanitize-html, RBAC view ids (`server/auth/adminViews.js`), pino with secret scrubbing |
| Deployment | Docker image → Azure App Service via a **dispatch-only** GitHub workflow (nothing auto-deploys) |

---

## Local setup

```bash
git clone https://github.com/orange-smiley/orangesmiley.git
cd orangesmiley
npm install
cp .env.example .env      # then fill DATABASE_URL, ALLOWED_ORIGINS, CSRF_SECRET
createdb orangesmiley     # dev DB (postgres/postgres locally)
npm run migrate
npm run dev               # nodemon on http://localhost:3000
```

`setup.ps1` bundles these steps on Windows (its RSA-key step and its
`/strip-base` hint were removed 2026-09-12 — never run `/strip-base` on this
repo, CLAUDE.md). Detached dev server: `npm run dev:up` /
`dev:down` / `dev:status` (`scripts/dev-server.ps1`, reads `PORT` from `.env`).

First admin: `node server/scripts/setup-admin.js <username> <email> <password>`
(writes the user row directly with a scrypt hash), or `npm run bootstrap` with
all three of `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` set (with any of
them missing it migrates, creates no admin and exits 0). Admins then enrol in
TOTP from the profile.

Other scripts worth knowing: `npm run seed` (demo content), `seed:books`
(demo books, refuses in production), `books:fx` / `books:archive` /
`books:replay` (`RUNBOOK.md` → Bókhald), `market:import` (CLAUDE.md →
Markaður), `check:i18n` (run before pushing locale changes).

---

## Running tests

```bash
npm run lint
npm run check:i18n
npm run test:unit          # ~8 s, no database
npm run test:smoke         # auth + security + shop + contact, ~30 s
npm test                   # everything, 4 Jest workers with a database each
npm run test:e2e           # Playwright (one chromium project)
npm test -- --runInBand    # serial fallback for debugging cross-suite order
```

Integration tests need a reachable Postgres. The base test database is scoped
to the checked-out branch (`orangesmiley_<branch-slug>_test`, so parallel
worktrees never share one); `tests/globalSetup.js` migrates one template
(`…_tmpl_test`) and clones it per Jest worker (`…_w1_test` … `_w4_test`),
prints which base it chose, and `tests/globalTeardown.js` drops the set again
(`KEEP_TEST_DB=1` keeps it). Set `TEST_DATABASE_URL` to override the derivation
entirely — the name must end in `_test`. Orphans from killed runs:
`npm run test:db:clean`. Playwright uses its own per-branch
`orangesmiley_e2e_<branch>_test` (`e2e/lib/dbUrl.js`). Tiers, counts and what
CI runs: `docs/TESTING.md`.

---

## Environment variables

All variables are documented in `.env.example`. The ones the server refuses to
boot without (`server/server.js` `REQUIRED_ENV`):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | comma-separated CORS origins |
| `CSRF_SECRET` | 32+ random characters |
| `NODE_ENV` | `development` / `test` / `production` — `production` on every deployed stack |
| `RESEND_API_KEY` | required when `APP_ENV=production` |
| `UPLOAD_ROOT` | required when `NODE_ENV=production` (`server/config/paths.js`) |

Frequently set: `APP_ENV` (the environment label: `test` or `production`),
`APP_URL` and `EMAIL_FROM` (the code defaults are still the base's
`www.hallismiley.is` / `halli@hallismiley.is` — set `info@orangesmiley.is`
here; in production the canonical-host 301 in `server/app.js` derives its
host from `APP_URL`, so the same setting fixes both),
`LEAD_NOTIFY_EMAIL`, `DB_SSL` (TLS defaults ON in production), `PORT`
(default 3000), `METRICS_TOKEN`, `BOOKS_UPLOAD_ROOT`, `MCP_ENABLED`
(`docs/mcp.md`), `CLIENT_CONFIG_*` overrides of `config/client.json`.

---

## Deployment

`.github/workflows/ci.yml` runs on every push and pull request to **`master`**
(lint, audit, i18n, Jest, Playwright, Docker build + Trivy + boot smoke); a
docs-only change runs all of it. **CI green is the merge gate.**
`.github/workflows/deploy.yml` is `workflow_dispatch` only and fails at its
first step until the `vars.ACR_NAME / IMAGE_NAME / WEBAPP_NAME / RESOURCE_GROUP`
repository variables and the `AZURE_*` OIDC secrets exist — arming it is a
GitHub-settings change, not a workflow edit, and happens only on Halli's
go-ahead. `promote.yml` publishes a built image to the `canary` / `stable`
release channel that the self-update module polls (`docs/SELF-UPDATE.md`).
Full detail, boot requirements and the rollback shape: `docs/DEPLOYMENT.md`;
operations: `RUNBOOK.md`.

Backups: none to document until an instance exists (Azure Database for
PostgreSQL Flexible Server provides PITR when it does; the yearly books archive
to media in Iceland is the compliance step regardless — `RUNBOOK.md` → Bókhald).

---

## Where things are

| | |
|---|---|
| `server/` | Express app (`app.js` mounts, `routes/`, `controllers/`, `services/`, `models/`, `server/config/schema.js` migrations, `mcp/`) |
| `public/` | the SPA (`js/router.js`, `js/views/`, `js/components/`, `js/i18n/{en,is}.json`, `css/themes.css`) |
| `tests/` | Jest unit + integration (real Postgres); `e2e/` Playwright |
| `docs/` | API, bookkeeping, books parallel run, accountant questions, deployment, MCP, sales staff, self-update, SLO, testing |
| `company/` | gitignored — business plan, decisions, logs, market research staging |
| `.claude/` | gitignored — agents, commands, rules (`stack-invariants.md`) |

## License

[MIT](LICENSE) — Copyright (c) 2026 Halli
