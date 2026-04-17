# Pre-Launch Audit Report — HalliSmiley

> **⚠ ARCHIVED — 2026-04-16.** This document captures the state of the project
> on 2026-03-30, immediately before its public launch. It is preserved for
> historical reference only. The three CRITICAL issues (RSA keys committed,
> keys baked into Docker image, `keys/` not gitignored) have since been
> resolved, and the stack has evolved substantially (Lucia + Arctic OAuth has
> replaced RS256 JWTs, Resend has replaced SMTP, deployment has moved from
> Railway to Azure). For the current audit, see
> `C:\Users\Notandi\.claude\plans\crystalline-zooming-cake.md`.

**Date:** 2026-03-30
**Stack:** Node.js 20 · Express 4.18 · PostgreSQL · Vanilla JS SPA
**Auditor:** Manual review of all 65+ source files

---

## Executive Summary

This is a well-built, security-conscious codebase with strong fundamentals: RS256 JWT authentication, parameterized SQL throughout, layered input validation, multi-tier rate limiting, and 200+ integration tests. The architecture is clean and the security intentions are clear throughout.

However there are **3 CRITICAL issues** that must be resolved before any public launch or git push — all related to secrets management. There are also 29 IMPORTANT issues and 22 NICE-TO-HAVE improvements documented below.

**Severity key:**
- 🔴 **CRITICAL** — Must fix before any git push or public launch. Active security risk.
- 🟠 **IMPORTANT** — Should fix before launch. Functional bugs, compliance issues, or significant gaps.
- 🟡 **NICE-TO-HAVE** — Can address post-launch. Quality, polish, and scalability improvements.

---

## Table of Contents

