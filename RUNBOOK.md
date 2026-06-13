# Runbook — Halli Smiley

Operational procedures for the production deployment on Azure App Service.

Key resource names (see also project memory):

| Resource | Name |
| --- | --- |
| Resource group | `hallismiley-rg` |
| App Service | `hallismiley-app` |
| Container registry | `hallismileyacr.azurecr.io` |
| Postgres Flexible Server | `hallismiley-db` |

---

## Rollback Procedures

The deploy pipeline tags every image with its commit SHA
(`hallismileyacr.azurecr.io/hallismiley:<sha>`), so a rollback is a one-command
swap of which tag the App Service points at — no rebuild, no CI rerun.

### Pin App Service to a previous image SHA (preferred)

```bash
# 1. List recent image tags in ACR, newest first.
az acr repository show-tags \
  --name hallismileyacr --repository hallismiley \
  --orderby time_desc --top 20 -o tsv

# 2. Point the App Service at the previous-known-good tag.
az webapp config container set \
  --resource-group hallismiley-rg \
  --name hallismiley-app \
  --container-image-name hallismileyacr.azurecr.io/hallismiley:<previous-sha>

# 3. Force a restart so the new image is actually running.
az webapp restart \
  --resource-group hallismiley-rg --name hallismiley-app
```

Verify with `curl -I https://www.hallismiley.is/health` once the restart settles
(~30–60s on the B1 tier; brief unavailability during the swap).

> A rollback re-deploys the previous Docker image but does NOT revert the
> database. If the rollback target used a different schema, run a corrective
> migration manually (see **Database Migration Rollback** below).

### Git-based rollback (slower, but goes through CI)

When the bad change is small and you'd rather have CI validate the rollback:

```bash
git revert <bad-commit-sha>
git push origin main
```

CI runs against the revert commit; on green, the gated Deploy workflow
auto-fires and ships the reverted code. Takes ~5–8 minutes vs. the ~1 minute
of the image-pin approach.

### Emergency manual deploy (skip CI gate)

Used yesterday after the subscription outage — fires Deploy directly without
waiting for a new CI run:

```bash
gh workflow run "Deploy to Azure" --ref main
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

## Container Registry Housekeeping

A scheduled ACR task named `weekly-purge` (created 2026-06-10) lives in Azure —
not in this repo — and prunes old images from `hallismileyacr` every Sunday at
03:00 UTC. It keeps the 10 newest tags on the `hallismiley` repository
(`latest` + recent commit SHAs) and deletes every tag older than 14 days beyond
those, plus untagged manifests. The `ferdabox` repository is deliberately not
touched. Without this task the registry grows ~340 MB per deploy forever — it
had reached 38.5 GB (vs. 10 GB included in the Basic tier) before the first
manual purge on 2026-06-10.

```bash
# Inspect the task / trigger a run now / pause it:
az acr task show --registry hallismileyacr --name weekly-purge -o table
az acr task run  --registry hallismileyacr --name weekly-purge
az acr task update --registry hallismileyacr --name weekly-purge --status Disabled

# Registry storage usage (the meter lags deletions by minutes–hours):
az acr show-usage --name hallismileyacr -o table
```

> **Interaction with rollbacks:** if prod stays pinned to an image older than
> the 10 newest tags for more than 14 days, the weekly purge will delete the
> very tag prod points at, and the next container restart will fail to pull.
> For any long-lived rollback, lock the tag (and unlock it once back on HEAD):

```bash
az acr repository update --name hallismileyacr \
  --image hallismiley:<sha> --delete-enabled false --write-enabled false
```

---

## Seeding the Shop (`server/scripts/seed-shop.js`)

The seeder's **default mode is prod-safe**: it upserts the defined clothing
line (2 products, 20 variants) by slug and touches nothing else. Admin-added
products are untouched. The optional `--reset` flag opts into the
destructive "deactivate every product not in the lineup" behavior — only
ever use that on a local dev DB or during an authorised product-line pivot.

```bash
# Dev (local Postgres, wipes-and-reloads the shop):
node server/scripts/seed-shop.js --reset

# Dev (local Postgres, preserves any admin-added rows):
node server/scripts/seed-shop.js

# Prod (Azure Postgres — NEVER pass --reset here):
DATABASE_URL='postgresql://halliadmin:<url-encoded-pass>@hallismiley-db.postgres.database.azure.com:5432/hallismiley?sslmode=require' \
DB_SSL=true \
UPLOAD_ROOT=/tmp/seed-out \
node server/scripts/seed-shop.js
# Then upload the generated image files to the Azure Files share:
az storage file upload-batch \
  --account-name hallismileyfs --destination uploads --destination-path products \
  --source /tmp/seed-out/products --auth-mode key
