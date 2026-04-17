# Runbook — Halli Smiley

Operational procedures for the production deployment on **Azure Web App for Containers**.

Resource inventory (memory/project_azure_deployment.md has credentials and ARM IDs):
- Web App: `hallismiley-app` (Linux, container)
- Container registry: `hallismileyacr.azurecr.io`
- Database: Azure Database for PostgreSQL — Flexible Server
- Uploads: Azure Files share mounted at the path in `UPLOAD_ROOT`

---

## Rollback Procedures

### One-click rollback (re-deploy a prior image tag)

Each CI build pushes two tags: `:latest` and `:<commit-sha>`. To roll back:

1. **Azure Portal** → Web App `hallismiley-app` → **Deployment Center** → **Logs**.
2. Note the SHA of the last known-good deployment.
3. Trigger the `Deploy to Azure` GitHub Actions workflow via **Actions → Deploy to Azure → Run workflow**, choosing the branch/tag whose `HEAD` is the known-good SHA, OR
4. From Azure CLI, point the Web App at the known-good image directly:

   ```bash
   az webapp config container set \
     --name hallismiley-app \
     --resource-group <your-rg> \
     --docker-custom-image-name hallismileyacr.azurecr.io/hallismiley:<good-sha>
   ```

5. Monitor `az webapp log tail --name hallismiley-app --resource-group <your-rg>` until the health check returns 200.

> Note: A rollback re-deploys a previous image but does NOT revert the database. If the rollback target used a different schema, write a compensating forward migration (see below).

### Slot swap (zero-downtime)

If a staging slot exists:

```bash
az webapp deployment slot swap \
  --resource-group <your-rg> \
  --name hallismiley-app \
  --slot staging \
  --target-slot production
```

Swap swaps back the same way — repeat the command to undo.

---

## Database Migration Rollback

Migrations are forward-only. To undo a schema change:

1. Write a new migration SQL file that reverses the change.
2. Place it in `server/migrations/` with the next sequence number (see `server/migrations/README.md` for numbering rules).
3. Deploy and let `migrate.js` apply it automatically on startup.

Example — dropping a column added by mistake:
```sql
-- server/migrations/022_rollback_some_column.sql
ALTER TABLE projects DROP COLUMN IF EXISTS some_column;
```

For a full schema revert, use Azure Database for PostgreSQL **point-in-time restore** (Azure portal → your PG server → **Backup and restore** → **Restore**).

---

## Common Incidents

### Server refuses to start with "CSRF_SECRET … required in production"

This is intentional fail-loud behaviour (`server/middleware/csrf.js`). Set `CSRF_SECRET` in App Service → **Configuration** → **Application settings** to a random 32+ character value and restart:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

### Server returns 503 on /health

1. `az webapp log tail --name hallismiley-app --resource-group <your-rg>` → look for `[server] Startup failed` or connection errors.
2. Azure Portal → Web App → **Configuration** — verify all required env vars from `.env.example` are set.
3. Check PostgreSQL: Azure Portal → PG flexible server → **Metrics** (Active connections, CPU).
4. If DB is healthy but server crashing, roll back (above).

### Out-of-memory / container restart loop

1. Azure Portal → Web App → **Metrics** — inspect memory and CPU.
2. If caused by a bad deployment, roll back immediately.
3. If persistent, scale up the App Service plan or investigate query/memory leak via Sentry + `/metrics` (pool gauges now reflect real pool state).

### Uploads disappearing after restart

Symptom: user avatars / news media revert after a container restart.

1. Verify `UPLOAD_ROOT` is set to the Azure Files mount path.
2. Azure Portal → Web App → **Configuration** → **Path mappings** — confirm the storage account + share is mounted at that path.
3. `az webapp ssh --name hallismiley-app --resource-group <your-rg>` → `ls $UPLOAD_ROOT` to confirm persistence.

### OAuth sign-in returns `email_unverified_conflict`

The signed-in Google/Facebook email matches an existing account whose email is not yet verified. By design we refuse to auto-link (prevents the pre-registration attack). The user should either:
- Click **Forgot password** on the login page — completing the reset proves ownership and verifies the email, after which OAuth will auto-link.
- Or verify the original signup via the link that was emailed to them.

### High rate-limit 429 errors

1. `curl https://hallismiley.is/health` — confirm the server itself is healthy.
2. Check Sentry / Azure Log Analytics for the IP distribution.
3. Tighten rate limits in `server/app.js` or `server/routes/authRoutes.js` if needed.

---

## Health Check

```bash
curl https://hallismiley.is/health
```

Expected response:
```json
{ "status": "ok", "uptime": 12345, "timestamp": "...", "checks": { ... } }
```

A degraded `database` or `upload_dir` check means the corresponding backend is unreachable.

---

## Metrics

Prometheus-format metrics at `GET /metrics`. In production, a `Bearer METRICS_TOKEN` header is required (set the token in App Service config). Without a token, the endpoint is localhost-only. Key gauges:

- `db_pool_total_connections`, `db_pool_idle_connections`, `db_pool_waiting_clients` — live pool state (5 s sample).
- `http_requests_total{method,route,status_code}`, `http_request_duration_seconds`.
- `auth_login_attempts_total{result}`, `auth_active_sessions`.

Alerts (`server/observability/alerts.js`) forward critical/warning events to Sentry (if DSN set) and optionally to `ALERT_WEBHOOK_URL`.

---

## Environment Variable Reference

See `.env.example` for the authoritative list. Production requires at minimum: `DATABASE_URL`, `ALLOWED_ORIGINS`, `CSRF_SECRET`, `NODE_ENV=production`, `DB_SSL=true`.

---

## Log Access

- **Live tail:** `az webapp log tail --name hallismiley-app --resource-group <your-rg>`
- **Portal:** Web App → **Log stream**
- **Structured queries:** if Log Analytics is enabled on the Web App, query via Azure Monitor / KQL.
- **Correlation:** use the `requestId` field (`X-Request-ID` header) to correlate related log lines across a single request.
