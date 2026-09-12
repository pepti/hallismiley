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

Verify that the NEW image is running — `/health` says nothing about which image
answers: `curl -s https://www.hallismiley.is/ready` must show `uptime` reset to
seconds, and `az webapp config container show -g hallismiley-rg -n hallismiley-app
--query linuxFxVersion` must name the tag you pinned (~30–60s on the B1 tier —
no slots, read 2026-09-12; brief unavailability during the swap). The `weekly-purge`
task keeps every tag younger than 14 days plus the 10 newest older ones (see
Container Registry Housekeeping) — record the tag you are rolling back to, confirm
it still exists, and lock it for the window.

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
auto-fires and ships the reverted code. Takes ~15 minutes (CI ≈ 12, deploy ≈ 2,
restart) vs. the ~1 minute of the image-pin approach. A schema reversal can ONLY
ship this way — migrations run at boot of the new image (Database Migration
Rollback below); an image pin never reverts a migration.

### Emergency manual deploy (skip CI gate)

Used yesterday after the subscription outage — fires Deploy directly without
waiting for a new CI run:

```bash
gh workflow run "Deploy to Azure" --ref main
```

---

## Database Migration Rollback

Migrations are forward-only in this project. To undo a schema change:

1. **Append a new entry to the `migrations` array in `server/config/schema.js`**
   with the next sequence number. The runner (`server/scripts/migrate.js`)
   reads ONLY that array — a `.sql` file dropped into `server/migrations/` is
   never read (those files are human-readable mirrors), so the old advice here
   was a silent no-op.
2. Deploy; `migrate()` runs at container startup, one transaction per
   migration under a session advisory lock. A reversal that fails rolls back
   and the new container crash-loops on boot — test it on a copy first.
3. Remember invariant 14 (expand/contract, `docs/SELF-UPDATE.md`): a
   `DROP COLUMN` reversal while an older image is what you are rolling back to
   is exactly the case it forbids.

Example — dropping a column added by mistake:
```js
// server/config/schema.js — appended to the migrations array
{
  name: '085_drop_some_column',
  statements: ['ALTER TABLE projects DROP COLUMN IF EXISTS some_column'],
},
```

The DATA rollback is Postgres point-in-time restore (`README.md` → Database
Backup Strategy, 7-day retention): a restore creates a new server and
`DATABASE_URL` is repointed at it.

---

## Container Registry Housekeeping

A scheduled ACR task named `weekly-purge` (created 2026-06-11 UTC) lives in Azure —
not in this repo — and prunes old images from `hallismileyacr` every Sunday at
03:00 UTC. Its step, read from the task on 2026-09-12:
`acr purge --filter 'hallismiley:.*' --ago 14d --keep 10 --untagged` — keep the
10 newest tags on the `hallismiley` repository, delete every tag older than 14
days beyond those, plus untagged manifests (last three runs succeeded). The
`ferdabox` repository is not matched by the filter. Without this task the
registry grows ~340 MB per deploy forever — it had reached 38.5 GB (vs. 10 GB
included in the Basic tier) before the first manual purge on 2026-06-10.

Two consequences of the rule (2026-09-12): every deploy now pushes two SHA tags
(`:<sha>` and `:sha-<sha>`), so "keep 10" protects roughly the last FIVE builds
beyond 14 days — rollback-by-older-SHA depth is that, not ten deploys. And any
`:stable` / `:canary` tag `promote.yml` ever creates matches the filter: after
14 days it is purged, and `--untagged` can then delete the very digest a
published manifest points at — lock a promoted digest's tag (recipe below).
Changing the filter is an ACR task edit, Halli's act.

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

**Retention / pruning (manual).** Nothing prunes `page_views` or
`analytics_events`: the two daily in-process timers in `server/server.js` cover
`event_logs` (`EVENT_LOG_RETENTION_DAYS`, default 90) and expired
`user_sessions` (the update checker is also started but returns immediately
while the self-update module is off), and both timers restart with the
container — a container recycled daily never reaches its 24 h tick, only the
boot run. So these two tables grow until pruned. `page_views` is the only one that grows quickly;
`analytics_events` is tiny (conversions only) — keep it. To prune old views
(e.g. older than ~13 months), run against the target DB:

