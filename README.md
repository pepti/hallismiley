# Halli Smiley

Personal portfolio of Halli — an Icelandic carpenter and computer scientist. Showcases twenty years of precision joinery and timber framing alongside full-stack software engineering work.

Live site: **https://www.hallismiley.is**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 4.18 |
| Database | PostgreSQL 16 |
| Frontend | Vanilla JS SPA (MVC + Component pattern) |
| Auth | RS256 JWT (access + refresh tokens) |
| Deployment | Azure App Service (Linux container, image pushed to Azure Container Registry) |

---

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- OpenSSL (for generating RSA keys)

---

## Local Setup

**1. Clone and install dependencies**

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/hallismiley.git
cd hallismiley
npm install
```

**2. Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` and fill in all values. See [Environment Variables](#environment-variables) below.

**3. Generate RSA keys**

```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

**4. Create the database and run migrations**

```bash
createdb hallismiley        # or create via psql
npm run migrate
```

**5. (Optional) Seed sample data**

```bash
npm run seed
```

**6. Start the development server**

```bash
npm run dev       # nodemon — auto-restarts on changes
# or
npm start         # plain node
```

The app is served at `http://localhost:3000`.

---

## Running Tests

```bash
npm test           # run all tests
npm run test:ci    # CI mode (--runInBand --forceExit)
```

Tests are integration tests and require a running PostgreSQL instance. Configure `DATABASE_URL` in `.env` before running.

---

## Environment Variables

All variables are documented in `.env.example`. Key ones:

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_SSL` | Set `true` for hosted PostgreSQL (Azure, Supabase, Render, etc.) |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | bcrypt hash — generate with `setup-admin.js` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `PRIVATE_KEY` | RS256 private key (newlines as `\n`) |
| `PUBLIC_KEY` | RS256 public key (newlines as `\n`) |

---

## Admin Access

The admin panel (`/admin`) requires a seeded admin account. To create or reset it:

```bash
node server/scripts/setup-admin.js
```

The script prompts for a username and password, hashes the password with bcrypt, and prints the values to add to your `.env`.

---

## Deployment on Azure App Service

Production is on **Azure App Service** (Linux container, B1 plan), with images
pushed to **Azure Container Registry** and a managed **Azure Database for
PostgreSQL Flexible Server**. Deploys are fully automated via GitHub Actions
using OIDC federated credentials — no long-lived secrets in the repo.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full first-time-setup
guide (resource provisioning, OIDC trust, custom domain, Azure Files mount for
uploads). The summary for routine work:

1. Push to `main`. The `CI` workflow (`.github/workflows/ci.yml`) runs lint +
   `npm audit` + integration tests + E2E + Docker build.
2. On CI success, the `Deploy to Azure` workflow (`.github/workflows/deploy.yml`)
   auto-triggers via `workflow_run`, builds the image, pushes to ACR
   (`hallismileyacr.azurecr.io/hallismiley:<sha>`), and updates the App Service
   container reference + restarts.
3. Migrations run automatically at container startup via `server/scripts/migrate.js`
   — no manual migration step.

Manual deploy (emergency override, bypasses CI gate):
```bash
gh workflow run "Deploy to Azure" --ref main
```

---

## Database Backup Strategy

Production data lives in **Azure Database for PostgreSQL Flexible Server**
(`hallismiley-db`), which provides automatic, encrypted backups managed by
Azure — no application-side cron required.

**Automatic backups (Azure):**
- Daily full + log backups for point-in-time restore.
- Default retention: 7 days (configurable up to 35 days).
- Geo-redundant storage is available but not currently enabled on this server.

**Inspect current backup settings:**
```bash
az postgres flexible-server show \
  --resource-group hallismiley-rg --name hallismiley-db \
  --query "{retention:backup.backupRetentionDays, geoRedundant:backup.geoRedundantBackup}"
```

**Point-in-time restore (PITR):**
```bash
az postgres flexible-server restore \
  --resource-group hallismiley-rg \
  --name hallismiley-db-restore-$(date +%Y%m%d) \
  --source-server hallismiley-db \
  --restore-time "2026-05-12T12:00:00Z"
```
Restores create a new server; swap the App Service's `DATABASE_URL` to point
at the restored server once it's healthy.

**Ad-hoc logical dump (locally, against the prod DB):**
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

---

## Environment-Specific Configuration

| Variable | Development | Staging | Production |
|----------|-------------|---------|------------|
| `NODE_ENV` | `development` | `staging` | `production` |
| `DB_SSL` | `false` (local PG) | `true` (hosted) | `true` (hosted) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | staging URL | `https://www.hallismiley.is` |
| `SENTRY_DSN` | leave blank | optional | set for error tracking |
| Cookie `secure` flag | off (http ok) | on | on |
| HTTPS redirect | disabled | enabled | enabled |

**Conventions:**
- Never commit `.env` — only `.env.example` is tracked.
- Staging should mirror production env vars as closely as possible.
- Rotate RSA keys (`PRIVATE_KEY`/`PUBLIC_KEY`) independently per environment — never share keys across environments.
- Use `LOG_LEVEL=debug` locally for verbose output; leave unset (defaults to `info`) in production.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Halli
