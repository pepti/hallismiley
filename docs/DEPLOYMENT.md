# Deployment Guide — Halli Smiley

This guide covers deploying the app to **Azure App Service** (Linux container)
with **Azure Container Registry** and **Azure Database for PostgreSQL Flexible
Server**. Deploys are triggered from GitHub Actions using OIDC federated
credentials — no long-lived Azure secrets in the repo.

For routine operational tasks (rollbacks, log access, common incidents),
see [`RUNBOOK.md`](../RUNBOOK.md). For environment variable reference, see
[`.env.example`](../.env.example). For the release channel that instances
scaffolded from this base poll, see [`SELF-UPDATE.md`](SELF-UPDATE.md).

Sections 1–5 and 7 are the provisioning recipes the live stack was built with
and are still the way to rebuild it. Sections 6, 8 and 9 describe what the
workflows and the boot code actually do — re-read against `.github/workflows/*`
and `server/` on 2026-09-12; live facts in this file are dated.

---

## Prerequisites

- Azure subscription with permission to create resource groups, registries,
  databases, and app services.
- `az` CLI installed and logged in (`az login`).
- A GitHub repository for the app (this guide assumes `pepti/hallismiley`).
- DNS control for your custom domain (only needed for custom-domain step).

The names below match the current production deployment. Swap them for your
own if you are deploying a fork.