```bash
psql "$DATABASE_URL" -c "DELETE FROM page_views WHERE created_at < NOW() - INTERVAL '400 days';"
```

For a low-traffic portfolio this is a once-a-year chore at most.

---

## Bókhald (the books)

Full design notes: `docs/BOOKKEEPING-SYSTEM.md`. Open accountant questions:
`docs/ACCOUNTANT-QUESTIONS.md`. This section is the operational half only.

### First-run setup (in this order)

The books refuse to issue documents until the seller identity is set, and every books
screen shows a standing warning until each step is done. That is the mechanism, not a
nag.

1. **Seller identity**: seller name, kennitala, VSK number, address. **There is no
   settings screen in the base** (orangesmiley built one; it never came upstream) —
   set them through the API, `PATCH /api/v1/admin/bookkeeping/settings`
   (`server/routes/adminBookkeepingRoutes.js`), with a CSRF token. Nothing can be
   invoiced without these — an invoice without them is not a valid sales document
   under Reglugerð 50/1993.
2. **Confirm the chart of accounts.** Clears the `coa_confirmed_at` warning (same
   PATCH). Take the chart to the accountant first; changing an account code after
   entries exist is expensive, because history cannot be re-pointed.
3. **EUR rate**, if invoicing in EUR: `npm run books:fx -- --date=YYYY-MM-DD --rate=NNN.NN`.
   An EUR invoice is **blocked** with no rate on file, or with a rate older than 14 days
   (`FxRate.MAX_STALENESS_DAYS`), rather than guessing one.
4. **Payroll**, if running it: enter the year's figures and **confirm** them. Payroll
   refuses to compute against an unconfirmed year.
5. **Opening balances**, if the business existed before these books: post the changeover
   trial balance as one manual entry at `/admin/books/ledger`.

### Every two months: the VSK return

1. `/admin/books/vat` → pick the period. The figures are derived from the ledger; there is
   no separate VAT total to reconcile against.
2. Work the **preflight**. Blockers mean the return would be knowably wrong. They can be
   overridden, but the reason is stored with the return.
3. File. This snapshots the figures and **locks the period** — nothing can be posted into
   it afterwards without an explicit unlock.
4. Filing itself posts the settlement entry (VAT accounts → `2290 Virðisaukaskattur
   til greiðslu`, dated the last day of the period — `vatService.js`). Paying
   Skatturinn is a separate event with no endpoint: record the bank line as
   `explained` against 2290 in reconciliation, or post a manual entry
   Dr 2290 / Cr 1900 **dated the payment date** — the filed period is locked
   (`books_assert_period_open`), so a back-dated entry is refused.

**Unlocking a filed period** is audited and reverses the settlement entry on its own date.
Do it only to correct a real error, and expect the correction to be visible in the journal
as a correction — that is the point.

### Every year: the archive (this is the compliance step)

Bókhaldslög 145/1994 gr. 20 requires seven years of records **kept in Iceland**. This
application runs on Azure, and **Azure has no Iceland region** — the nearest are North
Europe (Dublin) and West Europe (Amsterdam). The archive export is therefore not a
convenience; it is the only route to compliance.

```bash
npm run books:archive -- --out=/path/to/archive/2026 --year=2026
npm run books:archive -- --verify-only --out=/path/to/archive/2026
```

Then copy the directory to media **physically in Iceland** and keep it. Run the verify
afterwards, from the copy: a backup nobody has ever read back is a hope, not a record.

The manifest carries a SHA-256 per file and, for each document, **both** the checksum
recorded at upload and the one computed now. A mismatch is reported and the exit code is
non-zero — it is never quietly re-recorded, because the recorded checksum is the only
evidence that a file has not changed since it was filed.

