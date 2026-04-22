# Deployment Guide — HalliProjects

This guide covers deploying HalliProjects to Railway from a GitHub repository.

---

## Railway Deployment

### 1. Create the Railway project

1. Go to [railway.app](https://railway.app) and sign in.
2. Click **New Project → Deploy from GitHub repo**.
3. Authorise Railway and select the `HalliProjects` repository.
4. Railway will detect the `Dockerfile` and queue the first build automatically.

### 2. Add a PostgreSQL database

1. Inside the project, click **New → Database → Add PostgreSQL**.
2. Once provisioned, open the Postgres service and copy the **DATABASE_URL** from the **Connect** tab.
   Railway also exposes it as `${{Postgres.DATABASE_URL}}` so you can reference it directly in environment variables.

### 3. Set environment variables

Open the web service → **Variables** tab and add the following (see `.env.example` for descriptions):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `ALLOWED_ORIGINS` | `https://hallismiley.is,https://www.hallismiley.is` |
| `NODE_ENV` | `production` |
| `CSRF_SECRET` | *(32+ char random hex — see below)* |
| `DB_SSL` | `true` |
| `LOG_LEVEL` | `info` |
| `SENTRY_DSN` | *(optional — your Sentry project DSN)* |
| `METRICS_TOKEN` | *(optional — random hex to protect /metrics)* |
| `ALERT_WEBHOOK_URL` | *(optional — Slack/Discord/PagerDuty webhook)* |

Generate secrets locally:
```bash
# CSRF_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# METRICS_TOKEN
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### 4. Deploy

Railway redeploys automatically on every push to the configured branch (default: `main`/`master`).

To trigger a manual deploy: **Deployments → Trigger Deploy**.

The server runs database migrations automatically at startup (`server/scripts/migrate.js`), so no manual migration step is needed.

---

## Initial Admin Setup

After the first successful deploy, create the first admin user by running a one-off command via the Railway CLI:

```bash
# Install Railway CLI if you haven't already
npm install -g @railway/cli
railway login

# Run the setup script in your production service
railway run node server/scripts/setup-admin.js <username> <email> <password>
```

This creates the user and grants the `admin` role. Keep the credentials in a password manager — there is no recovery flow without database access.

---

## Verifying the Deployment

| Check | URL | Expected response |
|---|---|---|
| Liveness | `GET /health` | `200 {"status":"ok"}` |
| Readiness (DB + system) | `GET /ready` | `200 {"status":"ok", ...}` |
| Prometheus metrics | `GET /metrics` | `200` text/plain (requires `Authorization: Bearer <METRICS_TOKEN>` if token is set) |

A healthy deploy returns `200` on `/ready` before Railway marks it live (`healthcheckPath = "/ready"` in `railway.toml`).

---

## SSL / Custom Domain

1. In Railway: **Settings → Domains → Add Custom Domain**.
2. Enter `hallismiley.is` (and `www.hallismiley.is` if needed).
3. Railway displays CNAME or A records — add them in your DNS provider.
4. Railway provisions a Let's Encrypt certificate automatically once DNS propagates (usually < 5 minutes).
5. Ensure `ALLOWED_ORIGINS` includes the `https://` URL of your domain or CORS requests will be blocked.

---

## Rollback Procedure

### Instant rollback via Railway dashboard

1. Open **Deployments** in the Railway project.
2. Find the last known-good deployment.
3. Click **Redeploy** — Railway rolls back to that exact image within seconds.

### Git-based rollback

```bash
# Identify the commit to roll back to
git log --oneline -10

# Create a revert commit (keeps history clean)
git revert <bad-commit-sha>
git push origin main
```

Railway picks up the push and deploys the reverted code automatically.

### Database rollback

Migrations run forward-only. If a migration caused data issues:

1. Connect to the Railway Postgres instance via the **Connect** tab.
2. Manually reverse the schema change with a SQL statement.
3. Remove or rename the migration file and redeploy, or write a new corrective migration.

Always back up the database before deploying schema-changing migrations:
```bash
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```
