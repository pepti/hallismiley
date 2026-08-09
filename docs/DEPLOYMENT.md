# Deployment Guide — Halli Smiley

This guide covers deploying the app to **Azure App Service** (Linux container)
with **Azure Container Registry** and **Azure Database for PostgreSQL Flexible
Server**. Deploys are triggered from GitHub Actions using OIDC federated
credentials — no long-lived Azure secrets in the repo.

For routine operational tasks (rollbacks, log access, common incidents),
see [`RUNBOOK.md`](../RUNBOOK.md). For environment variable reference, see
[`.env.example`](../.env.example).

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
| App Service plan | `hallismiley-plan` (B1 Linux) | West Europe |
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
to connect via `psql` from your laptop:

```bash
MY_IP=$(curl -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group hallismiley-rg --name hallismiley-db \
  --rule-name dev-laptop --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
```

---

## 3. Persistent uploads — Azure Files

The container is read-only by default; uploaded media must live on a mounted
volume that survives container restarts and image swaps.

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

---

## 5. App Settings (environment variables)

Set everything via `az webapp config appsettings set` so the values survive
container restarts and are visible in the portal. See `.env.example` for the
authoritative list and descriptions.

```bash
# Required
az webapp config appsettings set --resource-group hallismiley-rg --name hallismiley-app \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    DB_SSL=true \
    DATABASE_URL="postgresql://halliadmin:$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' '<password>')@hallismiley-db.postgres.database.azure.com:5432/hallismiley?sslmode=require" \
    ALLOWED_ORIGINS="https://hallismiley.is,https://www.hallismiley.is,https://hallismiley-app.azurewebsites.net" \
    CSRF_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
    APP_URL="https://www.hallismiley.is" \
    UPLOAD_ROOT="/app/uploads" \
    REQUIRE_EMAIL_VERIFICATION=true \
    METRICS_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"

# Email (SMTP password must be set out-of-band — never commit)
az webapp config appsettings set --resource-group hallismiley-rg --name hallismiley-app \
  --settings SMTP_USER=halli@hallismiley.is
# Then manually via portal: SMTP_PASS=<google-app-password>

# OAuth (Google sign-in)
az webapp config appsettings set --resource-group hallismiley-rg --name hallismiley-app \
  --settings \
    GOOGLE_CLIENT_ID=<from-google-console> \
    GOOGLE_CLIENT_SECRET=<from-google-console> \
    GOOGLE_REDIRECT_URI=https://www.hallismiley.is/auth/google/callback
```

Enable HTTPS-only and turn off the legacy FTPS endpoint:

```bash
az webapp update --resource-group hallismiley-rg --name hallismiley-app --https-only true
az webapp config set --resource-group hallismiley-rg --name hallismiley-app --ftps-state Disabled
```

---

## 6. First deploy + DB migration

The CI workflow (`.github/workflows/ci.yml`) runs on every push and pull
request to `main`. The Deploy workflow (`.github/workflows/deploy.yml`) is
gated on CI: it runs only after CI completes successfully on `main`.

```bash
# Push to main (or merge a PR)
git push origin main
```

The CI workflow runs lint + `npm audit` + integration tests + E2E + Docker
build. On success, Deploy auto-triggers via `workflow_run`, builds the image,
pushes to ACR, points the App Service at it, and force-restarts. Migrations
run automatically at container startup via `server/scripts/migrate.js` — no
manual step.

To trigger Deploy without waiting for a CI run (emergency override):

```bash
gh workflow run "Deploy to Azure" --ref main
```

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
reject browser requests.

---

## 8. Verifying the deployment

| Check | URL | Expected |
| --- | --- | --- |
| Liveness | `GET /health` | `200 {"status":"ok", ...}` |
| Readiness (DB + system) | `GET /ready` | `200 {"status":"ok", ...}` |
| Prometheus metrics | `GET /metrics` | `200 text/plain` (requires `Authorization: Bearer <METRICS_TOKEN>` if set) |

A healthy deploy returns `200` on `/ready` once the container has finished
booting and connected to Postgres. If `/ready` returns `503` after a deploy,
tail the container logs via `az webapp log tail` (see RUNBOOK).

---

## 9. Rollback

See [`RUNBOOK.md` → Rollback Procedures](../RUNBOOK.md#rollback-procedures)
for the canonical procedure. Summary: point the App Service at a previous
image tag from ACR and force-restart — no CI rerun, no rebuild, ~1 minute end
to end.

---

## Initial admin user

There is no public sign-up for admin accounts. To create the first admin run
the bootstrap script with `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the
environment — locally against the prod DB:

```bash
DATABASE_URL='postgresql://halliadmin:<pw>@hallismiley-db.postgres.database.azure.com:5432/hallismiley?sslmode=require' \
DB_SSL=true \
ADMIN_USERNAME=halli ADMIN_PASSWORD='<strong-password>' \
node server/scripts/bootstrap.js
```

Keep the credentials in a password manager — there is no recovery flow
without database access.
