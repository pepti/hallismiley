# Deployment — Orange Smiley (orangesmiley.is)

**State as of 2026-09-11: this repo has no deployed instance.** The company
Azure tenant exists (COMPANY-LOG, gitignored), but **no provisioning or deploy
happens without Halli's explicit go-ahead** (CLAUDE.md). Everything below
describes what the repo's workflows and boot code actually do today, so that
arming a deploy later is a matter of setting variables, not editing YAML.

This file was rewritten 2026-09-11. The previous version was the HalliProjects
base's guide to the owner's personal `hallismiley-*` Azure resources and an
auto-deploy pipeline this repo deliberately removed; it also set an env var
nothing reads (`REQUIRE_EMAIL_VERIFICATION`) and SMTP settings the app has not
used since it moved to Resend.

For routine operations see [`RUNBOOK.md`](../RUNBOOK.md); for every env var
see [`.env.example`](../.env.example); for the release channel see
[`SELF-UPDATE.md`](SELF-UPDATE.md).

---

## 1. What runs in CI (`.github/workflows/ci.yml`)

Push and pull request to **`master`** (the long-lived branch; it said `main`
until 2026-09-02 and CI had never run) plus a weekly cron. No `paths-ignore`:
docs-only changes run the full workflow. Three independent jobs, each with its
own `postgres:16-alpine` service, all on Node 24:

1. `test` — `npm audit --audit-level=high`, lint, `check:i18n`, runner spec,
   release-manifest schema, Jest with coverage.
2. `e2e` — Playwright against a booted server.
3. `docker` — image build, Trivy (`HIGH,CRITICAL`, unfixed ignored), boot
   smoke test with `UPLOAD_ROOT` and `DB_SSL=false` declared, readiness probe.

**CI green is the merge gate. Nothing deploys from CI.**

## 2. The image (`Dockerfile`)

- Two-stage build on `node:24-alpine@sha256:d32cdf61…` (digest-pinned; both
  stages). **The Node major in the Dockerfile, `ci.yml`'s `node-version: 24`
  and the CLAUDE.md invariant move together** — dependabot's docker ecosystem
  is configured not to major-bump the base image on its own.
- `apk upgrade` runs behind `ARG APK_REFRESH` (deploy passes the run id so the
  layer is not served from cache); the bundled npm CLI is removed from the
  runtime image (LESSONS 2026-09-03).
- `scripts/generate-version.js` writes `server/version.json` from the build
  args `APP_VERSION` / `GIT_SHA` / `BUILT_AT` / `RELEASE_CHANNEL` — this is the
  identity the self-update checker compares against a published release. A
  local build without the args reports `version: "dev"`.
- Runs as `appuser`, `EXPOSE 3000`, `HEALTHCHECK` on the liveness route,
  `CMD node server/server.js`. Migrations (`server/scripts/migrate.js`) run at
  boot; there is no separate migration step.

Known drift (not fixed here): `promote.yml` sets up Node **20** for the
manifest builder while everything else is on 24.

## 3. The deploy workflow (`.github/workflows/deploy.yml`) — dispatch-only, inert

