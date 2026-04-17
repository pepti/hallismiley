# Deployment Guide — HalliProjects

Production runs on **Azure Web App for Containers**. Images are built and pushed by GitHub Actions using OIDC (federated credentials — no long-lived secrets stored in the repo). The authoritative workflow is `.github/workflows/deploy.yml`; it triggers only after the `CI` workflow has succeeded on `main`.

---

## Prerequisites (one-time setup)

1. **Azure resources**
   - Azure Container Registry — this guide assumes the name `hallismileyacr`.
   - Azure Web App for Containers — this guide assumes the name `hallismiley-app`.
   - Azure Database for PostgreSQL — Flexible Server (with firewall rules allowing the Web App outbound address).
   - Azure Files share mounted on the Web App for persistent uploads (mount path becomes `UPLOAD_ROOT`).
2. **Azure AD app registration with federated credentials**
   - Create an App Registration in Azure AD.
   - Add a **federated credential** trusting this GitHub repo, branch `main`.
   - Grant the app `AcrPush` on the registry and `Contributor` on the Web App's resource group.
3. **Repo secrets** (GitHub → Settings → Secrets → Actions)
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
4. **App Service configuration** (App Service → Configuration → Application settings) — at minimum:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | your Azure PG connection string |
   | `ALLOWED_ORIGINS` | `https://hallismiley.is,https://www.hallismiley.is` |
   | `NODE_ENV` | `production` |
   | `CSRF_SECRET` | 32+ char random, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
   | `DB_SSL` | `true` |
   | `UPLOAD_ROOT` | mount path of the Azure Files share (e.g. `/mnt/uploads`) |
   | `APP_URL` | `https://www.hallismiley.is` |
   | `RESEND_API_KEY` | from Resend dashboard |
   | `EMAIL_FROM` | a verified Resend sender |

   Optional: `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `METRICS_TOKEN`, `ALERT_WEBHOOK_URL`, `GOOGLE_*`, `FACEBOOK_*`, `ADMIN_*`.

5. **Path mapping** (App Service → Configuration → Path mappings)
   - Mount the Azure Files share at the same path you set for `UPLOAD_ROOT`.

---

## Standard Deployment Flow

1. Merge to `main`.
2. `CI` workflow runs: npm audit (moderate), ESLint, Jest with coverage, Playwright E2E, Docker build.
3. On CI success, `Deploy to Azure` triggers automatically:
   - Azure login via OIDC.
   - `az acr login --name hallismileyacr`.
   - Build and push image tags `:latest` and `:<commit-sha>` to `hallismileyacr.azurecr.io/hallismiley`.
   - Deploy the `:<sha>` tag to `hallismiley-app`.
4. The server runs pending migrations on startup (`server/scripts/migrate.js`) before accepting traffic.

---

## Manual deploy / redeploy a specific SHA

Use **Actions → Deploy to Azure → Run workflow** from the GitHub UI and pick the ref to deploy. Or from Azure CLI:

```bash
az webapp config container set \
  --name hallismiley-app \
  --resource-group <your-rg> \
  --docker-custom-image-name hallismileyacr.azurecr.io/hallismiley:<sha>
```

---

## Initial Admin Setup

First boot will bootstrap an admin if `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` are set in App Service configuration and no admin exists yet. **Remove the password from the environment after the account is created.**

If you need to reset or create an admin on an existing deployment:

```bash
az webapp ssh --name hallismiley-app --resource-group <your-rg>
# inside the container:
node server/scripts/setup-admin.js
```

---

## Verifying a Deployment

| Check | URL | Expected response |
|---|---|---|
| Liveness | `GET /health` | `200 {"status":"ok"}` |
| Readiness (DB + system) | `GET /ready` | `200 {"status":"ok", ...}` |
| Prometheus metrics | `GET /metrics` | `200` text/plain (requires `Authorization: Bearer <METRICS_TOKEN>` if token is set) |

Azure Web App's built-in health check should be pointed at `/ready`.

---

## SSL / Custom Domain

1. In the Azure portal: Web App → **Custom domains** → **Add custom domain**.
2. Follow Azure's DNS validation prompts (TXT + CNAME records).
3. Once validated, **Add binding** and choose **App Service Managed Certificate** (free).
4. Ensure `ALLOWED_ORIGINS` includes the `https://` URL of every public hostname, or CORS requests will be blocked.

---

## Rollback Procedure

See `RUNBOOK.md` — Rollback Procedures. Two supported paths:
1. Redeploy a prior image tag via `az webapp config container set`.
2. Slot swap (if a staging slot is provisioned).

---

## Database

- Automated backups are managed by Azure Database for PostgreSQL Flexible Server — configure retention in the portal under **Backup and restore**.
- **Point-in-time restore** is the preferred recovery path; it restores to a new server, which you can then swap in by updating `DATABASE_URL`.
- Manual backup on-demand:
  ```bash
  pg_dump "$DATABASE_URL" --no-acl --no-owner -F c -f backup_$(date +%Y%m%d).dump
  ```
- Always capture a manual backup before deploying a schema-changing migration.