| Resource | Name | Region |
| --- | --- | --- |
| Resource group | `hallismiley-rg` | West Europe |
| App Service plan | `hallismiley-plan` (B1 Linux, one worker, **no deployment slots** — read 2026-09-12; the worker is SHARED with `ferdabox-app`, so a scale-up or a memory problem is both sites') | West Europe |
| App Service | `hallismiley-app` | West Europe |
| Container registry | `hallismileyacr` | West Europe |
| Postgres Flexible Server | `hallismiley-db` | North Europe (West Europe was restricted) |
| Storage account | `hallismileyfs` (uploads file share) | West Europe |

---

## 1. Resource provisioning

```bash
# Resource group
az group create --name hallismiley-rg --location westeurope

# Container registry (Basic SKU is fine for a single app)
az acr create --resource-group hallismiley-rg --name hallismileyacr \
  --sku Basic --admin-enabled false

# App Service plan + app (Linux, B1)
az appservice plan create --resource-group hallismiley-rg --name hallismiley-plan \
  --is-linux --sku B1
az webapp create --resource-group hallismiley-rg --plan hallismiley-plan \
  --name hallismiley-app \
  --deployment-container-image-name hallismileyacr.azurecr.io/hallismiley:latest

# Grant the App Service permission to pull from ACR using its managed identity
az webapp identity assign --resource-group hallismiley-rg --name hallismiley-app
APP_PRINCIPAL_ID=$(az webapp identity show \
  --resource-group hallismiley-rg --name hallismiley-app --query principalId -o tsv)
ACR_ID=$(az acr show --name hallismileyacr --query id -o tsv)
az role assignment create --assignee "$APP_PRINCIPAL_ID" --role AcrPull --scope "$ACR_ID"
```

> **What the live app actually does (read 2026-09-12):** it pulls from ACR with
> registry admin credentials held in the `DOCKER_REGISTRY_SERVER_*` app
> settings (`acrUseManagedIdentityCreds` is false and the site has no managed
> identity). The identity recipe above is the intended end state; switching the
> live site to it is an Azure change, not a repo change.

---

## 2. Postgres Flexible Server

```bash
az postgres flexible-server create \
  --resource-group hallismiley-rg --name hallismiley-db \
  --location northeurope \
  --tier Burstable --sku-name Standard_B1ms \
  --storage-size 32 --version 16 \
  --admin-user halliadmin --admin-password '<STRONG_PASSWORD>' \
  --public-access 0.0.0.0  # Allow other Azure services; lock down further if needed

az postgres flexible-server db create \
  --resource-group hallismiley-rg --server-name hallismiley-db \
  --database-name hallismiley
```

Add your current IP to the server's firewall during initial setup if you need
to connect via `psql` from your laptop (the same rule is needed for the
`pg_dump`, seed and bootstrap recipes elsewhere in the docs):

```bash
MY_IP=$(curl -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group hallismiley-rg --name hallismiley-db \
  --rule-name dev-laptop --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
```

URL-encode the password when building `DATABASE_URL` by hand:
`node -e "console.log(encodeURIComponent(process.argv[1]))" '<password>'`.

Backups (read 2026-09-12): PITR retention **7 days**, geo-redundant backup
**disabled**, no HA. Recipes in `README.md` → Database Backup Strategy.

---

## 3. Persistent uploads — Azure Files

The container is read-only by default; uploaded media must live on a mounted
volume that survives container restarts and image swaps. `server/config/paths.js`
refuses to boot in production without `UPLOAD_ROOT`.

```bash
az storage account create \
  --resource-group hallismiley-rg --name hallismileyfs \
  --sku Standard_LRS --kind StorageV2 \
  --https-only true --min-tls-version TLS1_2
az storage share-rm create \
  --resource-group hallismiley-rg --storage-account hallismileyfs \
  --name uploads --quota 100

az webapp config storage-account add \
  --resource-group hallismiley-rg --name hallismiley-app \
  --custom-id uploads --storage-type AzureFiles \
  --account-name hallismileyfs --share-name uploads \
  --access-key "$(az storage account keys list -g hallismiley-rg -n hallismileyfs --query '[0].value' -o tsv)" \
  --mount-path /app/uploads
```

**Windows / Git Bash gotcha:** if `--mount-path /app/uploads` errors with
"contains invalid characters", prefix the command with `MSYS_NO_PATHCONV=1`
so MSYS doesn't rewrite the Linux path.

---

## 4. GitHub Actions OIDC trust

This lets `.github/workflows/deploy.yml` log into Azure without storing any
long-lived secrets in the repo.

```bash
# Create an Azure AD application + service principal for GitHub
az ad app create --display-name hallismiley-github-deploy
APP_ID=$(az ad app list --display-name hallismiley-github-deploy --query "[0].appId" -o tsv)
az ad sp create --id "$APP_ID"
SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# Role assignments
SUB_ID=$(az account show --query id -o tsv)
az role assignment create --assignee "$SP_ID" --role AcrPush --scope "$ACR_ID"
az role assignment create --assignee "$SP_ID" --role Contributor \
  --scope "/subscriptions/$SUB_ID/resourceGroups/hallismiley-rg/providers/Microsoft.Web/sites/hallismiley-app"

# Federated credential — trust the main branch
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main-branch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:pepti/hallismiley:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Repo secrets used by deploy.yml
gh secret set AZURE_CLIENT_ID       --body "$APP_ID"
gh secret set AZURE_TENANT_ID       --body "$(az account show --query tenantId -o tsv)"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUB_ID"
```

These three are the only repository secrets that exist (read 2026-09-12). Two
more things the workflows can use are **not** set:

- `RESEND_API_KEY` as a repository secret — without it the two alert jobs in
  `deploy.yml` skip their e-mail step (see §6). This is a different store from
  the App Service setting of the same name.
- The four repository **variables** `promote.yml` needs (§6b).

---

## 5. App Settings (environment variables)

Set everything via `az webapp config appsettings set` so the values survive
container restarts and are visible in the portal. See `.env.example` for the
authoritative list. Every settings write restarts the container.

```bash
# Required — the server exits at boot without these
az webapp config appsettings set --resource-group hallismiley-rg --name hallismiley-app \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    DB_SSL=true \
    DATABASE_URL="postgresql://halliadmin:<url-encoded-password>@hallismiley-db.postgres.database.azure.com:5432/hallismiley?sslmode=require" \
    ALLOWED_ORIGINS="https://hallismiley.is,https://www.hallismiley.is,https://hallismiley-app.azurewebsites.net" \
    CSRF_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
    APP_URL="https://www.hallismiley.is" \
    UPLOAD_ROOT="/app/uploads" \
    METRICS_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"

# Email — Resend is the only transport (server/services/emailService.js)
az webapp config appsettings set --resource-group hallismiley-rg --name hallismiley-app \
  --settings \
    RESEND_API_KEY=<from-resend> \
    EMAIL_FROM=noreply@hallismiley.is   # the live value (read 2026-09-12); the code default is halli@hallismiley.is

# OAuth (Google sign-in) — only if SOCIAL_LOGIN_ENABLED=true
az webapp config appsettings set --resource-group hallismiley-rg --name hallismiley-app \
  --settings \
    GOOGLE_CLIENT_ID=<from-google-console> \
    GOOGLE_CLIENT_SECRET=<from-google-console> \
    GOOGLE_REDIRECT_URI=https://www.hallismiley.is/auth/google/callback
```

What each of these does in code: `NODE_ENV`, `DATABASE_URL`, `ALLOWED_ORIGINS`
and `CSRF_SECRET` are `REQUIRED_ENV` in `server/server.js`; `UPLOAD_ROOT` is
required by `server/config/paths.js` when `NODE_ENV=production`; `DB_SSL` is
on by default in production anyway (`server/config/database.js` — `false` is
the documented opt-out, never for Azure); `APP_URL` builds every e-mail link,
the canonical tags, the sitemap **and, in production, the canonical-host 301**
(`server/app.js` derives the host from it); `METRICS_TOKEN` gates `/metrics`.

**`APP_ENV`** is the deployment's own label (`test` on a TEST stack,
`production` here; unset on the live site as of 2026-09-12). Every reader
(`requireTestEnv.js`, `ssrMeta.js`, the MCP env tag) already resolves to
production when it is unset under `NODE_ENV=production`, so setting
`APP_ENV=production` changes exactly one thing: it **arms the boot guard** in
`server/server.js` that refuses to start without `RESEND_API_KEY`. Order of
operations if you set it: confirm `RESEND_API_KEY` is present in the app
settings (it is, as of 2026-09-12), then add `APP_ENV=production` in the same
`appsettings set`. Never set `APP_ENV=test` on the live site — that would
switch on the TEST chrome and the change-request widget for every visitor.

