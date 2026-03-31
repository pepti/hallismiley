# Runbook — Halli Smiley

Operational procedures for the production deployment on Railway.

---

## Rollback Procedures

### One-Click Rollback (Railway Dashboard)

1. Open [Railway](https://railway.app) and navigate to your project.
2. Select the **web service** (not the PostgreSQL plugin).
3. Click the **Deployments** tab.
4. Find the last known-good deployment and click the **...** menu → **Redeploy**.
5. Railway will re-run that exact image. Monitor the deployment logs to confirm it starts cleanly.

> Note: A rollback re-deploys the previous Docker image but does NOT revert the database. If the rollback target used a different schema, run the corresponding migration rollback manually (see below).

### Manual Rollback via CLI

```bash
# List recent deployments
railway deployments list

# Redeploy a specific deployment ID
railway redeploy <deployment-id>
```

---

## Database Migration Rollback

Migrations are forward-only in this project. To undo a schema change:

1. Write a new migration SQL file that reverses the change.
2. Place it in `server/migrations/` with the next sequence number.
3. Deploy and let `migrate.js` apply it automatically on startup.

Example — dropping a column added by mistake:
```sql
-- server/migrations/002_rollback_example.sql
ALTER TABLE projects DROP COLUMN IF EXISTS some_column;
```

---

## Common Incidents

### Server returns 503 on /health

1. Check the Railway deployment logs for startup errors.
2. Verify all required env vars are set in the Railway dashboard (see README → Environment Variables).
3. Check the PostgreSQL plugin is running: Railway dashboard → PostgreSQL → Metrics.
4. If the DB is up but the server is crashing, check for `[server] Startup failed` in logs.

### Out-of-memory / container restart loop

1. Check Railway metrics for memory usage spikes.
2. If caused by a bad deployment, roll back immediately (see above).
3. If persistent, increase the Railway service's memory limit or investigate query/memory leak.

### JWT auth broken after deployment

Likely cause: `PRIVATE_KEY` or `PUBLIC_KEY` env vars were changed or not set.

1. Verify both keys are present in Railway env vars.
2. Ensure newlines are encoded as `\n` (single-line format).
3. Restart the service after correcting env vars.

### High rate-limit 429 errors

1. Check `/health` — if the server is healthy, the source is a bot or crawler.
2. Add the IP to Railway's DDoS protection or a WAF if available.
3. Tighten rate limits in `server/app.js` or `server/routes/authRoutes.js` if needed.

---

## Health Check

```bash
curl https://halliprojects.is/health
```

Expected response:
```json
{ "status": "ok", "uptime": 12345, "timestamp": "...", "database": "ok" }
```

A `"database": "error"` response means the PostgreSQL connection is down.

---

## Environment Variable Reference

See `README.md → Environment-Specific Configuration` and `.env.example` for the full list.

---

## Log Access

Logs are available in the Railway dashboard under your service → **Logs** tab. Use the `requestId` field (`X-Request-ID` header) to correlate requests across log lines.
