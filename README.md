# Halli Smiley

Personal portfolio of Halli — an Icelandic carpenter and computer scientist. Showcases twenty years of precision joinery and timber framing alongside full-stack software engineering work. The same codebase is the **HalliProjects base** that the site factory scaffolds customer instances from (`orangesmiley`, `rekstrarkerfid`, LedgerLink), so engine changes land here first.

Live site: **https://www.hallismiley.is**

`CLAUDE.md` is the authoritative instruction file for anyone (human or agent) working in this repo. This README covers setup, tests, environment and the deployment summary; the linked docs carry the detail.

---

## Tech Stack (read from the repo 2026-09-12)

| Layer | Technology |
|-------|-----------|
| Runtime | Node **24 LTS** (`Dockerfile` `node:24-alpine`, digest-pinned in both stages; `ci.yml` `node-version: 24`; `promote.yml` the same — the pins move together) |
| Framework | Express **5** (`^5.2.1`, CommonJS; catch-alls are `'/{*splat}'`) |
| Database | PostgreSQL 16 via `pg`; migrations are the array in `server/config/schema.js`, applied at boot under an advisory lock (chain ends `084_mcp_tokens`) |
| Frontend | Vanilla JS SPA (MVC + component pattern), ES modules, no bundler |
| Auth | **Lucia v3 server-side sessions** (`auth_session` cookie), csrf-csrf double-submit, admin TOTP — there is no JWT layer; passwords are hashed with oslo Scrypt |
| Email | Resend (`RESEND_API_KEY`); sender `EMAIL_FROM` (default `halli@hallismiley.is`) |
| Payments | Stripe |
| Deployment | Docker image → Azure Container Registry → Azure App Service (Linux container), **auto-deployed on green CI on `main`** |

---

## Prerequisites

- Node 24
- PostgreSQL 16

---

## Local Setup

**1. Clone and install dependencies**

```bash
git clone https://github.com/pepti/hallismiley.git
cd hallismiley
npm install
```

**2. Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` and fill in the values. See [Environment Variables](#environment-variables) below.

**3. Create the database and run migrations**

```bash
createdb hallismiley        # or create via psql
npm run migrate
```

**4. (Optional) Seed sample data**

```bash
npm run seed
```

**5. Start the development server**

```bash
npm run dev       # nodemon — auto-restarts on changes
# or
npm start         # plain node
```

The app is served at `http://localhost:3000`.

---

## Running Tests

```bash
npm run lint
npm run check:i18n
npm test                   # Jest, serial (jest.config.js maxWorkers: 1), unit + integration
npm run test:ci            # what CI runs: 8 GB heap, --ci --runInBand --forceExit --detectOpenHandles --coverage
npm run test:e2e           # Playwright (one chromium project)
```

Tests are Jest unit + integration suites under `tests/unit/` and `tests/integration/` — Jest collects **only** those two directories (`jest.config.js` `testMatch`), so a test file placed next to its source or under `__tests__/` never runs. The integration suites need a reachable PostgreSQL.

**The test database is dropped and recreated on every run.** `tests/env.js` overwrites `DATABASE_URL` with `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/hallismiley_test`), and `tests/globalSetup.js` DROPs and re-migrates that database; the name must end in `_test` or setup refuses. Two sessions sharing the default name produce a hundred nondeterministic failures (CLAUDE.md, 2026-08-07) — give every parallel run its own name:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hallismiley_mine_test npm test
```

`npm run test:ci` additionally enforces the coverage floors in `jest.config.js` (global lines ≥ 62, `authController.js` ≥ 88, the two OAuth controllers ≥ 80), so it can fail on coverage alone while `npm test` passes.

Playwright uses its own per-branch database (`hallismiley_e2e_<branch>_test`, `e2e/lib/dbUrl.js`) and boots the server on `E2E_PORT` (default 3000; `reuseExistingServer` is on outside CI, so set `E2E_PORT` when a dev server is already on 3000).

---

## Environment Variables

All variables are documented in `.env.example`. The server refuses to boot without these (`server/server.js` `REQUIRED_ENV` and `server/config/paths.js`):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `CSRF_SECRET` | 32+ random characters |
| `NODE_ENV` | `development` / `test` / `production` — `production` on every deployed container |
| `UPLOAD_ROOT` | required when `NODE_ENV=production` — the persistent uploads mount (`/app/uploads`) |
| `RESEND_API_KEY` | required when `APP_ENV=production` (see `docs/DEPLOYMENT.md` before setting `APP_ENV`) |

Frequently set: `APP_URL` (email links, canonical tags, sitemap, and in production the canonical-host redirect), `EMAIL_FROM`, `DB_SSL` (TLS is on by default in production; `false` is an explicit opt-out for a non-Azure database), `METRICS_TOKEN` (bearer for `/metrics`), `SENTRY_DSN` (error tracking — off when unset), `MCP_ENABLED` (`docs/mcp.md`, off by default), `SOCIAL_LOGIN_ENABLED`, the Stripe keys.

---

## Admin Access

There is no public sign-up for admin accounts. Create or reset one directly in the database:

```bash
node server/scripts/setup-admin.js <username> <email> <password>
```

The script hashes the password (Scrypt) and upserts the `users` row with role `admin`; nothing goes into `.env`. Alternatively `npm run bootstrap` creates the admin when **all three** of `ADMIN_USERNAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set — with any of them missing it migrates, creates no admin and exits 0 (`server/scripts/bootstrap.js`). Admins are then pushed to enrol in TOTP from the profile.