```

Rationale: the App Service container has no SSH-able wwwroot (Kudu can't
reach the app container filesystem on a Docker-based App Service), so the
canonical prod-seeding workflow is: run the seeder from a dev machine
pointed at the prod DB, dump the image files to a temp `UPLOAD_ROOT`,
then batch-upload the image subtree to the Azure Files share that the
container mounts at `/app/uploads`.

**General rule for anything that mutates prod data:**

- Default behavior MUST be idempotent and non-destructive.
- Destructive / reset behavior MUST be opt-in via an explicit flag.
- The tool MUST print which mode it's in at startup so you see it before
  it does any work.

---

## Analytics (first-party, cookieless)

Visitor analytics live in two tables — `page_views` (every page view) and
`analytics_events` (conversions: contact submits, party RSVPs, shop checkouts).
Visitors are counted via `visitor_token`, an irreversible SHA-256 of
`(ip + user-agent + a daily in-memory salt)`. No cookies, no IP, no user-agent
are stored. View the data at `/admin/analytics` (admin role required).

**"Unique visitors" can over-count after a mid-day restart.** The salt lives
only in process memory and regenerates whenever the container restarts (and at
00:00 UTC). After a restart the same visitor gets a new token for the rest of
that day, so they may be counted twice. This is an accepted trade-off of the
cookieless design — total page views are unaffected; only same-day uniques.

**Retention / pruning (manual).** There is no scheduler wired into the app, so
the tables grow until pruned. `page_views` is the only one that grows quickly;
`analytics_events` is tiny (conversions only) — keep it. To prune old views
(e.g. older than ~13 months), run against the target DB:

```bash
psql "$DATABASE_URL" -c "DELETE FROM page_views WHERE created_at < NOW() - INTERVAL '400 days';"
```

For a low-traffic portfolio this is a once-a-year chore at most.

---

## Common Incidents

### "Web App is stopped" (HTTP 403, Azure platform page)

This is the platform's own error page, served before the Node container.
Almost always means either the App Service was stopped or the subscription is
disabled. Check in this order:

```bash
# Is the App Service stopped?
az webapp show --resource-group hallismiley-rg --name hallismiley-app \
  --query "{state:state, availabilityState:availabilityState}" -o json

# Is the subscription enabled?
az account show --query "{name:name, state:state}" -o json
```

If `state: "Stopped"` → `az webapp start --resource-group hallismiley-rg --name hallismiley-app`.
If the subscription is disabled → resolve billing in Azure Portal first; the
App Service will auto-resume once the subscription is reactivated.

### Server returns 503 on /health (Node is running but failing)

1. Tail container logs:
   ```bash
   az webapp log tail --resource-group hallismiley-rg --name hallismiley-app
   ```
2. Verify required app settings are in place:
   ```bash
   az webapp config appsettings list --resource-group hallismiley-rg --name hallismiley-app -o table
   ```
   Missing `DATABASE_URL`, `CSRF_SECRET`, `ALLOWED_ORIGINS` typically surface
   as startup failures. Compare against `.env.example`.
3. Check Postgres reachability — `hallismiley-db.postgres.database.azure.com`
   must accept inbound from App Service outbound IPs:
   ```bash
   az postgres flexible-server firewall-rule list \
     --resource-group hallismiley-rg --name hallismiley-db -o table
   ```
4. If the DB is up but the server is crashing, look for `[server] Startup failed`
   in `az webapp log tail` output.

### Out-of-memory / container restart loop

1. Open the **Metrics** blade for `hallismiley-app` in the Azure Portal — chart
   *Memory Working Set* and *CPU Percentage* over the last 24h.
2. If caused by a bad deploy, roll back via the image-pin recipe above.
3. If persistent, scale the plan up:
   ```bash
   az appservice plan update \
     --resource-group hallismiley-rg --name hallismiley-plan --sku B2
   ```
   B1 has 1.75 GB; B2 has 3.5 GB.

### High rate-limit 429 errors

1. Hit `/health` directly — if the server is healthy, the source is a bot/crawler.
2. Inspect recent requests via App Service Log Stream or
   `az webapp log tail`. Use the `requestId` field to correlate.
3. Add an IP access restriction if needed:
   ```bash
   az webapp config access-restriction add \
     --resource-group hallismiley-rg --name hallismiley-app \
     --rule-name block-abuse --action Deny --ip-address <ip>/32 --priority 100
   ```
4. Tighten rate limits in `server/app.js` or `server/routes/authRoutes.js` if
   the source is widely distributed.

---

## Health Check

```bash
curl https://www.hallismiley.is/health
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

Live tail from the terminal (Pino structured JSON, one line per request):

```bash
az webapp log tail --resource-group hallismiley-rg --name hallismiley-app
```

In the portal: **App Service `hallismiley-app` → Monitoring → Log Stream**.

Use the `requestId` field (`X-Request-ID` header on the corresponding response)
to correlate log lines across a single request. Filter further by severity
with `jq`:

```bash
az webapp log tail -g hallismiley-rg -n hallismiley-app \
  | grep -E '^\{' | jq 'select(.level >= 40)'   # warn (40) and above
```

---

## Local Development — Test Database

`npm test` is fully self-managed: [`tests/globalSetup.js`](tests/globalSetup.js)
drops and recreates the test database from scratch and runs every migration
before any suite executes, and [`tests/env.js`](tests/env.js) sets every env
var the app reads at require time. All you need to provide is a reachable
Postgres with the matching credentials.

**Default expectations** (overridable via `TEST_DATABASE_URL`):

| Setting | Value |
| --- | --- |
| Host / port | `localhost:5432` |
| Admin user / password | `postgres` / `postgres` |
| Test database name | `hallismiley_test` (auto-created) |

The DB name **must** end in `_test` — `globalSetup` refuses to drop anything
else as a safety check.

**Quickest path — disposable Postgres in Docker:**

```bash
docker run --rm -d --name halli-pg-test \
  -p 5432:5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  postgres:16-alpine

npm test                       # creates hallismiley_test, migrates, runs suite
docker stop halli-pg-test      # tear down when done
```

**Using an existing Postgres** (Homebrew, system service, etc.) — ensure the
admin role can `CREATE DATABASE`, then point Jest at it:

```bash
TEST_DATABASE_URL='postgresql://USER:PASS@HOST:5432/hallismiley_test' npm test
```

**Skipping the seeded test DB is what makes `npm test` fail locally.** If
`npm test` is producing dozens of `401`/`null row` errors, that's the signal
— spin up Postgres above and rerun. CI uses a Postgres service container with
the same defaults (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)),
so passing locally with the values above gives you the same environment.