The export also fails loudly if the trial balance does not balance. That means the books
are wrong, not the archive.

### Every January: the payroll rates

Skatturinn re-sets the withholding bands, persónuafsláttur, tryggingagjald and the pension
percentages. Payroll **will not run** until someone enters the new year's figures and
confirms them with a note saying what they checked against.

There is a `rates_review` deadline seeded in `tax_deadlines` for this.

Two things to get right, both of which produce a believable wrong number:

- The band rate is the **combined** figure (tekjuskattur + útsvar) as published. Entering
  tekjuskattur alone under-withholds by roughly a third. The system refuses a band at or
  below the municipal rate for exactly this reason.
- `municipal_rate` should be **this business's registered municipality**, not the national
  average that is currently in there.

### Common books incidents

**"Cannot issue invoices yet"** — seller name, kennitala or VSK number missing. Books
settings.

**An EUR invoice is refused** — no exchange rate on file for the issue date, or the newest
one is older than 14 days. `npm run books:fx`. The refusal is deliberate: a guessed rate silently
misstates revenue.

**"Payroll figures have not been confirmed"** — working as designed. Enter and confirm the
year.

**A payroll run is blocked on an owner's salary** — below the RSK reiknað endurgjald
minimum for their category. Either raise the salary or override with a written reason,
which is stored on the run.

**A period is locked** — it has a filed VSK return. Unlock it deliberately, with a reason,
or post to the next period.

**The trial balance does not balance** — this should be impossible; a deferred constraint
trigger enforces per-entry balance. If it happens, it is a bug in the ledger and not a
data-entry mistake. Do not trust any other report until it is resolved.

**A user cannot be deleted** — they have posted an accounting entry, and
`journal_entries.created_by` is `ON DELETE RESTRICT` because Reglugerð 505/2013 gr. 8
requires an identifiable person behind every entry. Deactivate them instead.

**A document will not open** — `documentService` re-checks the SHA-256 on every read and
refuses a file that no longer matches what was stored. That is a real integrity failure;
restore the file from an archive rather than clearing the checksum.

### Do not

- **Do not edit a migration that has been applied anywhere.** Add a new one. Editing 072
  after the dev database had it cost a full drop-and-re-migrate of ~21 tables.
- **Do not UPDATE posted accounting rows** to fix something. The triggers will refuse, and
  they are right to. Reverse, or credit-note.
- **Do not add a second set of totals.** If a figure is needed, derive it from
  `journal_lines`.
- **Do not seed payroll rates for a future year from memory.** Four authoritative-looking
  numbers nobody has checked is precisely what the confirmation gate exists to prevent.

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

### No response, or Azure's own error page (Node is not listening)

`/health` is unconditional 200 whenever the process is up (`server/app.js`) —
it never returns 503. If it does not answer at all, the container has not
reached `listen()`: a boot failure, a failed migration (`[server] Startup
failed` in the log), or missing app settings.

1. Tail container logs:
   ```bash
   az webapp log tail --resource-group hallismiley-rg --name hallismiley-app
   ```
2. Verify required app settings are in place:
   ```bash
   az webapp config appsettings list --resource-group hallismiley-rg --name hallismiley-app -o table
   ```
   Missing `DATABASE_URL`, `CSRF_SECRET`, `ALLOWED_ORIGINS` or `NODE_ENV` (and
   `UPLOAD_ROOT` under `NODE_ENV=production`, `RESEND_API_KEY` under
   `APP_ENV=production`) are startup failures (`server/server.js`
   `REQUIRED_ENV`, `server/config/paths.js`). Compare against `.env.example`.

### `/ready` returns 503 while `/health` returns 200 (Node is up, a dependency is not)

`/ready` flips to 503 on exactly three conditions: the `SELECT 1` fails or
exceeds 3 s, `pool.waitingCount > 5`, or the DB circuit breaker is `open`
(`half-open` reports `degraded` at 200). Memory and event-loop lag are reported
in `checks` but never flip it. A DB failure also logs a pino line tagged
`event: 'alert'` (`observability/securityLogger.js`), greppable in the log tail.

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