---

## Deployment on Azure App Service

Production is on **Azure App Service** (Linux container, B1 plan, one worker shared with `ferdabox-app`, no deployment slots — read 2026-09-12), with images pushed to **Azure Container Registry** and a managed **Azure Database for PostgreSQL Flexible Server**. Deploys are automated via GitHub Actions with OIDC federated credentials — no long-lived Azure secrets in the repo.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full first-time-setup guide (resource provisioning, OIDC trust, custom domain, Azure Files mount for uploads) and for what the workflows actually do. The summary for routine work:

1. Merge to `main`. The `CI` workflow (`.github/workflows/ci.yml`) runs lint, `npm audit`, the i18n key check, Jest, Playwright and a Docker build + boot smoke test. **There is no path filter: a docs-only merge runs all of it and deploys.**
2. On CI success, the `Deploy to Azure` workflow (`.github/workflows/deploy.yml`) auto-triggers via `workflow_run`, builds the image, pushes it to ACR as `hallismileyacr.azurecr.io/hallismiley:latest`, `:<sha>` and `:sha-<sha>`, updates the App Service container reference and force-restarts (~30–60 s gap).
3. Migrations run automatically at container startup via `server/scripts/migrate.js` — no manual migration step.

A **red `Deploy to Azure` run after a red or cancelled CI run is the designed alert** that merged code is not live, not a broken pipeline (`docs/DEPLOYMENT.md` §6). Manual deploy (emergency override, bypasses the CI gate):

```bash
gh workflow run "Deploy to Azure" --ref main
```

Operational facts worth knowing (read live 2026-09-12): the App Service pulls from ACR with registry admin credentials held in app settings (no managed identity on the site); the deploy identity is a GitHub-OIDC service principal; Sentry is not wired (`SENTRY_DSN` unset); the release-channel workflow `promote.yml` exists but is unarmed (no repository variables). Operations: [`RUNBOOK.md`](RUNBOOK.md).

---

## Database Backup Strategy

Production data lives in **Azure Database for PostgreSQL Flexible Server**
(`hallismiley-db`), which provides automatic, encrypted backups managed by
Azure — no application-side cron required.

**Automatic backups (Azure), read 2026-09-12:**
- Daily full + log backups for point-in-time restore.
- Retention: **7 days** (configurable up to 35).
- Geo-redundant backup: **disabled**; no high availability.

**Inspect current backup settings:**
```bash
az postgres flexible-server show \
  --resource-group hallismiley-rg --name hallismiley-db \
  --query "{retention:backup.backupRetentionDays, geoRedundant:backup.geoRedundantBackup}"
```

**Point-in-time restore (PITR)** — creates a NEW server; repoint the App Service's `DATABASE_URL` at it once it is healthy:
```bash
az postgres flexible-server restore \
  --resource-group hallismiley-rg \
  --name hallismiley-db-restore-$(date +%Y%m%d) \
  --source-server hallismiley-db \
  --restore-time "2026-05-12T12:00:00Z"
```

**Ad-hoc logical dump (locally, against the prod DB — your IP needs a firewall rule, `docs/DEPLOYMENT.md` §2):**
```bash
pg_dump "postgresql://halliadmin:<url-encoded-pw>@hallismiley-db.postgres.database.azure.com:5432/hallismiley?sslmode=require" \
  --no-acl --no-owner -F c -f backup_$(date +%Y%m%d).dump
```

**Restore an ad-hoc dump into a dev/staging server:**
```bash
pg_restore --clean --no-acl --no-owner \
  -d "postgresql://USER:PW@HOST:5432/DBNAME?sslmode=require" \
  backup_YYYYMMDD.dump
```

The books' supporting documents live outside the database (`BOOKS_UPLOAD_ROOT`) and the yearly archive to media in Iceland is the statutory copy (`RUNBOOK.md` → Bókhald).

---

## Environment-Specific Configuration

There is no staging environment. `NODE_ENV` is one of `development` / `test` / `production`; the server recognises nothing else, and the production-only behaviours below key on exactly `production`. `APP_ENV` is the separate deployment *label* (`test` on a TEST stack, `production` on the live site) read by the TEST chrome, the MCP environment tag and the mail boot guard.

| Behaviour | `development` | `production` |
|-----------|---------------|--------------|
| `DB_SSL` | `false` for a local Postgres | on by default (`false` is an explicit opt-out; never on Azure) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | `https://hallismiley.is,https://www.hallismiley.is,https://hallismiley-app.azurewebsites.net` |
| Session cookie `secure` flag | off (http ok) | on (`server/auth/lucia.js`) |
| HTTPS redirect + canonical-host 301 | disabled | enabled (`server/app.js`; `/health` and `/ready` exempt) |
| `SENTRY_DSN` | leave blank | set to enable error tracking (unset on the live site as of 2026-09-12) |

**Conventions:**
- Never commit `.env` — only `.env.example` is tracked.
- `keys/` stays gitignored; it holds nothing the app reads (a vestige of the JWT boilerplate this repo never had).
- Use `LOG_LEVEL=debug` locally for verbose output; leave unset (defaults to `info`) in production.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Halli