**Do not set** `SMTP_USER`, `SMTP_PASS` or `REQUIRE_EMAIL_VERIFICATION`: nothing
in the code reads them (the mail transport is Resend; e-mail verification is
optional in code, not env-gated). All three are still present on the live App
Service from an earlier version of this guide (read 2026-09-12) — harmless, and
removing them is optional; batch it with a real settings change since each
write restarts the app.

Enable HTTPS-only and turn off the legacy FTPS endpoint:

```bash
az webapp update --resource-group hallismiley-rg --name hallismiley-app --https-only true
az webapp config set --resource-group hallismiley-rg --name hallismiley-app --ftps-state Disabled
```

---

## 6. CI → deploy: what actually runs

**`ci.yml`** runs on every push and pull request to `main`. **It has no
`paths` / `paths-ignore` filter**, so a markdown-only change runs the whole
workflow and, on `main`, deploys. Three jobs (`test`, then `e2e` and `docker`,
both `needs: test`), each with its own `postgres:16-alpine` service, all on
Node 24: `npm audit --audit-level=high` → lint → `npm run check:i18n` → Jest
with coverage (`test:ci`); Playwright; Docker build + boot smoke test
(`NODE_ENV=production` with `UPLOAD_ROOT` and `DB_SSL=false` declared, `/health`
and `/ready` probed). A pull-request run is cancelled by a newer push to the
same PR; runs on `main` are never cancelled.

**`deploy.yml`** triggers on `workflow_run` of CI on `main` (fail-closed: only
when CI concluded `success`, and it deploys the exact SHA CI validated) or by
manual `workflow_dispatch`. It builds and pushes
`hallismileyacr.azurecr.io/hallismiley:latest`, `:<sha>` and `:sha-<sha>`,
stamping the image's identity (`GIT_SHA`, `BUILT_AT`, `RELEASE_CHANNEL=stable`
→ `server/version.json`, `docs/SELF-UPDATE.md`), points the App Service at
`:<sha>` and **force-restarts** (on B1 without slots the tag update alone does
not reliably swap the container — 2026-04-24). Migrations run at container
startup via `server/scripts/migrate.js`; there is no manual step. Typical
merge-to-live time: CI ≈ 12 min + deploy ≈ 2 min + restart; the gap during
the restart is ~30–60 s.

