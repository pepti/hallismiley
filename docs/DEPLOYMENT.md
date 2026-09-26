# Deployment — Orange Smiley (orangesmiley.is)

**State as of 2026-09-22: https://www.orangesmiley.is is live** — the public
site only, production only (not ops — D-020 step 2 split); the stack and its
ids are in §6. **No provisioning or deploy happens without Halli's
explicit go-ahead** (CLAUDE.md), and each Part D step in §6 is his hand.

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

Push and pull request to **`master`** / `main` plus a weekly cron. Every push
runs the full workflow; a documentation-only PR skips it and
`ci-skipped.yml` answers the three check names instead (running the unit tier,
which tests the docs). All on Node 24 (details and the why: `docs/TESTING.md`
→ "What CI actually runs"):

1. **Lint + Integration tests** — `lint` (audit, lint, `check:i18n`,
   release-manifest schema), Jest in three parallel shards, and the aggregator
   job of that name, which merges the coverage maps and enforces the floor
   (since 2026-09-24, icelandicstore #356).
2. `e2e` — Playwright against two booted servers.
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
  `CMD node server/server.js`. Migrations (`server/scripts/migrate.js`, the
  engine array plus the product array — `docs/MIGRATIONS.md`) run at boot; there
  is no separate migration step. Before the first boot of a merged engine on a
  live database, run `node server/scripts/migrate.js --plan` against a restored
  copy: it prints RUN / ALIAS / SUPERSEDED per entry and executes nothing.

`promote.yml` sets up the same Node 24 (it was on 20 until 2026-09-12).

## 3. The deploy workflow (`.github/workflows/deploy.yml`) — dispatch-only, by digest

Neutralised 2026-08-19 (ENHANCEMENTS #1); rebuilt 2026-09-22 from the
rekstrarkerfid workflow (build once, deploy by digest), cut to this repo's one
stack — production, no TEST. Trigger is `workflow_dispatch` **only**, with an
optional full-length `sha` input (how a rollback build gets deployed); no
auto-deploy on green CI. The job runs in the GitHub environment
**`production`** (the OIDC subject), where the target variables live; the first
step is a guard that fails before login if any is unset:

| Setting | Kind | Used for |
|---|---|---|
| `ACR_NAME`, `IMAGE_NAME`, `WEBAPP_NAME`, `RESOURCE_GROUP` | environment `vars.*` (required by the guard) | registry, image name, App Service, resource group |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | `secrets.*` | OIDC federated login (no long-lived Azure secret) |
| `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` + `RESEND_API_KEY` | `vars.*` + `secrets.*` (optional) | the deploy-failed alert email; skipped cleanly when unset |

What a dispatched run does: checkout at the sha (`fetch-depth: 50`) →
`generate-changes.js` (the "Latest updates" card) → Azure login → `az acr
login` → look `:<sha>` up in the registry → **build + push only if it is not
there** (`:latest`, `:<sha>`, `:sha-<sha>`; single-arch, `provenance: false`)
→ resolve the **digest** and print it with the image it replaces (the rollback
target) in the run summary → **Trivy on that digest before the web app is
pointed at it** → `webapps-deploy` with `registry/image@sha256:…` → `az webapp
restart` → poll `/ready` until it answers **as the shipped build**: its
`X-App-Build` header must equal `sha256(<sha>)[:12]` (the old container answers
200 too — ice measured ~80 s of that). An image too old to send the header is
accepted only from a process **younger than the swap** (since 2026-09-24,
icelandicstore #358/#394; `tests/integration/buildHeader.test.js` pins the
formula to `server/config/version.js`).

With no TEST stack, what stands between a commit and the live site is ci.yml
(tests + boot smoke on the same commit) and the Trivy gate: **dispatch only a
sha whose CI run on master is green.**

## 4. The release channel (`.github/workflows/promote.yml`) — dispatch-only

Retags an already-built image **by digest** to `canary` or `stable` and
regenerates the channel manifest every instance polls (`docs/SELF-UPDATE.md`).
Inputs: `sha` (the full SHA deploy.yml built), `channel`, `critical`,
`min_compatible`, `dry_run`. It needs two more repository variables than
deploy.yml: `RELEASE_STORAGE_ACCOUNT` and `RELEASE_CONTAINER` (the blob
container that serves `stable.json` / `canary.json`), checked at the start
unless `dry_run`. Rollout discipline is in the file header: promote to canary,
soak on Orange Smiley's own instances 24–48 h, promote the SAME sha to stable.

**The soak is checked, not trusted** (since 2026-09-24): a `stable` promote
first requires every origin in the repository variable `CANARY_URLS`
(space-separated, e.g. `https://ops.orangesmiley.is https://www.orangesmiley.is`)
to answer `/ready` 200 with `X-App-Build` = `sha256(<sha>)[:12]` — a canary that
never pulled the image, or rolled back, blocks the promote. Unset = skipped with
a warning. `promote.yml` (and `deploy.yml`) are PRODUCT-owned (`.engine-paths`):
an engine sync never overwrites a downstream's copy, so a product that wants
this gate copies the step into its own `promote.yml`.

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
| `RESEND_API_KEY` | **required when `APP_ENV=production`** on the default transport — a silent mail transport would no-op verification, resets and receipts while returning 200. With `EMAIL_TRANSPORT=graph` the rule moves to the four Graph settings below instead (`services/mailTransport.js` `missingSettings`) |
| `UPLOAD_ROOT` | required when `NODE_ENV=production` (`server/config/paths.js` throws) — the persistent uploads mount, e.g. `/app/uploads` |

Also set on any real instance:

| Variable | Why |
|---|---|
| `APP_ENV` | `production` / `test` — the environment label (`server/config/appEnv.js`); drives the RESEND rule above, the MCP `[TEST]/[PROD]` tag and the change-request gate |
| `APP_URL` | canonical origin: email links, sitemap, SSR canonical/og/JSON-LD, the canonical-host 301, `{siteHost}` in the email strings. **The code fallback (`https://www.orangesmiley.is` since 2026-09-22; before that the base's hallismiley.is) is the ENGINE's origin, not the instance's** — it is not part of the identity seam, so every downstream sets `APP_URL` on its App Service (or `deploy.yml`); a product that forgets inherits the engine's host in its canonical tags, sitemap and email links, and its canonical-host 301 sends traffic to the engine's site |
| `EMAIL_FROM` | sender address; the display name is `identity.brand.name`. Production = `orangesmiley@mail.orangesmiley.is` (D-015 fleet sending domain, verified in Resend); code default `identity.organization.email` (`info@orangesmiley.is` here) |
| `EMAIL_TRANSPORT` | `resend` (default) or `graph` — the ONE switch for the mail transport (`server/services/mailTransport.js`). The Graph settings alone never switch it; an unknown value counts as "not configured" and every send fails loudly |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER` | only with `EMAIL_TRANSPORT=graph`: send through Microsoft Graph `sendMail` from a Microsoft 365 mailbox in the CUSTOMER's tenant (icelandicstore #173). Needs an **Entra app registration in that tenant** with the application permission `Mail.Send` (admin consent), narrowed to the one mailbox by an Exchange application access policy (`New-ApplicationAccessPolicy -AccessRight RestrictAccess`). `GRAPH_SENDER` is the mailbox (default: the address in `EMAIL_FROM`); the secret is a Key Vault reference and lives at most 24 months — put its expiry on the watch. Messages are not saved to Sent Items; the id a sender returns is the minted `client-request-id`, the value an Exchange message trace finds. `EMAIL_ALLOWLIST` applies exactly as on Resend |
| `EMAIL_REPLY_TO` | where replies go — the sending domain has no inbox. Added to every message that does not set its own (lead notifications reply to the enquirer). Unset = no Reply-To |
| `LEAD_NOTIFY_EMAIL` | inbox for `/hafa-samband` leads (defaults to `EMAIL_FROM`, which on production is not a mailbox — set it) |
| `CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED` | `false` on orangesmiley.is until the release host exists (D-014); `config/client.json` points at a manifest URL nothing serves yet |
| `DB_SSL` | TLS is **on by default in production**; `false` is the documented opt-out for a plain-TCP Postgres (CI only, never Azure) |
| `METRICS_TOKEN` | bearer for `GET /metrics`; blank = localhost only (compared constant-time, `utils/safeEqual.js`) |
| `TOTP_ENC_KEY` | 32-byte key (base64 or hex) that seals admin TOTP secrets at rest (`utils/secretBox.js`, migration 107). A Key Vault reference, **backed up with the other secrets** — losing it means resetting every admin. Malformed → the boot refuses; unset → secrets stay in the plaintext column and production warns at boot. Set it BEFORE the first deploy of 107 (`docs/ADMIN-2FA.md`) |
| `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT` | only to override `security.mfa.enrolment` in `config/client.json`: `optional` (the default since 2026-09-23 — nobody is forced to enrol; an enrolled account is still challenged at every sign-in) or `required` (an unenrolled admin / `accounts` holder has the role / view withheld until it enrols). Published sellers need 2FA for the seller area in both modes (`sellerRoutes.js` rule 4). `docs/ADMIN-2FA.md` |
| `ADMIN_TOTP_EXEMPT` | **never on a deployed stack.** Usernames (or `*`) not forced to enrol two-factor sign-in (meaningful only under `required`) — a Jest/Playwright/dev switch that the server IGNORES under `NODE_ENV=production` (TEST stacks included) and warns about at boot if it finds it |
| `PORT` | App Service sets `8080` for Linux containers; default 3000 |
| `BOOKS_UPLOAD_ROOT` | the books' fylgiskjöl — point OUTSIDE the checkout on a backed-up disk |
| `SELF_UPDATE_TRIGGER_URL` | the platform's deployment webhook; without it an update can be recorded but not applied |
| `MCP_ENABLED` etc. | see `docs/mcp.md` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | turns telemetry ON (dark without it — nothing loads the SDK). The `applicationinsights` SDK (2.9.8, exact pin) is started FIRST in `server.js`: incoming requests, `pg`/`http` dependencies, uncaught exceptions, performance counters; plus pino **warn and above** as `traces` / `exceptions` (`observability/aiLogStream.js`) and every outbound `fetch` — OAuth userinfo, the alert webhook, Anthropic, vedur.is, IndexNow, the release manifest — as a `dependencies` row (`observability/trackedFetch.js`). Copy it from the App Insights resource (orangesmiley.is: `orangesmiley-prod-ai`); **setting it is a deploy-visible change** — the first boot with it set starts sending (since 2026-09-24, icelandicstore #254) |
| `APPLICATIONINSIGHTS_ROLE_NAME` | optional cloud-role name in the Application Map; default the App Service site name (`WEBSITE_SITE_NAME`), else the package name — set it when several instances share one App Insights resource and the site names do not say which is which |

Do **not** set `SMTP_USER` / `SMTP_PASS` / `REQUIRE_EMAIL_VERIFICATION` —
nothing reads them (the mail transport is Resend, or Graph by `EMAIL_TRANSPORT`).

### Anthropic authentication (workload identity, no stored secret)

Every Claude call (today: auto-translate, `TRANSLATE_ENABLED`) authenticates
through `server/services/anthropicAuth.js` (harvested from icelandicstore #326,
2026-09-24). It ships **dark**: with nothing set, Claude features stay off.
When **all** of `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and
`ANTHROPIC_WIF_AUDIENCE` are set, and the container has App Service's
managed-identity endpoint (`IDENTITY_ENDPOINT`/`IDENTITY_HEADER`, injected
automatically once the app has a system-assigned identity), the identity gets an
Entra token for the audience and the Anthropic SDK exchanges it at
`/v1/oauth/token` for a short-lived Anthropic token. No API key is read in that
mode, even if `ANTHROPIC_API_KEY` is still set; otherwise the static key is the
fallback. `ANTHROPIC_SERVICE_ACCOUNT_ID` / `ANTHROPIC_WORKSPACE_ID` are
optional; token fetches are bounded by `ANTHROPIC_AUTH_TIMEOUT_MS` (10 s). At
every boot the log says which mode is live: `[anthropic] workload identity OK`
(or `FAILED` / `settings are incomplete`, at warn) after one cheap authenticated
call, or `authenticating with the static API key`.

- The federation rule matches ONE managed identity, and an identity belongs to
  its slot: on a slotted app `ANTHROPIC_FEDERATION_RULE_ID` is a **sticky**
  (`--slot-settings`) value, one rule per slot; the other settings are the same
  on every slot.
- Two issuer settings in the Anthropic console are load-bearing (ice's
  switch-over, 2026-09-14): **maximum token lifetime 26 h** (App Service
  identity tokens live 24 h with a back-dated `iat`; 24 h fails with
  `jwt_lifetime_too_long`) and **JTI replay protection off** (App Service hands
  out the same cached token for up to 24 h, so every hourly re-exchange would be
  refused as a replay).
- The app only ever logs an opaque 401; the reason is in the console's
  Authentication events tab. The per-tenant ids (issuer, rules, service
  account) are Orange Smiley's own and are set up when Halli turns Claude on for
  an instance.

**Canonical host = `APP_URL`'s host** (since 2026-09-12): in production
`server/app.js` 301-redirects every request whose `Host` differs from the host
part of `APP_URL` (only `/health` and `/ready` are exempt). Until then it was
the literal `www.hallismiley.is` with no override, which would have sent a
first deploy's traffic to the base owner's site. The fallback when `APP_URL`
is unset is `www.orangesmiley.is` since 2026-09-22 — still, set `APP_URL` on
every instance. `public/index.html` is baked with `https://www.orangesmiley.is`;
`ssrMeta.js` swaps that origin for `APP_URL` when it loads the template, so
the static Organization JSON-LD matches the publisher `@id`s on any host.

## 6. Provisioning, when Halli says go

The shape is the base's: Azure App Service (Linux container) pulling from an
Azure Container Registry with its managed identity (`AcrPull`), Azure
Database for PostgreSQL Flexible Server (v16, TLS), an Azure Files share
mounted at `/app/uploads`, OIDC federated credential for the GitHub repo with
subject `repo:orange-smiley/orangesmiley:ref:refs/heads/master`, HTTPS-only,
FTPS disabled. The `azure-ops` skill holds the fleet provisioning pattern;
the step-by-step recipe is LedgerLink's `docs/DEPLOYMENT.md` §0–12 (verified
live 2026-09-07), and the DNS cutover is rekstrarkerfid's
`docs/GO-LIVE-CHECKLIST.md` §5.

### orangesmiley.is production (approved 2026-09-22)

Halli's choices: canonical `www.orangesmiley.is` (the apex 301s to it), small
and production only (own B1 plan + own B1ms Postgres, no TEST stack, ~€35–40
/month; grows to B2 when ops arrives), a **fresh database** from the seeded
built-in content — nothing copied from the local instance, which holds the
books — and Resend on `mail.orangesmiley.is` from day one. Ops stays on the
local instance (D-017); the public site and ops share no database (plan §4).

Platform subscription, `swedencentral` (D-012), fleet names:

| Resource | Name | Notes |
|---|---|---|
| Resource group | `orangesmiley-prod-rg` | tags owner / instance / `role=public` |
| Postgres | `orangesmiley-prod-pg` | B1ms, PG 16, 32 GB, 14-day **geo-redundant** backup (creation-time only), `--public-access Enabled` + one firewall rule per web-app outbound IP, `require_secure_transport=on` |
| Key Vault | `orangesm-prod-kv` | RBAC mode; `database-url`, `csrf-secret`, `metrics-token`, `resend-api-key`, each `--expires` +180 d; app settings reference them unversioned |
| Storage | `orangesmileyprodfiles` | share `uploads` → `/app/uploads` (`UPLOAD_ROOT`); `BOOKS_UPLOAD_ROOT` under it |
| Plan / web app | `orangesmiley-prod-plan` (B1 Linux) / `orangesmiley-prod-web` | system identity, AcrPull on `orangesmileyacr`, KV Secrets User on its own vault, HTTPS-only, FTPS off, TLS 1.2, HTTP/2, always-on, health check `/health` |
| Monitoring | `orangesmiley-prod-ai` | `standard` availability test on `/health` **plus an alert rule on it** |
| Budget | `orangesmiley-prod-monthly` | €45, RG-scoped |
| Deploy identity | `orangesmiley-github-deploy` | AcrPush on the registry, Contributor on the web app only, KV Reader on the vault; federated creds for `ref:refs/heads/master` and `environment:production`, each in plain AND id-bearing subject form |

App settings beyond §5's boot-fatal set: `APP_ENV=production`,
`APP_URL=https://www.orangesmiley.is`, `ALLOWED_ORIGINS` = both hostnames'
https origins + the `azurewebsites.net` one, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
`LEAD_NOTIFY_EMAIL`, `PORT=8080`, `CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED=false`.

The steps that are **Halli's hand**: the go on spend before the first `az …
create`; the Resend domain + DPA + DKIM/SPF/DMARC records and the API key
(into the vault, never into chat); the ISNIC records (`A @` + `TXT asuid`,
`CNAME www` + `TXT asuid.www` — values supplied at that step); production
app-setting writes if the agent side is blocked.

#### Provisioned 2026-09-22 (Halli's go) — the ids the next session needs

- **Live:** `https://www.orangesmiley.is` (canonical); the apex, `http://` and
  the azurewebsites host 301 there. Inbound IP `51.12.31.17`; custom-domain
  verification id `6E830E09…0DFB6042` (the `asuid` TXT records). Managed
  certificates for both names, SNI, valid to 2027-03-22, auto-renewed.
- **Web app** identity principalId `e3adf637-ad75-4bdd-81c6-d74227ccc2c2` —
  AcrPull on `orangesmileyacr`, Key Vault Secrets User on `orangesm-prod-kv`.
  Container logging to filesystem is ON (that is how the `ip:port` limiter bug
  was found on day one — HISTORY `#go-live`).
- **Deploy identity** `orangesmiley-github-deploy`: appId
  `0d3d70c3-5144-4897-9d34-df6940e8ff68`, app objectId
  `707a9647-139b-4c5b-bab3-f09036a52cf2`, SP objectId
  `3c6b36fc-fcf0-43f0-a712-ed1b506cf28a` — AcrPush (registry) · Contributor (web
  app only) · Key Vault Reader (vault). Four federated subjects (master +
  `environment:production`, plain and id-bearing; repo id `1349405381`, org id
  `316194275`).
- **Vault** secrets `database-url` · `csrf-secret` · `metrics-token` ·
  `resend-api-key` (real key since 2026-09-22), all expiring 2027-03-21;
  `admin-bootstrap-password` (30 d) for the first admin `halli`. Purge
  protection on.
- **Postgres** B1ms, PG 16, 32 GB, 14-day geo-redundant backup; the app's 32
  outbound IPs as rules `app-1..32`. Scaling the plan rotates them — re-run the
  loop.
- **Monitoring:** App Insights `orangesmiley-prod-ai`; availability test
  `PROD-ready` (standard, 300 s, Amsterdam) on `https://www.orangesmiley.is/ready`;
  alerts `PROD-ready-down` and `PROD - HTTP 5xx spike` → action group
  `os-oncall-prod` (halli@orangesmiley.is).
- **Budgets:** `orangesmiley-prod-monthly` €45 (RG); `orange-smiley-platform-monthly`
  raised 140 → 175.
- **Mail:** Resend domain `mail.orangesmiley.is`, EU (eu-west-1), verified, no
  tracking subdomain; DNS at ISNIC = `resend._domainkey.mail` TXT, `rsend.mail`
  and `send.mail` CNAMEs. The Resend team is still named "hallismiley" — move it
  to the company with the subscriptions.
- **Rotating a Key Vault secret:** a plain restart can keep serving the cached
  value. Re-set the app setting (same reference) to force a re-fetch, then check
  `/ready` uptime is younger than the change.
- ISNIC DNS is edited as **BSE255-IS** (registrant/tech contact); HV712-IS is
  only the payer and cannot edit records.

Three recipes from the base's guide that are still correct and worth keeping
(placeholders as in `RUNBOOK.md`):

- **Reaching the managed Postgres from a laptop** (needed by the prod shop
  seed, the first-admin bootstrap and any `psql`): add your IP to the server
  firewall first, and URL-encode the password in `DATABASE_URL` —
  `node -e "console.log(encodeURIComponent(process.argv[1]))" '<password>'`.

  ```bash
  MY_IP=$(curl -s ifconfig.me)
  az postgres flexible-server firewall-rule create \
    --resource-group <RESOURCE_GROUP> --name <DB_SERVER> \
    --rule-name dev-laptop --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
  ```

- **Mounting the uploads share from Git Bash on Windows.** If
  `az webapp config storage-account add … --mount-path /app/uploads` fails
  with "contains invalid characters", prefix the command with
  `MSYS_NO_PATHCONV=1` — MSYS rewrites the Linux path otherwise.

- **Custom domain + free managed certificates** (for the day
  `orangesmiley.is` points here; see the cutover checklist at the end of
  `ENHANCEMENTS.md`): DNS = `A` record for the apex to the App Service IP and
  `CNAME www → <WEBAPP_NAME>.azurewebsites.net`, then

  ```bash
  for HOST in www.<host> <host>; do
    az webapp config hostname add --resource-group <RESOURCE_GROUP> --webapp-name <WEBAPP_NAME> --hostname "$HOST"
    az webapp config ssl create      --resource-group <RESOURCE_GROUP> --name <WEBAPP_NAME> --hostname "$HOST"
    THUMB=$(az webapp config ssl list --resource-group <RESOURCE_GROUP> \
              --query "[?subjectName=='$HOST'].thumbprint | [0]" -o tsv)
    az webapp config ssl bind --resource-group <RESOURCE_GROUP> --name <WEBAPP_NAME> \
      --certificate-thumbprint "$THUMB" --ssl-type SNI
  done
  ```

  **Then add the new HTTPS origins to `ALLOWED_ORIGINS`** (a boot-fatal
  variable) or CORS rejects every browser request twenty minutes after the
  domain goes live.

Bookkeeping note (RUNBOOK → Bókhald): Azure has no Iceland region, so the
yearly books archive to media in Iceland is the compliance step, not a nicety.

## 7. Verifying a deployment

| Check | URL | Expected |
|---|---|---|
| Liveness | `GET /health` | `200 {"status":"ok","uptime":…,"timestamp":…}` — **no DB check** |
| Readiness (DB + breaker + memory) | `GET /ready` | `200 {"status":"ok", "checks": {…}}`; `503` while not ready |
| Prometheus metrics | `GET /metrics` | `200 text/plain` with `Authorization: Bearer <METRICS_TOKEN>` |
| Build identity | `GET /api/v1/system/version` (session with the `updates` view; answers 404 when `modules.selfUpdate.enabled` is off — which it is on orangesmiley.is until the release host exists; read the `gitSha` from `/ready` logs or the deploy run summary instead) | `gitSha` = the dispatched SHA |
| Latest changes | Admin → Monitoring | the commits `generate-changes.js` stamped |
| Release on the wire | any response header; view-source of a page | `X-App-Build` = `sha256(<sha>)[:12]`; the shell's `<meta name="app-build">` says the same and its scripts/stylesheets load from `/js/_<that tag>/…` and `/css/_<that tag>/…` (cached a year; any other tag 404s). A build without `GIT_SHA` reports `unknown` and is served unstamped — fix the build-args, the site still works (since 2026-09-24, [harvest-ice-e](HISTORY.md#harvest-ice-e-2026-09-24)) |

## 8. Rollback

Image-pin: point the App Service back at the previous **digest** — every
deploy run's summary prints the image it replaced — and restart
(`az webapp config container set … --container-image-name
orangesmileyacr.azurecr.io/orangesmiley@sha256:…`; RUNBOOK → Rollback). Or
dispatch deploy.yml with the old commit's `sha`: its image is still in the
registry, so nothing is rebuilt. Git revert + merge only runs CI; a deploy is
still a dispatch. Migrations are forward-only and must be expand/contract (stack
invariant 14), so an image rollback never needs a schema rollback within one
release.

## 9. First admin

No public sign-up for admins. Run the bootstrap against the target database
with **all three** of `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` set —
`server/scripts/bootstrap.js` creates no admin and exits 0 if any is missing —
or `node server/scripts/setup-admin.js <username> <email> <password>`, which
writes the user row directly (scrypt hash). Admin accounts must then enrol in
TOTP from the profile (2FA is enforced for admins and `accounts` holders).