1. Hit `/ready` directly — if it is 200, the source is a bot/crawler.
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

Two probes, and they answer different questions (`server/app.js`):

```bash
curl https://www.hallismiley.is/health     # liveness: 200 whenever the process is up
curl https://www.hallismiley.is/ready      # readiness: 200 only when the DB answers, the pool is not backed up and the breaker is closed
```

`/health` answers `{ "status": "ok", "uptime": 12345, "timestamp": "…" }` and
**never checks the database** — a 200 there with a dead Postgres is normal.
`/ready` answers `200` with a `checks` object (database, dbPool,
circuitBreaker, memory, eventLoop) or `503` with the failing check named; only
the database check, `pool.waitingCount > 5` and an open breaker flip it.
Both probes are public and exempt from the HTTPS and canonical-host redirects,
so they answer on the apex and on `hallismiley-app.azurewebsites.net` too.
The previous version of this section documented a `"database"` key on
`/health` that never existed (fixed 2026-09-12).

`/ready`'s `uptime` is the cheapest proof that a deploy actually swapped the
container: it resets to seconds. The App Service health-check path is unset
(read 2026-09-12), so Azure itself never acts on a `/ready` 503.

### Merged but not live

A **red `Deploy to Azure` run** is one of two things (`.github/workflows/deploy.yml`):
`alert-ci-blocked` fired because CI on `main` was not `success` — including
**cancelled** — and the job exits 1 on purpose so the run shows red; or
`alert-deploy-failed` because the `deploy` job itself errored. Both try to
e-mail `halli@hallismiley.is` via Resend and **skip the e-mail silently unless
the `RESEND_API_KEY` repository secret exists — it does not (2026-09-12)**, so
the run colour is the only alert. On a healthy deploy both alert jobs show
`skipped`. Recovery: fix CI and re-run it (`gh run rerun <ci-run-id> --failed`
re-fires `workflow_run` on completion), or the emergency dispatch above — never
dispatch over a red CI run to skip it.

### Where an error goes

Every error is a pino line in the container log (`az webapp log tail`).
Sentry receives it only if `SENTRY_DSN` is set — it is not on the live site
(read 2026-09-12). The in-app alerts (`server/observability/alerts.js`) write to
the security log and post to a webhook only if `ALERT_WEBHOOK_URL` is set.
Two of them cannot fire in this repo: `checkMemory()` is never called, and
`trackRequest()` is only called from `/metrics` with `false`, so the 5 %
error-rate alert has no input — a code defect, not an operator setting. The
alerts that do work: brute-force login (5 failures / 5 min per IP) and the
`/ready` database failure.

### Event log (Admin → Monitoring)

Migration 083 added `event_logs`: server errors and the client error beacon
(`/api/v1/events`) land there and are read at `/admin/monitoring` (admin only;
API `/api/v1/admin/events`). Retention `EVENT_LOG_RETENTION_DAYS` (default 90),
pruned daily. Look there for error spikes and auth anomalies before reaching
for the log tail.

### `/metrics`

Prometheus text, gated by `Authorization: Bearer <METRICS_TOKEN>` (set on the
live site; without it the route is localhost-only in production). Nothing
scrapes it — exposed, unscraped; there is no dashboard.

### Self-update (`docs/SELF-UPDATE.md`)

On this site the module is off: every `/api/v1/system/*` route answers 404,
which is the module gate, not a broken deploy. When it is ever turned on:
`system_updates` rows (migration 082), post-boot verification marks a row
`failed` after a 15-minute grace with `failureReason` on `/admin/updates`, and
`POST /api/v1/system/updates/:id/rollback` re-triggers the previous digest.
Until then the image-pin recipe above IS the rollback.

---

## Environment Variable Reference

See `README.md → Environment Variables`, `docs/DEPLOYMENT.md` §5 (what each setting does in code) and `.env.example` for the full list.

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