**The two alert jobs.** `alert-ci-blocked` runs when CI on `main` did not
succeed (red **or cancelled**) and **deliberately exits 1** so the Deploy run
shows red — that red run IS the alert that merged code is not live.
`alert-deploy-failed` runs when the `deploy` job errored (`always()` is what
lets it observe the failure). Both try to e-mail `halli@hallismiley.is` via
Resend and **skip the e-mail cleanly when the `RESEND_API_KEY` repository
secret is unset — which it is (2026-09-12)**, so today the run colour is the
only signal. On a healthy deploy both jobs show `skipped`; that is normal.
Recovery after red CI: fix, re-run (`gh run rerun <ci-run-id> --failed` re-fires
`workflow_run` on completion); never dispatch `deploy.yml` over a red CI run.

Emergency override without waiting for CI:

```bash
gh workflow run "Deploy to Azure" --ref main
```

### 6b. The release channel (`promote.yml`) — present, unarmed

`promote.yml` retags an already-built image **by digest** to `canary` or
`stable` and publishes the channel manifest that self-update instances poll
(`docs/SELF-UPDATE.md`). Inputs: `sha` (the full SHA deploy.yml built),
`channel`, `critical`, `min_compatible`, `dry_run`. It resolves the image as
`hallismiley:sha-<sha>` — a tag `deploy.yml` only started pushing on
2026-09-12, so **only images built from that merge onward are promotable**. It
also requires four repository variables — `ACR_NAME`, `IMAGE_NAME`,
`RELEASE_STORAGE_ACCOUNT`, `RELEASE_CONTAINER` — and **none exist** on
`pepti/hallismiley` (read 2026-09-12): a non-dry run exits at its first step.
Arming it is a GitHub-settings act, and the intended release host lives in the
company tenant while this deploy identity is in the personal tenant, so the
cross-tenant upload is its own decision. `RELEASE_CHANNEL` stamped into the
image is informational — the checker reads the channel from the instance's
own settings, so a digest promoted to `canary` still says `stable` inside.

### 6c. Registry housekeeping interacts with the tags

The ACR task `weekly-purge` (Sundays 03:00 UTC, verified 2026-09-12) runs
`acr purge --filter 'hallismiley:.*' --ago 14d --keep 10 --untagged`. With two
SHA tags per build, "keep 10" protects roughly the last five builds beyond
14 days, so rollback-by-older-SHA depth is that, not ten deploys. Any
`:stable` / `:canary` tag promote.yml ever creates matches the filter and is
purged after 14 days, after which `--untagged` can delete the very digest a
published manifest points at — lock a promoted digest's tag
(`RUNBOOK.md` → Container Registry Housekeeping). Changing the filter is an
ACR task edit, Halli's act.

---

## 7. Custom domain + SSL

```bash
# Add the apex and www records in your DNS provider:
#   hallismiley.is        →  A     <azure-app-ip-from-portal>
#   www.hallismiley.is    →  CNAME hallismiley-app.azurewebsites.net
# Then validate ownership:
az webapp config hostname add --resource-group hallismiley-rg \
  --webapp-name hallismiley-app --hostname www.hallismiley.is
az webapp config hostname add --resource-group hallismiley-rg \
  --webapp-name hallismiley-app --hostname hallismiley.is

# Provision App Service Managed Certificates (free) for both:
az webapp config ssl create --resource-group hallismiley-rg \
  --name hallismiley-app --hostname www.hallismiley.is
az webapp config ssl create --resource-group hallismiley-rg \
  --name hallismiley-app --hostname hallismiley.is

# Bind both certs SNI to enforce HTTPS:
for HOST in www.hallismiley.is hallismiley.is; do
  THUMB=$(az webapp config ssl list --resource-group hallismiley-rg \
            --query "[?subjectName=='$HOST'].thumbprint | [0]" -o tsv)
  az webapp config ssl bind --resource-group hallismiley-rg \
    --name hallismiley-app --certificate-thumbprint "$THUMB" --ssl-type SNI
done
```