Neutralised 2026-08-19 (ENHANCEMENTS #1). Trigger is `workflow_dispatch`
**only**; the base's auto-deploy-on-green-CI `workflow_run` trigger was
deliberately dropped and re-adding it is a decision for when the company stack
exists. Every target is a repository variable; the first step is a guard that
fails before login if any is unset, so a dispatch today touches nothing:

| Setting | Kind | Used for |
|---|---|---|
| `ACR_NAME`, `IMAGE_NAME`, `WEBAPP_NAME`, `RESOURCE_GROUP` | `vars.*` (required by the guard) | registry, image name, App Service, resource group |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | `secrets.*` | OIDC federated login (no long-lived Azure secret) |
| `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` + `RESEND_API_KEY` | `vars.*` + `secrets.*` (optional) | the deploy-failed alert email; skipped cleanly when unset |

What a dispatched run does once armed: checkout at the dispatched SHA
(`fetch-depth: 50`) → `node server/scripts/generate-changes.js` (stamps the
"Latest updates" card) → Azure login → `az acr login` → Buildx build + push
tagged `:latest`, `:<sha>`, `:sha-<sha>` (single-arch manifest, `provenance:
false`) → print the digest → **Trivy on the pushed image, before the web app
is pointed at it** → `azure/webapps-deploy` → `az webapp restart` (the tag
update alone does not reliably swap the container on slot-less tiers).

Arming = set the variables/secrets on the GitHub repo. No workflow edit.
Whether they are set is a GitHub setting — read it there, do not infer it from
this file.

## 4. The release channel (`.github/workflows/promote.yml`) — dispatch-only

Retags an already-built image **by digest** to `canary` or `stable` and
regenerates the channel manifest every instance polls (`docs/SELF-UPDATE.md`).
Inputs: `sha` (the full SHA deploy.yml built), `channel`, `critical`,
`min_compatible`, `dry_run`. It needs two more repository variables than
deploy.yml: `RELEASE_STORAGE_ACCOUNT` and `RELEASE_CONTAINER` (the blob
container that serves `stable.json` / `canary.json`), checked at the start
unless `dry_run`. Rollout discipline is in the file header: promote to canary,
soak on Orange Smiley's own instances 24–48 h, promote the SAME sha to stable.

The manifest's changelog section comes from `CHANGELOG.md` by `## [version]`
heading (`scripts/build-manifest.js`), with the version from `package.json` —
a missing section publishes an empty changelog silently, so keep the heading
for the version being promoted.

## 5. What the container needs at boot

`server/server.js` refuses to start (exit 1, before listening) without:

| Variable | Note |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `ALLOWED_ORIGINS` | comma-separated CORS origins |
| `CSRF_SECRET` | 32+ random chars |
| `NODE_ENV` | `production` on every deployed stack (also on TEST stacks — it is not the environment label) |
| `RESEND_API_KEY` | **required when `APP_ENV=production`** — a silent mail transport would no-op verification, resets and receipts while returning 200 |
| `UPLOAD_ROOT` | required when `NODE_ENV=production` (`server/config/paths.js` throws) — the persistent uploads mount, e.g. `/app/uploads` |

Also set on any real instance:

| Variable | Why |
|---|---|
| `APP_ENV` | `production` / `test` — the environment label (`server/config/appEnv.js`); drives the RESEND rule above, the MCP `[TEST]/[PROD]` tag and the change-request gate |
| `APP_URL` | links in every transactional email; **the code default is the base's `https://www.hallismiley.is`** (`emailService.js`) |
| `EMAIL_FROM` | sender; **the code default is the base's `halli@hallismiley.is`** — set `info@orangesmiley.is` (CLAUDE.md) |
| `LEAD_NOTIFY_EMAIL` | inbox for `/hafa-samband` leads (defaults to `EMAIL_FROM`) |
| `DB_SSL` | TLS is **on by default in production**; `false` is the documented opt-out for a plain-TCP Postgres (CI only, never Azure) |
| `METRICS_TOKEN` | bearer for `GET /metrics`; blank = localhost only |
| `PORT` | App Service sets `8080` for Linux containers; default 3000 |
| `BOOKS_UPLOAD_ROOT` | the books' fylgiskjöl — point OUTSIDE the checkout on a backed-up disk |
| `SELF_UPDATE_TRIGGER_URL` | the platform's deployment webhook; without it an update can be recorded but not applied |
| `MCP_ENABLED` etc. | see `docs/mcp.md` |

Do **not** set `SMTP_USER` / `SMTP_PASS` / `REQUIRE_EMAIL_VERIFICATION` —
nothing reads them (the mail transport is Resend).

## 6. Provisioning, when Halli says go

The shape is the base's: Azure App Service (Linux container) pulling from an
Azure Container Registry with its managed identity (`AcrPull`), Azure
Database for PostgreSQL Flexible Server (v16, TLS), an Azure Files share
mounted at `/app/uploads`, OIDC federated credential for the GitHub repo with
subject `repo:orange-smiley/orangesmiley:ref:refs/heads/master`, HTTPS-only,
FTPS disabled. Resource names, regions and SKUs are decided at provisioning
time and recorded in the gitignored `company/` folder and as the `vars.*`
above — this file will not carry them until they exist. The `azure-ops` skill
holds the fleet provisioning pattern.

Bookkeeping note (RUNBOOK → Bókhald): Azure has no Iceland region, so the
yearly books archive to media in Iceland is the compliance step, not a nicety.

## 7. Verifying a deployment

| Check | URL | Expected |
|---|---|---|
| Liveness | `GET /health` | `200 {"status":"ok","uptime":…,"timestamp":…}` — **no DB check** |
| Readiness (DB + breaker + memory) | `GET /ready` | `200 {"status":"ok", "checks": {…}}`; `503` while not ready |
| Prometheus metrics | `GET /metrics` | `200 text/plain` with `Authorization: Bearer <METRICS_TOKEN>` |
| Build identity | `GET /api/v1/system/version` (session with the `updates` view) | `gitSha` = the dispatched SHA |
| Latest changes | Admin → Monitoring | the commits `generate-changes.js` stamped |

## 8. Rollback

Image-pin: point the App Service at a previous `:sha-<sha>` tag and restart
(RUNBOOK → Rollback). Git revert + merge only runs CI; a deploy is still a
dispatch. Migrations are forward-only and must be expand/contract (stack
invariant 14), so an image rollback never needs a schema rollback within one
release.

## 9. First admin

No public sign-up for admins. Run the bootstrap against the target database
with **all three** of `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` set —
`server/scripts/bootstrap.js` creates no admin and exits 0 if any is missing —
or `node server/scripts/setup-admin.js <username> <email> <password>`, which
writes the user row directly (scrypt hash). Admin accounts must then enrol in
TOTP from the profile (2FA is enforced for admins and `accounts` holders).