1. [Security Hardening](#1-security-hardening)
2. [Code Quality & Best Practices](#2-code-quality--best-practices)
3. [Database](#3-database)
4. [Performance & Scaling](#4-performance--scaling)
5. [Reliability & Observability](#5-reliability--observability)
6. [Configuration & Environment Management](#6-configuration--environment-management)
7. [DevOps & Deployment](#7-devops--deployment)
8. [Frontend](#8-frontend)
9. [Documentation](#9-documentation)
10. [Legal / Compliance](#10-legal--compliance)
11. [Summary Matrix](#summary-matrix)
12. [Recommended Launch Sequence](#recommended-launch-sequence)

---

## 1. Security Hardening

---

### 🔴 CRITICAL-1 — RSA Private Key Not Gitignored

**File:** `.gitignore` (entire contents):
```
node_modules/
data/portfolio.db
.env
```

The `keys/` directory is **not excluded from git**. If this repository is ever pushed to GitHub (public or private breach), the RS256 signing private key is exposed. Anyone with the private key can forge admin JWTs that the server will accept indefinitely.

Two additional key files also exist at the project root with no gitignore coverage:
```
ClaudeHalliProjectskeysprivate.pem   ← stray root-level copy
ClaudeHalliProjectskeyspublic.pem    ← stray root-level copy
```

**Fix:**

Add to `.gitignore`:
```
keys/
*.pem
```

Delete the two stray `.pem` files from the project root. Then rotate the RSA keypair immediately — treat the current key as compromised if it was ever in a commit:
```bash
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

Long-term: switch to env-var-based key loading (see CRITICAL-2).

---

### 🔴 CRITICAL-2 — RSA Private Key Baked Into Docker Image

**File:** `Dockerfile`, line 29:
```dockerfile
# Copy RSA key pair used for RS256 JWT signing.
# For production, prefer mounting these as a secret or writing them from env vars
# (e.g. via a Railway secret or a startup entrypoint) rather than baking them in.
COPY keys/ ./keys/
```

Every `docker build` embeds the private key into an image layer. If the image is pushed to Docker Hub, GitHub Container Registry, Railway's internal registry, or any other registry — the key is exposed to anyone with read access to the image.

**Fix — step 1:** Update `server/config/keys.js` to load from env vars with a file fallback:
```js
const privateKey = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n')
  : fs.readFileSync(path.join(KEYS_DIR, 'private.pem'), 'utf8');

const publicKey = process.env.PUBLIC_KEY
  ? process.env.PUBLIC_KEY.replace(/\\n/g, '\n')
  : fs.readFileSync(path.join(KEYS_DIR, 'public.pem'), 'utf8');
```

**Fix — step 2:** Remove line 29 from the Dockerfile:
```dockerfile
# REMOVE THIS LINE:
COPY keys/ ./keys/
```

**Fix — step 3:** Set `PRIVATE_KEY` and `PUBLIC_KEY` as multi-line secrets in Railway's environment variable panel. To encode a PEM for an env var:
```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' keys/private.pem
```
Paste the single-line output as the `PRIVATE_KEY` value in Railway.

---

### 🔴 CRITICAL-3 — `.env` Contains Real Credentials With Weak Defaults

**File:** `.env`, lines 6, 12–13:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/halliprojects
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2b$12$qLKtT9MCcy2ncESdmQsqEO.ocDRYYD0zpyy6tQWHCBNUkzm6/Hgii
```

Three problems:
1. `ADMIN_USERNAME=admin` is the most commonly tried username in credential-stuffing attacks.
2. The bcrypt hash in the file is a real hash for a development password. If it was weak or reused, offline brute-force is feasible even against bcrypt-12.
3. There is no `.env.example` — contributors have no documented list of required variables, so someone might copy this real `.env` as a template.

**Fix:**
- Change `ADMIN_USERNAME` to something non-obvious before production.
- Generate a fresh strong password and new hash: `node server/scripts/setup-admin.js <new-password>`
- Create `.env.example` with empty/placeholder values:
```bash
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/dbname
DB_SSL=true
ADMIN_USERNAME=
ADMIN_PASSWORD_HASH=
ALLOWED_ORIGINS=https://yourdomain.com
PRIVATE_KEY=
PUBLIC_KEY=
```
- Extend the `.gitignore` to cover all `.env` variants: `.env.*`

---

### 🟠 IMPORTANT-S1 — `rejectUnauthorized: false` Disables DB TLS Certificate Verification

**File:** `server/config/database.js`, line 8:
```js
ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
```

With `DB_SSL=true` in production, the TLS connection is established but the server certificate is **not verified**. A man-in-the-middle between the app and the database could intercept all queries and responses — including password hashes stored in the DB.

Railway, Supabase, and Render all provide valid, publicly-trusted certificates.

**Fix:**
```js
ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
```
If your provider uses a self-signed cert, set `ca: process.env.DB_SSL_CA` rather than disabling verification entirely.

---

### 🟠 IMPORTANT-S2 — Known Vulnerability: `path-to-regexp` ReDoS (CVSS 7.5 High)

**Source:** `npm audit` output

```
path-to-regexp < 0.1.13
Severity: high (CVSS 7.5)
CWE-1333: Inefficient Regular Expression Complexity (ReDoS)
Transitive dependency via: express > path-to-regexp
Fix available: npm audit fix
```

A maliciously crafted URL with specific patterns in route parameters can trigger catastrophic regex backtracking and spike the Node.js event loop to 100% CPU — effectively a single-request denial of service.

**Fix:**
```bash
npm audit fix
npm test  # verify nothing breaks
```

---

### 🟠 IMPORTANT-S3 — CSP Allows `'unsafe-inline'` on Scripts

**File:** `server/app.js`, line 21:
```js
scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com'],
```

`'unsafe-inline'` significantly weakens the script CSP directive. Any injected inline `<script>` (via XSS, a compromised dependency, or a rogue CDN) would execute. This is currently required because `public/index.html` contains two inline `<script>` blocks for the GA4 snippet (lines 73–78).

**Fix:** Move the GA4 initialisation to a static file `/public/js/analytics.js` and load it with `<script src="/js/analytics.js">`. Then remove `'unsafe-inline'` from `scriptSrc`. The external GTM loader URL stays, so `googletagmanager.com` remains in the allowlist.

---

### 🟠 IMPORTANT-S4 — No `Permissions-Policy` Header

**File:** `server/app.js` — not set anywhere

Helmet 8.x does not emit a `Permissions-Policy` header by default. Without it, the page can request camera, microphone, geolocation, and payment APIs. Not a direct risk for a portfolio, but required in many compliance contexts and a common pentest finding.

**Fix:** Add after the Helmet block in `server/app.js`:
```js
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});
```

---

### 🟡 NICE-TO-HAVE-S1 — No Subresource Integrity on Google Fonts

**File:** `public/index.html`, lines 39–41

The Google Fonts `<link>` tags have no `integrity` attribute. If Google's CDN were compromised, a malicious stylesheet could be served.

**Fix:** Generate SRI hashes for the font stylesheet and add `integrity` + `crossorigin` attributes:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?..."
      crossorigin="anonymous" integrity="sha384-HASH_HERE">
```

---

### 🟡 NICE-TO-HAVE-S2 — No Rate Limiting on `/auth/refresh`

**File:** `server/routes/authRoutes.js`, line 12:
```js
router.post('/refresh', authController.refresh);   // no limiter
```

The global limiter (200 req/15 min) applies, but that is very permissive for an auth endpoint. While a valid hashed token is required, this endpoint is worth protecting more tightly.

**Fix:** Apply the same `authLimiter` (max 10/15 min) to the refresh route, or create a dedicated `refreshLimiter` with a slightly higher threshold (e.g., 20/15 min).

---

## 2. Code Quality & Best Practices

---

### 🟠 IMPORTANT-Q1 — `require()` Called Inside Per-Request Middleware

**File:** `server/app.js`, line 86:
```js
app.use((req, res, next) => {
  const id = require('crypto').randomBytes(8).toString('hex');
  // ...
});
```

`require()` is invoked on every HTTP request. Node.js caches modules so this is not catastrophic, but it is an unnecessary hash-table lookup on every request and a code anti-pattern that confuses readers.

**Fix:** Move `const crypto = require('crypto');` to the top of `app.js` with the other imports.

---

### 🟠 IMPORTANT-Q2 — Bug: Form Values Are Double-Escaped in Edit Mode

**File:** `public/js/components/ProjectForm.js`, lines 99–101:
```js
form.title.value       = escHtml(project.title);
form.description.value = escHtml(project.description);
```

`escHtml()` converts `<`, `>`, `&`, `"` into HTML entities. When assigned to a DOM input's `.value` property, the browser stores the literal entity text — not the decoded character. A project titled `O'Brien & Sons` would appear as `O&#x27;Brien &amp; Sons` in the edit form, and that corrupted string would be sent to the API on save.

**Fix:** Form input `.value` does not render HTML, so no escaping is needed here:
```js
form.title.value       = project.title;
form.description.value = project.description;
```

---

### 🟠 IMPORTANT-Q3 — Graceful Shutdown Does Not Close the Database Pool

**File:** `server/server.js`, lines 16–27:
```js
function shutdown(signal) {
  server.close(() => {
    clearInterval(cleanupTimer);
    console.log('[server] HTTP server closed');
    process.exit(0);    // ← pool never closed
  });
  // ...
}
```

When Railway sends `SIGTERM` during a deploy or restart, the database pool is abandoned with potentially in-flight queries. PostgreSQL will hold those connections open until its `tcp_keepalives_idle` timeout (typically 2 hours). On a resource-constrained database plan, this can exhaust the connection limit.

**Fix:**
```js
const { pool } = require('./config/database');

server.close(async () => {
  clearInterval(cleanupTimer);
  await pool.end();
  console.log('[server] HTTP server closed');
  process.exit(0);
});
```

---

### 🟠 IMPORTANT-Q4 — `jest.config.js` Comment Contradicts Its Own Setting

**File:** `jest.config.js`, lines 9–10:
```js
// Run test files serially — avoids DB race conditions between suites
runInBand: false,
```

The comment says "serially" but `runInBand: false` runs suites in parallel workers. The `maxWorkers: 2` limits parallelism but does not eliminate the DB race condition the comment warns about. Multiple test suites each call `db.pool.end()` in `afterAll`, which causes "Cannot use a pool after calling end on the pool" errors under parallel execution.

**Fix:** Set `runInBand: true` to match the comment's intent, or remove the per-suite `db.pool.end()` calls and centralise teardown in `tests/globalTeardown.js` (which is currently an empty no-op).

---

### 🟡 NICE-TO-HAVE-Q1 — `escHtml` Duplicated Across Five Files

**Files:** `AdminView.js:6`, `ProjectDetailView.js:140`, `ProjectCard.js:52`, `ProjectForm.js:4`, `ProjectModal.js:62`

All five files define an identical `escHtml` function. If a vulnerability were found (e.g., missing `'` escape for single quotes in attribute contexts), it would need patching in five separate places.

**Fix:** Extract to `public/js/utils/escHtml.js` and import it:
```js
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');  // cover single quotes too
}
```

---

### 🟡 NICE-TO-HAVE-Q2 — No Structured Logging

All logging uses unstructured `console.log` / `console.error` calls. In production on Railway, these land in stdout with no request context, no severity levels, and no machine-parseable format, making it hard to search or alert on errors.

**Fix:** Add `pino` (zero-overhead structured logging for Node):
```bash
npm install pino pino-http
```
Replace `console.error('[Contact]...', data)` patterns with `logger.info({ name, email }, 'contact form submission')`. This enables log aggregation and filtering in Railway's log viewer or any SIEM.

---

### 🟡 NICE-TO-HAVE-Q3 — No Global Unhandled Rejection / Exception Handler

**File:** `server/server.js` — absent

If any async code outside the Express middleware chain throws an unhandled promise rejection, the process may log a warning but continue in an undefined state (or exit silently on older Node versions).

**Fix:** Add before `app.listen`:
```js
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});
```

---

## 3. Database

---

### 🟠 IMPORTANT-D1 — No Migration Versioning System

**File:** `server/scripts/migrate.js`

The migration script is a single idempotent `CREATE TABLE IF NOT EXISTS` block. It correctly sets up the initial schema, but has **no mechanism for incremental schema changes**. If a new column needs to be added to `projects` in production (e.g., `slug`, `sort_order`), the `IF NOT EXISTS` guard means re-running `migrate.js` does nothing to an existing table. The developer would need to write and run an ad-hoc `ALTER TABLE` statement manually.

**Fix:** Adopt versioned migrations. Minimal approach — a numbered convention:
```
server/migrations/
  001_initial_schema.sql
  002_add_projects_slug.sql
```
Track applied migrations in a `schema_migrations` table. Tools that handle this automatically: `db-migrate`, `graphile-migrate`, or `node-pg-migrate`.

---

### 🟠 IMPORTANT-D2 — Schema DDL Duplicated Between Production and Tests

**Files:** `server/scripts/migrate.js:9–62` and `tests/globalSetup.js:13–62`

The entire table DDL, trigger, and index definitions are copy-pasted between the production migration script and the test setup. If a column is added to `projects` in `migrate.js` and `globalSetup.js` is not updated, tests will pass against a schema that differs from production — exactly the scenario that causes post-deploy failures.

**Fix:** Extract schema creation into a shared module:
```js
// server/config/schema.js
async function applySchema(client) { /* all CREATE TABLE / TRIGGER / INDEX */ }
module.exports = { applySchema };
```
Then import it in both `migrate.js` and `tests/globalSetup.js`.

---

### 🟡 NICE-TO-HAVE-D1 — No Database Backup Strategy Documented

There is no documentation or script for database backups. Railway includes automatic daily backups on paid plans, but this needs to be explicitly verified and a restore procedure tested before launch. Data loss from an accidental `DELETE` with no backups is unrecoverable.

**Action:** Verify Railway backup is enabled in the project dashboard. Test a point-in-time restore before going live. Document the restore procedure.

---

### 🟡 NICE-TO-HAVE-D2 — `SELECT *` in All Queries

**File:** `server/models/Project.js`, lines 26, 34, 74

All queries use `SELECT *`. This fetches `created_at`, `updated_at`, and any future columns added to the table, including columns that should not be exposed to the API. It also prevents PostgreSQL from using index-only scans.

---

### 🟡 NICE-TO-HAVE-D3 — Refresh Token Rotation Not Wrapped in a Transaction

**File:** `server/controllers/authController.js`, lines 88–90:
```js
await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [stored.id]);
const newRefresh = crypto.randomBytes(64).toString('hex');
await storeRefreshToken(newRefresh);   // ← if this fails, old token is revoked with no replacement
```

If the process crashes or the DB throws between the revoke and the insert, the user's session is permanently invalidated and they must log in again. Low probability but trivially fixed.

**Fix:** Wrap both statements in a transaction using `pool.connect()` + `BEGIN`/`COMMIT`.

---

## 4. Performance & Scaling

---

### 🟠 IMPORTANT-P1 — No HTTP Compression

**File:** `server/app.js` — `compression` middleware absent

All API responses and static files are served uncompressed. A JSON array of 20 projects is roughly 6–10 KB uncompressed and ~1.5 KB gzipped. The hero video and CSS are served without `Content-Encoding` headers.

**Fix:**
```bash
npm install compression
```
```js
// server/app.js — add near the top, before static files
const compression = require('compression');
app.use(compression());
```

---

### 🟠 IMPORTANT-P2 — No Cache-Control Headers on Static Assets

**File:** `server/app.js`, line 123:
```js
app.use(express.static(path.join(__dirname, '../public')));
```

`express.static` with no options sends no `Cache-Control` header. Browsers will revalidate every CSS, JS, and image file on every navigation. On a cold mobile connection this adds hundreds of milliseconds to every page load after the first.

**Fix:**
```js
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1h',      // safe without content-hash filenames
  etag: true,
  lastModified: true,
}));
```
For the SPA HTML file specifically, prevent caching so new deployments propagate:
```js
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
```

---

### 🟠 IMPORTANT-P3 — Video File Served by Node.js Process

**File:** `public/assets/videos/waterfall.mp4`

Large binary files served through Node.js tie up the event loop and consume memory. The hero background video is requested on every home page load and is likely 10–50 MB. Node.js is not designed to serve large static binaries efficiently.

**Fix:** Upload the video to Cloudflare R2, AWS S3, or Bunny.net. Update the source in `HomeView.js:106`:
```js
<source src="https://cdn.yourdomain.com/waterfall.mp4" type="video/mp4">
```

---

### 🟡 NICE-TO-HAVE-P1 — No Pagination on Projects Endpoint

**File:** `server/models/Project.js`, `findAll()` — returns all rows unconditionally

`GET /api/v1/projects` has no `limit` / `offset` / `cursor` parameters. Acceptable with 10 seeded projects, but if the project count grows to hundreds, every page load fetches the full table. Add pagination before the dataset grows.

---

### 🟡 NICE-TO-HAVE-P2 — Google Fonts Loaded Twice

**Files:** `public/index.html:39–41` (non-blocking `<link>`) AND `public/css/main.css:1` (`@import url(...)`)

The CSS `@import` at the top of `main.css` is render-blocking: the browser must download `main.css`, parse it, then issue a second HTTP request for the fonts before any text can render. The `<link>` in `index.html` with `display=swap` is non-blocking and correct.

**Fix:** Remove line 1 from `public/css/main.css`:
```css
/* DELETE THIS LINE: */
@import url('https://fonts.googleapis.com/css2?...');
```
The `<link>` tags in `index.html` are sufficient.

---

### 🟡 NICE-TO-HAVE-P3 — No API Response Caching

`GET /api/v1/projects/featured` is read-heavy and changes only when the admin makes an edit. Without any caching, every page load that shows featured projects hits the database.

**Fix (simple):** Add a `Cache-Control` header on the featured endpoint:
```js
res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
res.json(await Project.findFeatured());
```

---

## 5. Reliability & Observability

---

### 🟠 IMPORTANT-R1 — Health Check Does Not Verify RSA Key Loading

**File:** `server/app.js`, lines 103–120

The `/health` endpoint verifies database connectivity, which is good. However it does not verify that the RSA key pair loaded successfully. A misconfigured key path or missing env var would leave `privateKey = undefined` in `server/config/keys.js`. The server would start, pass the health check, and then throw a cryptic `secretOrPrivateKey must have a value` error on the first login attempt.

**Fix:** Add a startup assertion in `server/server.js` before `app.listen`:
```js
const { privateKey, publicKey } = require('./config/keys');
if (!privateKey || !publicKey) {
  console.error('[startup] RSA keys failed to load — aborting');
  process.exit(1);
}
```

---

### 🟠 IMPORTANT-R2 — No Docker `HEALTHCHECK` Instruction

**File:** `Dockerfile` — absent

Without a `HEALTHCHECK`, Docker and Railway cannot distinguish a crashed or deadlocked app from a healthy container. If the Node.js process hangs, the container stays in "running" state and receives traffic indefinitely.

**Fix:** Add before `CMD` in the Dockerfile:
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
```
(Uses Node directly since Alpine does not include `wget` or `curl` by default.)

---

### 🟡 NICE-TO-HAVE-R1 — No Error Tracking Integration

Server-side errors are logged to stdout only. In production, there is no alerting, no stack trace aggregation, and no visibility into error frequency.

**Fix:** Add Sentry (free tier is sufficient for a portfolio):
```bash
npm install @sentry/node
```
```js
// server/server.js — before require('./app')
const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
```
Add `SENTRY_DSN` to env vars and `.env.example`.

---

### 🟡 NICE-TO-HAVE-R2 — Token Cleanup Does Not Log Successful No-Op Runs

**File:** `server/services/tokenCleanup.js`, lines 15–17

The cleanup service only logs when it deletes rows. In production, this means the 24-hour job runs silently with no confirmation it is actually executing. A log message like `[tokenCleanup] ran — 0 rows removed` at `debug` level would confirm the scheduler is healthy.

---

## 6. Configuration & Environment Management

---

### 🟠 IMPORTANT-C1 — No Startup Environment Variable Validation

**File:** `server/server.js` — absent

If `DATABASE_URL`, `ADMIN_PASSWORD_HASH`, or `ALLOWED_ORIGINS` are unset in production, the app will start and serve static files successfully, then fail at runtime with confusing errors (e.g., a bcrypt comparison of a hash against `undefined`, or a CORS failure for every request).

**Fix:** Add before `app.listen` in `server/server.js`:
```js
const REQUIRED = ['DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'ALLOWED_ORIGINS'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[startup] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
```

---

### 🟠 IMPORTANT-C2 — `data/portfolio.db.json` Not in `.gitignore`

**File:** `.gitignore`

The `.gitignore` excludes `data/portfolio.db` but the file that actually exists is `data/portfolio.db.json`. The JSON variant is not excluded and could be committed, potentially exposing seed data.

**Fix:** Replace the specific exclusion with the whole directory:
```
data/
```

---

### 🟡 NICE-TO-HAVE-C1 — No Environment-Specific Configuration Separation

There is no convention for `development` vs `staging` vs `production` configuration beyond `NODE_ENV`. A staging environment would require separate `DATABASE_URL`, `ALLOWED_ORIGINS`, `SENTRY_DSN`, and `ADMIN_*` values. Consider explicit naming conventions (`STAGING_DATABASE_URL`) or a `config/` module that reads `NODE_ENV` and applies defaults.

---

## 7. DevOps & Deployment

---

### 🟠 IMPORTANT-DO1 — CI Pipeline Has No Docker Build, Image Scan, or Dependency Audit

**File:** `.github/workflows/ci.yml`

The CI pipeline runs Jest tests against a PostgreSQL service container — which is excellent. But it does not:
- Build the Docker image (a broken `Dockerfile` is caught only at deploy time)
- Run `npm audit` (the `path-to-regexp` ReDoS vulnerability would not be caught)
- Scan the container image for CVEs (Trivy, Grype, Snyk)

**Fix — add to `ci.yml` after the test step:**
```yaml
- name: Check for vulnerabilities
  run: npm audit --audit-level=high

- name: Build Docker image
  run: docker build -t halliprojects:ci .

- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: halliprojects:ci
    exit-code: '1'
    severity: 'CRITICAL,HIGH'
```

---

### 🟠 IMPORTANT-DO2 — No `railway.toml` Configuration File

There is no `railway.toml` or `Procfile`. Railway will auto-detect Node.js and run `npm start`, which works, but gives no control over health check configuration, restart policy, or deploy hooks.

**Fix:** Create `railway.toml` at the project root:
```toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "node server/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

---

### 🟠 IMPORTANT-DO3 — No Migration-on-Deploy Strategy

`npm run migrate` must be run manually to apply schema changes. There is no hook that runs migrations automatically on deploy. If a schema change is deployed without running the migration first, the new code will operate against the old schema and fail at runtime.

**Fix:** Refactor `server/scripts/migrate.js` to export its function:
```js
async function migrate() { /* ... */ }
module.exports = { migrate };

if (require.main === module) {
  migrate().catch(err => { console.error(err); process.exit(1); });
}
```
Then call it in `server/server.js` before `app.listen`:
```js
const { migrate } = require('./scripts/migrate');
await migrate();   // no-op if schema is current, safe to run on every start
```

---

### 🟡 NICE-TO-HAVE-DO1 — No Rollback Plan

There is no documented procedure for rolling back a failed deployment. Railway supports one-click rollback to the previous successful deploy via the dashboard. Document this in a `RUNBOOK.md` so it can be executed quickly under pressure.

---

### 🟡 NICE-TO-HAVE-DO2 — `node:20-alpine` Has No `wget` or `curl`

**File:** `Dockerfile`, line 11: `FROM node:20-alpine AS runner`

Alpine images do not include `wget` or `curl`. If a `HEALTHCHECK` using these tools is added without also installing them, the container will report unhealthy immediately. The Node-based healthcheck in IMPORTANT-R2 above avoids this issue without adding extra packages.

---

## 8. Frontend

---

### 🟠 IMPORTANT-F1 — Google Analytics Tracking ID Is a Placeholder

**File:** `public/index.html`, lines 72, 77:
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

The GA4 Measurement ID `G-XXXXXXXXXX` is never replaced with a real ID. The analytics script loads on every page view (an unnecessary ~30 KB network request) but records nothing. The matching `connectSrc` in the CSP (`server/app.js:24`) also references analytics domains that serve no purpose.

**Fix:** Either replace with your real GA4 Measurement ID, or remove the entire GA4 block until it is ready. If removed, also remove `https://www.google-analytics.com` and `https://analytics.google.com` from the CSP `connectSrc`.

---

### 🟠 IMPORTANT-F2 — Open Graph Social Preview Image Does Not Exist

**File:** `public/index.html`, lines 25, 33:
```html
<meta property="og:image" content="https://halliprojects.is/og-image.jpg" />
<meta name="twitter:image" content="https://halliprojects.is/og-image.jpg" />
```

`public/og-image.jpg` does not exist in the repository. When the site is shared on LinkedIn, Twitter/X, iMessage, Slack, or WhatsApp, the link preview will render with no image — a significant first-impression failure for a portfolio.

**Fix:** Create a 1200×630 px image and save it as `public/og-image.jpg`. The image should prominently feature the site name and something that communicates the carpentry/tech dual identity.

---

### 🟠 IMPORTANT-F3 — All Social Profile Links Are Placeholder Text

**Files and lines:**
- `public/index.html:65–66` — JSON-LD `sameAs` array
- `public/js/views/HomeView.js:327` — footer nav GitHub link
- `public/js/views/HomeView.js:334` — GitHub social icon
- `public/js/views/HomeView.js:340` — LinkedIn social icon
- `public/js/views/HomeView.js:346` — X (Twitter) social icon

All social links contain literal placeholder text:
```
https://github.com/YOUR_GITHUB_USERNAME
https://linkedin.com/in/YOUR_LINKEDIN_USERNAME
https://x.com/YOUR_X_USERNAME
```

Visitors who click these will land on 404 pages, and the JSON-LD structured data will reference non-existent profiles.

**Fix:** Do a global find-and-replace for each placeholder with the real username/URL.

---

### 🟠 IMPORTANT-F4 — About Page Describes Wrong Tech Stack

**File:** `public/js/views/AboutView.js`, line 54:
```js
This portfolio is built with Node.js + Express + SQLite + Vanilla JS · MVC + Component pattern
```

The database is **PostgreSQL**, not SQLite. Every visitor to the About page sees this incorrect information. For a technical portfolio this directly undermines credibility.

**Fix:** Update to: `Node.js + Express + PostgreSQL + Vanilla JS · MVC + Component pattern`

---

### 🟠 IMPORTANT-F5 — Domain Inconsistency: `.com` vs `.is`

The canonical URL, Open Graph tags, and JSON-LD structured data all correctly reference `halliprojects.is`. But the Privacy Policy and contact email use `.com`:

- `public/js/views/PrivacyView.js:17` — `halliprojects.com`
- `public/js/views/HomeView.js:329, 352` — `halli@halliprojects.com`

A Privacy Policy that names the wrong domain may not be legally valid. Search engines may treat the two domains as different entities, splitting any SEO benefit.

**Fix:** Decide on one canonical domain (`.is` appears to be correct based on `index.html`) and replace all `.com` references consistently.

---

### 🟡 NICE-TO-HAVE-F1 — No `robots.txt`

Without a `robots.txt`, search crawlers will index everything by default — including `/auth/login`, `/api/v1/projects`, and other endpoints that should not appear in search results.

**Fix:** Create `public/robots.txt`:
```
User-agent: *
Disallow: /auth/
Disallow: /api/
Allow: /
Sitemap: https://halliprojects.is/sitemap.xml
```

---

### 🟡 NICE-TO-HAVE-F2 — No `sitemap.xml`

Hash-based routing (`#/projects`, `#/about`) is not reliably crawled by search engines since crawlers may not execute JavaScript. A static `sitemap.xml` tells search engines that these views exist and their canonical URLs.

---

### 🟡 NICE-TO-HAVE-F3 — No PWA `manifest.json`

There is no Web App Manifest and no service worker. The site cannot be installed to a home screen, has no offline support, and scores lower on Lighthouse PWA audits. For a portfolio that showcases technical skill, a service worker with cache-first strategy for static assets is a worthwhile addition.

---

### 🟡 NICE-TO-HAVE-F4 — `<article role="button">` — ARIA Semantic Conflict

**File:** `public/js/components/ProjectCard.js`, lines 20–22:
```js
const card = document.createElement('article');
card.setAttribute('role', 'button');
card.setAttribute('tabindex', '0');
```

Assigning `role="button"` to an `<article>` element creates a semantic conflict. Screen readers will announce this as an interactive button but the `<article>` landmark provides no navigation affordance. Some screen readers will ignore the ARIA role override and announce it as an article.

**Fix:** Use `<div role="button" tabindex="0" aria-label="View project: ${title}">` for the interactive card wrapper, or make the card's title an `<a>` element and navigate on click.

---

### 🟡 NICE-TO-HAVE-F5 — `role="menubar"` Misused on Navigation

**File:** `public/js/components/NavBar.js`, line 23:
```html
<div class="lol-nav__center" id="nav-menu" role="menubar">
  <a href="#/" ... role="menuitem">Home</a>
```

The ARIA `menubar` / `menuitem` roles are designed for application menus (desktop-style dropdown menus) and require specific keyboard interactions: arrow key navigation, `Home`/`End` support, and roving `tabindex`. This nav does not implement any of that. Screen reader users who expect `menubar` behavior will find the nav non-functional via keyboard.

**Fix:** Remove `role="menubar"` and `role="menuitem"` from the nav links. A `<nav aria-label="Main navigation">` containing `<a>` elements is the correct, accessible pattern. No extra roles needed.

---

## 9. Documentation

---

### 🟠 IMPORTANT-DOC1 — No README.md

There is no `README.md` at the project root. A developer cloning the repository has no quick-start instructions, no architecture overview, and no documentation of how to run or deploy the project.

**Minimum README should cover:**
- Project description and tech stack
- Prerequisites (Node 20+, PostgreSQL 16+)
- Local setup: `npm install && cp .env.example .env && node server/scripts/migrate.js && npm run seed`
- Running locally: `npm run dev`
- Running tests: `npm test`
- Environment variables (with link to `.env.example`)
- Deployment (Railway steps, required secrets)
- Admin access (reference `setup-admin.js`)

---

### 🟡 NICE-TO-HAVE-DOC1 — No API Documentation

There are no JSDoc comments on controllers or routes, and no OpenAPI/Swagger specification. An `API.md` in a `docs/` directory documenting the six REST endpoints, their request/response shapes, auth requirements, and rate limits would be valuable for any future collaborator or for the GitHub README.

---

### 🟡 NICE-TO-HAVE-DOC2 — No CHANGELOG

No record of what changed between versions. Relevant once you start doing versioned releases or want to communicate changes to users.

---

## 10. Legal / Compliance

---

### 🟠 IMPORTANT-L1 — No Cookie Consent Banner (GDPR / ePrivacy Violation)

**File:** `public/js/views/PrivacyView.js`, section 2

The Privacy Policy correctly discloses Google Analytics usage. However, under the **GDPR** (applicable in Iceland as an EEA member) and the **ePrivacy Directive**, analytics cookies require **prior, freely given, informed consent** before they are set. The current implementation loads GA4 on page load with no consent mechanism, setting cookies for all visitors including EU/EEA users before they have agreed to anything.

This is a legal violation that can result in regulatory fines.

**Fix:** Do not load the GA4 snippet until the user consents. Minimum viable implementation:
```js
// public/js/consent.js
export function initConsent() {
  if (localStorage.getItem('cookie_consent') === 'granted') {
    loadGA4();
    return;
  }
  renderConsentBanner(); // show banner with Accept / Decline
}

function loadGA4() {
  const s = document.createElement('script');
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-YOURTRACKINGID';
  s.async = true;
  document.head.appendChild(s);
}
```
Alternatively, use a lightweight consent library (Klaro, Vanilla CookieConsent, Osano).

---

### 🟠 IMPORTANT-L2 — GA4 Fires Immediately, Before Any Consent Check

**File:** `public/index.html`, lines 72–78

Even once a real tracking ID replaces the placeholder, the current inline GA4 snippet fires on every page load unconditionally. The consent mechanism from IMPORTANT-L1 must be in place before a real tracking ID is used.

---

### 🟡 NICE-TO-HAVE-L1 — No LICENSE File

There is no `LICENSE` file in the repository. Without one, the project is legally "all rights reserved" by default. If you intend for the code to be viewable and referenceable on GitHub, add at minimum an `MIT` or `Apache-2.0` license.

---

### 🟡 NICE-TO-HAVE-L2 — Privacy Policy Names Wrong Domain

**File:** `public/js/views/PrivacyView.js`, line 17:
```html
This website (<strong>halliprojects.com</strong>) is the personal portfolio...
```

The canonical domain established everywhere else is `halliprojects.is`. A Privacy Policy that names the wrong domain may be considered invalid by a data protection authority. (See also IMPORTANT-F5.)

---

## Summary Matrix

| ID | Severity | Area | Finding |
|---|---|---|---|
| CRITICAL-1 | 🔴 CRITICAL | Security | RSA private key not in `.gitignore`; stray `.pem` files at root |
| CRITICAL-2 | 🔴 CRITICAL | Docker | `COPY keys/` bakes private key into Docker image |
| CRITICAL-3 | 🔴 CRITICAL | Config | `.env` has real credentials; `ADMIN_USERNAME=admin`; no `.env.example` |
| IMPORTANT-S1 | 🟠 IMPORTANT | Security | `rejectUnauthorized: false` — DB TLS cert not verified |
| IMPORTANT-S2 | 🟠 IMPORTANT | Security | `path-to-regexp` ReDoS CVE (CVSS 7.5) — run `npm audit fix` |
| IMPORTANT-S3 | 🟠 IMPORTANT | Security | CSP `'unsafe-inline'` on scripts — weaken XSS protection |
| IMPORTANT-S4 | 🟠 IMPORTANT | Security | No `Permissions-Policy` header |
| IMPORTANT-Q1 | 🟠 IMPORTANT | Quality | `require('crypto')` called inside per-request middleware |
| IMPORTANT-Q2 | 🟠 IMPORTANT | Quality | **Bug:** `escHtml()` on form `.value` in edit mode corrupts data |
| IMPORTANT-Q3 | 🟠 IMPORTANT | Quality | Graceful shutdown does not close the database pool |
| IMPORTANT-Q4 | 🟠 IMPORTANT | Quality | `jest.config.js` comment says "serially" but `runInBand: false` |
| IMPORTANT-D1 | 🟠 IMPORTANT | Database | No migration versioning — schema changes require manual `ALTER TABLE` |
| IMPORTANT-D2 | 🟠 IMPORTANT | Database | Schema DDL duplicated between `migrate.js` and `globalSetup.js` |
| IMPORTANT-P1 | 🟠 IMPORTANT | Performance | No gzip/brotli compression middleware |
| IMPORTANT-P2 | 🟠 IMPORTANT | Performance | No `Cache-Control` headers on static assets |
| IMPORTANT-P3 | 🟠 IMPORTANT | Performance | Video file served by Node.js — should be on CDN |
| IMPORTANT-R1 | 🟠 IMPORTANT | Reliability | Health check does not verify RSA key loading |
| IMPORTANT-R2 | 🟠 IMPORTANT | Reliability | No Docker `HEALTHCHECK` instruction |
| IMPORTANT-C1 | 🟠 IMPORTANT | Config | No startup env var validation; app silently starts with missing vars |
| IMPORTANT-C2 | 🟠 IMPORTANT | Config | `data/portfolio.db.json` not gitignored |
| IMPORTANT-DO1 | 🟠 IMPORTANT | DevOps | CI has no Docker build, `npm audit`, or image vulnerability scan |
| IMPORTANT-DO2 | 🟠 IMPORTANT | DevOps | No `railway.toml` — no health check or restart policy configured |
| IMPORTANT-DO3 | 🟠 IMPORTANT | DevOps | No migration-on-deploy strategy |
| IMPORTANT-F1 | 🟠 IMPORTANT | Frontend | GA4 tracking ID is placeholder `G-XXXXXXXXXX` |
| IMPORTANT-F2 | 🟠 IMPORTANT | Frontend | `og-image.jpg` referenced in meta tags but file does not exist |
| IMPORTANT-F3 | 🟠 IMPORTANT | Frontend | All social profile links contain `YOUR_GITHUB_USERNAME` placeholders |
| IMPORTANT-F4 | 🟠 IMPORTANT | Frontend | About page says "SQLite" — database is PostgreSQL |
| IMPORTANT-F5 | 🟠 IMPORTANT | Frontend | `halliprojects.com` vs `.is` domain mismatch across files |
| IMPORTANT-DOC1 | 🟠 IMPORTANT | Docs | No `README.md` |
| IMPORTANT-L1 | 🟠 IMPORTANT | Legal | No cookie consent banner — GDPR violation once GA is active |
| IMPORTANT-L2 | 🟠 IMPORTANT | Legal | GA4 fires unconditionally before any consent check |
| NICE-TO-HAVE-S1 | 🟡 NICE-TO-HAVE | Security | No SRI hashes on Google Fonts |
| NICE-TO-HAVE-S2 | 🟡 NICE-TO-HAVE | Security | No rate limiting on `/auth/refresh` |
| NICE-TO-HAVE-Q1 | 🟡 NICE-TO-HAVE | Quality | `escHtml()` duplicated in 5 files — extract to shared util |
| NICE-TO-HAVE-Q2 | 🟡 NICE-TO-HAVE | Quality | No structured logging (pino / winston) |
| NICE-TO-HAVE-Q3 | 🟡 NICE-TO-HAVE | Quality | No global `unhandledRejection` / `uncaughtException` handler |
| NICE-TO-HAVE-D1 | 🟡 NICE-TO-HAVE | Database | No database backup strategy documented or verified |
| NICE-TO-HAVE-D2 | 🟡 NICE-TO-HAVE | Database | `SELECT *` in all queries |
| NICE-TO-HAVE-D3 | 🟡 NICE-TO-HAVE | Database | Refresh token rotation not wrapped in a DB transaction |
| NICE-TO-HAVE-P1 | 🟡 NICE-TO-HAVE | Performance | No pagination on `GET /api/v1/projects` |
| NICE-TO-HAVE-P2 | 🟡 NICE-TO-HAVE | Performance | No API response caching on read-heavy endpoints |
| NICE-TO-HAVE-P3 | 🟡 NICE-TO-HAVE | Performance | Google Fonts loaded twice — CSS `@import` + HTML `<link>` |
| NICE-TO-HAVE-R1 | 🟡 NICE-TO-HAVE | Reliability | No error tracking service (Sentry etc.) |
| NICE-TO-HAVE-R2 | 🟡 NICE-TO-HAVE | Reliability | Token cleanup job logs nothing on successful no-op runs |
| NICE-TO-HAVE-C1 | 🟡 NICE-TO-HAVE | Config | No dev / staging / prod environment separation convention |
| NICE-TO-HAVE-DO1 | 🟡 NICE-TO-HAVE | DevOps | No rollback plan documented |
| NICE-TO-HAVE-DO2 | 🟡 NICE-TO-HAVE | DevOps | Alpine image needs Node-based healthcheck (no `wget`/`curl`) |
| NICE-TO-HAVE-F1 | 🟡 NICE-TO-HAVE | Frontend | No `robots.txt` |
| NICE-TO-HAVE-F2 | 🟡 NICE-TO-HAVE | Frontend | No `sitemap.xml` |
| NICE-TO-HAVE-F3 | 🟡 NICE-TO-HAVE | Frontend | No PWA `manifest.json` or service worker |
| NICE-TO-HAVE-F4 | 🟡 NICE-TO-HAVE | Frontend | `<article role="button">` — ARIA semantic conflict in `ProjectCard` |
| NICE-TO-HAVE-F5 | 🟡 NICE-TO-HAVE | Frontend | `role="menubar"` misused on nav — breaks screen reader keyboard nav |
| NICE-TO-HAVE-DOC1 | 🟡 NICE-TO-HAVE | Docs | No API documentation |
| NICE-TO-HAVE-DOC2 | 🟡 NICE-TO-HAVE | Docs | No CHANGELOG |
| NICE-TO-HAVE-L1 | 🟡 NICE-TO-HAVE | Legal | No `LICENSE` file |
| NICE-TO-HAVE-L2 | 🟡 NICE-TO-HAVE | Legal | Privacy Policy names `halliprojects.com` — canonical domain is `.is` |

**Totals: 3 Critical · 28 Important · 22 Nice-to-Have**

---

## Recommended Launch Sequence

### Phase 1 — Before Any Git Push or Public Repo (do today)

These must be done before the repository is pushed to GitHub or any other remote. Three of them involve secrets that could be exposed in git history.

1. Add `keys/` and `*.pem` to `.gitignore`
2. Delete the two stray `.pem` files from the project root (`ClaudeHalliProjectskeysprivate.pem`, `ClaudeHalliProjectskeyspublic.pem`)
3. Rotate the RSA keypair: `openssl genrsa -out keys/private.pem 2048 && openssl rsa -in keys/private.pem -pubout -out keys/public.pem`
4. Add `.env.*` to `.gitignore` (currently only `.env` is excluded)
5. Create `.env.example` with empty/placeholder values and commit it
6. Change `ADMIN_USERNAME` from `admin` to something non-obvious
7. Generate a new production admin password hash: `node server/scripts/setup-admin.js <strong-password>`

### Phase 2 — Security Fixes (1–2 hours)

8. Run `npm audit fix` — patches the `path-to-regexp` ReDoS CVE
9. Fix DB SSL: change `{ rejectUnauthorized: false }` to `{ rejectUnauthorized: true }` in `server/config/database.js:8`
10. Update `server/config/keys.js` to support env-var-based key loading (env var takes priority over file)
11. Remove `COPY keys/ ./keys/` from `Dockerfile`
12. Add `Permissions-Policy` header in `server/app.js`
13. Add startup env var validation in `server/server.js`

### Phase 3 — Content Fixes (1–2 hours)

14. Replace all `YOUR_GITHUB_USERNAME`, `YOUR_LINKEDIN_USERNAME`, `YOUR_X_USERNAME` placeholders (5 locations across `index.html` and `HomeView.js`)
15. Replace `G-XXXXXXXXXX` with real GA4 Measurement ID, or remove the GA4 block entirely
16. Create `public/og-image.jpg` (1200×630 px)
17. Fix `AboutView.js:54` — change "SQLite" to "PostgreSQL"
18. Standardise all domain references to `halliprojects.is` (update `PrivacyView.js:17` and contact email addresses)
19. Fix `ProjectForm.js:99–100` — remove `escHtml()` from form `.value` assignments (data corruption bug)

### Phase 4 — Infrastructure (2–3 hours)

20. Add `compression` middleware to `server/app.js`
21. Add `Cache-Control` headers to `express.static` options
22. Add Docker `HEALTHCHECK` instruction to `Dockerfile`
23. Add graceful DB pool shutdown in `server/server.js`
24. Create `railway.toml` with health check path and restart policy
25. Add `data/` to `.gitignore` (covers `data/portfolio.db.json`)

### Phase 5 — Legal (30 minutes)

26. Add cookie consent banner before GA4 fires (required for any EU/EEA visitors)
27. Move GA4 snippet loading to be conditional on consent
28. Add `LICENSE` file (MIT recommended)

### Phase 6 — Documentation (1 hour)

29. Write `README.md` (setup, dev, test, deploy, env vars)

### Post-Launch (nice-to-haves, prioritised)

30. Move hero video to CDN (biggest performance win)
31. Remove duplicate Google Fonts `@import` from `public/css/main.css:1`
32. Add `robots.txt` and `sitemap.xml`
33. Extract shared `escHtml` utility (deduplicate from 5 files)
34. Add structured logging (pino)
35. Add `unhandledRejection` handler in `server/server.js`
36. Add Sentry error tracking
37. Add rate limiter to `/auth/refresh` endpoint
38. Implement versioned migrations
39. Extract shared schema DDL between `migrate.js` and `globalSetup.js`
40. Add pagination to `GET /api/v1/projects`
41. Fix ARIA issues in `ProjectCard` and `NavBar`
42. Add `manifest.json` and service worker

---

*Report generated by manual review of all source files on 2026-03-30.*