Remember to add the HTTPS origins to `ALLOWED_ORIGINS` (step 5) or CORS will
reject browser requests. Both certificates expire 2027-02-01 (GeoTrust, read
2026-09-12); whether they auto-renew is decided by `az webapp config ssl list`
(managed certificates do) — no doc names an owner for the renewal.

---

## 8. Verifying the deployment

| Check | URL | Expected |
| --- | --- | --- |
| Liveness | `GET /health` | `200 {"status":"ok","uptime":…,"timestamp":…}` — **no DB check** |
| Readiness (DB + pool + breaker) | `GET /ready` | `200 {"status":"ok","checks":{…}}`; `503` when the DB check fails, the pool has more than 5 waiters, or the breaker is open. Memory and event-loop lag are reported, never flip it |
| Prometheus metrics | `GET /metrics` | `200 text/plain` with `Authorization: Bearer <METRICS_TOKEN>` (localhost-only in production when unset) |

A healthy deploy returns `200` on `/ready` once the container has finished
booting and connected to Postgres — `/health` 200 with `/ready` 503 is the
normal boot window (migrations run before `listen()`). If `/ready` stays `503`,
tail the container logs via `az webapp log tail` (see RUNBOOK).

Proof that the **new** image is running (the 2026-04-24 incident was six green
deploys serving a 10-hour-old image): `/ready`'s `uptime` resets to seconds,
and `az webapp config container show -g hallismiley-rg -n hallismiley-app
--query linuxFxVersion` names the new `:<sha>`. Proof of the build identity:
the deploy run's build log prints `[version] … <sha> (stable) @ <builtAt>`
(from `scripts/generate-version.js`); `az acr repository show-tags --name
hallismileyacr --repository hallismiley --orderby time_desc --top 5` lists
`sha-<sha>`. `GET /api/v1/system/version` is **404 on this site** — the
self-update module ships off and there is no `config/client.json` — so do not
use it as the check.

There is no App Insights, metric alert or availability test on this
subscription (read 2026-09-12), and the App Service health-check path is
unset, so nothing in Azure notices a `/ready` 503 on its own.

---

## 9. Rollback

See [`RUNBOOK.md` → Rollback Procedures](../RUNBOOK.md#rollback-procedures)
for the canonical procedure. Summary: point the App Service at a previous
`:<sha>` tag from ACR and force-restart — no CI rerun, no rebuild, ~1 minute end
to end. Migrations are forward-only and expand/contract (`SELF-UPDATE.md`), so
an image rollback within one release needs no schema rollback.

---

## Runtime version

`Dockerfile` pins `node:24-alpine` by digest in both stages; `ci.yml` sets
`node-version: 24` in both jobs; `promote.yml` the same. **Five pins in three
files move together** — `dependabot.yml` keeps the digest patched inside Node
24 and is configured not to major-bump the base image on its own (Node 26 is
Current, not LTS).

---

## Initial admin user

There is no public sign-up for admin accounts. To create the first admin run
the bootstrap script with **all three** of `ADMIN_USERNAME`, `ADMIN_EMAIL` and
`ADMIN_PASSWORD` in the environment — with any of them missing it migrates,
creates no admin and exits 0 — locally against the prod DB (firewall rule from
§2):

```bash
DATABASE_URL='postgresql://halliadmin:<pw>@hallismiley-db.postgres.database.azure.com:5432/hallismiley?sslmode=require' \
DB_SSL=true \
ADMIN_USERNAME=halli ADMIN_EMAIL=halli@hallismiley.is ADMIN_PASSWORD='<strong-password>' \
node server/scripts/bootstrap.js
```

or `node server/scripts/setup-admin.js <username> <email> <password>`. Keep the
credentials in a password manager — there is no recovery flow without
database access. Admins then enrol in TOTP from the profile.
