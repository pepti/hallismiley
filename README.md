# Halli Smiley

Personal portfolio of Halli — an Icelandic carpenter and computer scientist. Showcases twenty years of precision joinery and timber framing alongside full-stack software engineering work.

Live site: **https://hallismiley.is**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 4.x |
| Database | PostgreSQL 16 |
| Auth | Lucia (session cookies) + Arctic (Google & Facebook OAuth 2.0) |
| Email | Resend |
| Frontend | Vanilla JS SPA (MVC + component pattern) |
| Observability | Pino logs, Sentry errors, prom-client metrics |
| Container | Docker (multi-stage, non-root user) |
| CI | GitHub Actions (lint + Jest + Playwright + npm audit) |
| Deployment | Azure Web App for Containers + Azure Container Registry |
| Uploads | Azure Files mount at `UPLOAD_ROOT` |

---

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Docker (optional, for local parity with production image)

---

## Local Setup

**1. Clone and install dependencies**

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/halliprojects.git
cd halliprojects
npm install
```

**2. Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` and fill in all values. See [Environment Variables](#environment-variables) below.

At minimum you need `DATABASE_URL`, `ALLOWED_ORIGINS`, and `CSRF_SECRET`. The server will refuse to boot without `CSRF_SECRET` set in production.

**3. Create the database and run migrations**

```bash
createdb halliprojects        # or create via psql
npm run migrate
```

**4. (Optional) Seed sample data**

```bash
npm run seed                  # base projects/news
npm run seed:arnarhraun       # Arnarhraun gallery project
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
npm test              # Jest unit + integration
npm run test:ci       # CI mode (--runInBand --forceExit --coverage)
npm run test:e2e      # Playwright E2E
npm run test:e2e:ui   # Playwright UI mode
```

Integration tests require a running PostgreSQL instance. Configure `TEST_DATABASE_URL` in `.env` before running.

---

## Environment Variables

All variables are documented in `.env.example`. Required in every environment:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (no trailing slash) |
| `CSRF_SECRET` | 32+ character random string (required in production) |
| `NODE_ENV` | `development` / `test` / `production` |

Production-relevant optional vars:

| Variable | Description |
|----------|-------------|
| `DB_SSL` | `true` for Azure Database for PostgreSQL |
| `UPLOAD_ROOT` | Mount path for the Azure Files share (e.g. `/mnt/uploads`) |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE` | Error + performance monitoring |
| `METRICS_TOKEN` | Bearer token gating `/metrics`; localhost-only if blank |
| `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` | Transactional email (verification, password reset) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Sign-In |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI` | Facebook Sign-In |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed an initial admin on first boot |

---

## Admin Access

The admin panel (`/#/admin`) requires a seeded admin account. First boot creates one if `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are set. For an existing installation, you can also run:

```bash
node server/scripts/setup-admin.js
```

The script prompts for a username, email, and password, hashes the password with scrypt, and upserts the admin row.

---

## Deployment on Azure

Deployments are automated via `.github/workflows/deploy.yml`, which runs **after** `CI` succeeds on `main`:

1. GitHub Actions logs into Azure using OIDC (federated credentials — no long-lived secrets).
2. Builds a Docker image and pushes to `hallismileyacr.azurecr.io` with both `:latest` and `:<sha>` tags.
3. Deploys the `:<sha>` image to the `hallismiley-app` Web App.

**Prerequisites (one-time setup)**

- Azure resources: Web App for Containers, Azure Container Registry, Azure Database for PostgreSQL (flexible server), Azure Files share for uploads.
- Federated credential on an Azure AD app registration trusting the GitHub repo + `main` branch.
- Repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- App Service configuration: every variable from `.env.example` that applies to production, plus the `UPLOAD_ROOT` path for the mounted Azure Files share.

**Manual deploy / rollback**

`workflow_dispatch` is available on the `Deploy to Azure` workflow — run it with a specific branch/SHA to redeploy. See `RUNBOOK.md` for the step-by-step rollback procedure.

---

## Database Backup Strategy

Production uses **Azure Database for PostgreSQL — Flexible Server**. Automated backups are handled by Azure:

- Automated backups retained per the server's retention setting (configure in the Azure portal under the DB server → **Backup and restore**).
- Point-in-time restore is supported within the retention window.
- Geo-redundant backups available on the Business Critical tier.

**Verifying backups are working**
1. In the Azure portal, open your PostgreSQL flexible server.
2. Navigate to **Backup and restore** — confirm **Earliest restore time** is current.
3. Periodically test a point-in-time restore to a disposable server to validate backup integrity.

**Manual backup (on-demand)**
```bash
pg_dump "$DATABASE_URL" --no-acl --no-owner -F c -f backup_$(date +%Y%m%d).dump
```

**Restore from dump**
```bash
pg_restore --clean --no-acl --no-owner -d "$DATABASE_URL" backup_YYYYMMDD.dump
```

---

## Environment-Specific Configuration

| Variable | Development | Staging | Production |
|----------|-------------|---------|------------|
| `NODE_ENV` | `development` | `staging` | `production` |
| `DB_SSL` | `false` (local PG) | `true` (Azure PG) | `true` (Azure PG) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | staging URL | `https://hallismiley.is` |
| `SENTRY_DSN` | leave blank | optional | set for error tracking |
| `CSRF_SECRET` | any dev value | prod-grade random | prod-grade random |
| Cookie `secure` flag | off (http ok) | on | on |
| HTTPS redirect | disabled | enabled | enabled |

**Conventions:**
- Never commit `.env` — only `.env.example` is tracked.
- Staging should mirror production env vars as closely as possible.
- Use `LOG_LEVEL=debug` locally for verbose output; leave unset (defaults to `info`) in production.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Halli
