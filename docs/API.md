# API Reference — public + auth surface

Base URL: the deployed origin. `server/app.js` still pins
`CANONICAL_HOST = 'www.hallismiley.is'` (the domain cutover to orangesmiley.is
is tracked in CLAUDE.md); this repo has no deployed instance yet.

This document covers the **public and authentication** endpoints in detail and
ends with an **inventory of every mounted router** so the admin surface is at
least findable. The admin API (207 route declarations across the `/api/v1/admin/*`
routers, of 353 in `server/routes/` altogether — counted 2026-09-11 by
summing `grep -cE '^\s*router\.(get|post|put|patch|delete)\('` over
`server/routes/*.js`) is documented by its route files and the feature docs
they point at, not here. Read 2026-09-11 against `server/app.js` and `server/routes/`.

Auth endpoints are mounted at `/auth`; everything else is under `/api/v1/`.
Authenticated endpoints require a valid session cookie (`auth_session`)
obtained via `POST /auth/login`.

---

## Authentication

Authentication uses Lucia v3 session-based cookies (one auth system — there is
no JWT layer). The `auth_session` httpOnly, `SameSite=Strict` cookie is set by
the server on login and cleared on logout — the browser handles it
automatically. No tokens are stored in the frontend.

### CSRF — required on every state-changing request

Every session-authenticated write route (POST/PUT/PATCH/DELETE, including
`POST /auth/logout`) carries `csrfProtect` (`server/middleware/csrf.js`). Fetch a token first and
send it back as the `X-CSRF-Token` header:

```
GET /api/v1/csrf-token            →  200 { "token": "…" }
```

The token is bound to a `SameSite=Strict` cookie (`secure` in production).
A missing or stale token answers `403` in the standard error envelope. Routes
that deliberately omit `csrfProtect` (read 2026-09-11, `grep -L csrfProtect`):
the bearer-only MCP endpoint (`docs/mcp.md`), the public lead form
`POST /api/v1/contact` and the analytics beacon `POST /api/v1/analytics/collect`
(both anonymous, rate-limited, and write only their own row), and the
read-only routers. Note the asymmetry: the client-error beacon
`POST /api/v1/events/collect` DOES carry `csrfProtect`.

### POST /auth/login

Authenticate and start a session (or a 2FA challenge).

**Rate limit:** 50 requests / 15 min per IP.

**Request body:**
```json
{ "username": "string", "password": "string" }
```

**Response `200 OK`** — password accepted, no 2FA on the account:
```json
{ "user": { "id": "uuid", "username": "admin", "email": "admin@example.com", "role": "admin" } }
```
Sets the `auth_session` cookie.

**Response `200 OK`** — password accepted, account is 2FA-protected
(admins and every holder of the `accounts` view — `mfaService.isProtected`):
```json
{ "mfaRequired": true, "challengeId": "uuid", "expiresInMs": 300000 }
```
No cookie is set on this branch. Complete the login with
`POST /auth/login/totp` `{ "challengeId": "…", "code": "123456" }` (same 50/15 min
limiter), which sets the cookie and answers
`{ "usedRecoveryCode": false, "recoveryCodesRemaining": n, "user": { … } }`.

**Errors:** `400` missing fields · `401` invalid credentials · `401` account
temporarily locked (after 5 failed attempts) · `403` account disabled ·
`403` party-guest approval pending · `403` party-guest request declined ·
`403` `reason: account_expired` — a time-limited login whose `users.expires_at`
has passed (migration 114; only AFTER the password checked out, so it never
tells a guesser the account exists). The 2FA step, the party magic link and the
Google/Facebook callbacks (`?error=account_expired`) refuse it the same way; a
live session of such a login dies on its next request (`401`
`reason: account_expired`) — [HISTORY](history.d/2026-09-26-feat-login-expiry.md#login-expiry-2026-09-26).

---

### POST /auth/logout

Invalidate the current session and clear the cookie.

**Request:** No body. Session is read from the `auth_session` cookie.
**Requires** `X-CSRF-Token`.

**Response:** `204 No Content`

Safe to call when not logged in (idempotent).

---

### GET /auth/session

Return the current session/user info without requiring auth.

**Response `200 OK`** (logged in):
```json
{ "authenticated": true, "user": { "id": "uuid", "username": "admin", "email": "admin@example.com", "role": "admin" } }
```

**Response `200 OK`** (not logged in): `{ "authenticated": false }` — plus
`"reason": "account_expired"` when the cookie belonged to a time-limited login
that has run out (its sessions are deleted on the spot).

Use this on page load to restore session state.

Every session payload (`/auth/login`, `/auth/login/totp`, `/auth/session`, signup,
party magic link) also carries `mfa_enrolment_required` (true only under
`security.mfa.enrolment = required`, for a protected account without TOTP) and
`mfa_reminder` (true only under `optional`, for a protected account without TOTP
that has not dismissed the reminder) — `docs/ADMIN-2FA.md`.

---

### Other `/auth` routes (`server/routes/authRoutes.js`)

| Route | Gate / limiter |
|---|---|
| `POST /auth/signup` | 75 / 10 min per IP, validated body |
| `POST /auth/verify-email` | — |
| `POST /auth/resend-verification` | 5 / minute per IP |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | 25 / hour per IP |
| `POST /auth/totp/setup`, `/totp/confirm`, `/totp/disable` | session + CSRF |
| `POST /auth/mfa-reminder/dismiss` | 30 / 15 min per IP, CSRF, session. "Don't show this again" on the two-step reminder: stamps the caller's own `users.mfa_reminder_dismissed_at` (the body is ignored), idempotent, `200 { "mfa_reminder": false }` (mfa-reminder-2026-09-23) |
| `GET /auth/check-username/:username`, `GET /auth/check-email/:email` | 150 / hour per IP |
| `POST /auth/party-magic-login` | 50 / 15 min per IP (hidden party module) |
| `GET /auth/google`, `/google/callback`, `/facebook`, `/facebook/callback` | `socialLoginGate` — answer `404` unless `SOCIAL_LOGIN_ENABLED=true` (OFF on this instance: no OAuth app configured) |

---

## Projects

The projects module is the base's portfolio feature. On this site it is a
hidden surface (`/verkefni` is in `server/config/publicSurface.js`), but the
API is fully functional.

### GET /api/v1/projects

List all projects. Supports filtering and pagination.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | `carpentry` \| `tech` | — | Filter by category |
| `featured` | `true` \| `false` | — | Filter by featured status |
| `year` | integer 1900–2100 | — | Filter by year |
| `limit` | integer 1–100 | `20` | Max results per page |
| `offset` | integer ≥ 0 | `0` | Number of results to skip |

**Response `200 OK`:** array of project objects:
```json
[{ "id": 1, "title": "…", "title_is": "…", "description": "…", "description_is": "…",
   "category": "carpentry", "year": 2023, "tools_used": ["…"], "image_url": "https://…",
   "featured": true, "created_at": "…", "updated_at": "…" }]
```

**Errors:** `400` invalid query params

### GET /api/v1/projects/featured

**Cache:** `public, max-age=300, stale-while-revalidate=60`. Same shape.

### GET /api/v1/projects/:id

**Errors:** `404` not found. Sub-resources: `GET /:id/media`, `/:id/sections`,
`/:id/videos` (see `projectRoutes.js` for the matching admin writes).

### POST /api/v1/projects

Create a project. **Requires a session with role `admin` or `moderator`, plus
`X-CSRF-Token`.**

**Rate limit:** 450 write requests / 15 min per IP.

```json
{
  "title": "string (max 200)",
  "title_is": "string (optional, same cap)",
  "description": "string (max 10000)",
  "description_is": "string (optional, same cap)",
  "category": "carpentry | tech",
  "year": 2024,
  "tools_used": ["string (max 100 each, max 50 items)"],
  "image_url": "https://...",
  "featured": false
}
```
`title`, `description`, `category` and `year` are required **on POST only**
(`server/middleware/validate.js`).

**Response `201 Created`:** created project. **Errors:** `400` validation ·
`401` no session · `403` wrong role or CSRF

### PUT /api/v1/projects/:id · PATCH /api/v1/projects/:id

Both are the **same partial update** (`projectController.update`; no field is
required on either — PUT is not a replace). Same gate as POST.

**Response `200 OK`:** updated project. **Errors:** `400` · `401` · `403` · `404`

### DELETE /api/v1/projects/:id

Same gate as POST. **Response:** `204 No Content`. **Errors:** `401` · `403` · `404`

---

## Contact (the lead form, `/hafa-samband`)

### POST /api/v1/contact

Submit an enquiry. It is emailed to the company inbox AND stored as a row in
`leads` (migration 097, worked at `/admin/leads`) — `/personuvernd` §3 + §6
describe that store and must change together with it.

**Rate limit:** 5 / hour per IP (`contactRoutes.js`, `LEAD_RATE_LIMIT`).

```json
{ "name": "≤100", "email": "≤200", "message": "10–2000 chars",
  "company": "optional ≤150", "phone": "optional ≤40",
  "current_platform": "optional — shopify|wix|wordpress|woocommerce|squarespace|dk|regla|payday|none|other (anything else is stored as other)",
  "website": "honeypot — leave empty" }
```

**Response `200 OK`:** `{ "message": "<localised confirmation>" }` (a filled
honeypot also answers 200 and is silently discarded).

**Errors:** `400 { "errors": ["<localised message>", …] }` — **this is the one
endpoint that does not use the standard envelope**; it returns the full list
of validation failures as an array.

---

## Error format

Every other error returns the envelope from `server/middleware/errorHandler.js`:
```json
{ "error": "Human-readable message", "code": 400 }
```

Two optional fields ride on that shape; a client that ignores them loses
nothing:

- **`reason`** — a stable, machine-readable string next to the translated
  `error`, for a client that must branch on WHY. The central handler emits it
  for a TYPED 4xx error (one carrying an i18n `messageKey`, whose `error` it
  translates for the request's locale), e.g. `account_expired` (403 on a
  sign-in, 401 when a live session dies) and `admin_account` (409 on
  `PATCH /api/v1/admin/users/:id/expiry`) —
  [login-expiry-2026-09-26](history.d/2026-09-26-feat-login-expiry.md#login-expiry-2026-09-26). Some
  controllers set it inline the same way (`password_required`,
  `username_taken`, `POSSIBLE_DUPLICATE`, `INSUFFICIENT_STOCK`…). A 5xx never
  carries one.
- **`retryable: true`** — only on the `409` `reason: "BUSY"` answer to a
  Postgres deadlock victim (40P01): nothing happened, send the same request
  again.

## Rate limits (`express-rate-limit`, all skipped when `NODE_ENV` is `test` or `development`)

| Scope | Limit | Where |
|-------|-------|-------|
| Global (all endpoints; static assets exempt by location, `utils/staticAsset.js`) | 2000 / 15 min per IP | `server/app.js` |
| Writes (POST/PUT/PATCH/DELETE) | 450 / 15 min per IP | `server/app.js` |
| Auth login (+ TOTP step) | 50 / 15 min per IP | `authRoutes.js` |
| Signup | 75 / 10 min per IP | `authRoutes.js` |
| Password reset (forgot + reset) | 25 / hour per IP | `authRoutes.js` |
| Resend verification | 5 / minute per IP | `authRoutes.js` |
| Username/email availability checks | 150 / hour per IP | `authRoutes.js` |
| Contact / lead form | 5 / hour per IP | `contactRoutes.js` |
| Shop checkout | 50 / 15 min per IP | `shopRoutes.js` |
| Client error beacon / analytics beacon | 100 / 300 per window | `eventRoutes.js`, `analyticsRoutes.js` |
| MCP (per token) | 300 / 15 min (`MCP_RATE_LIMIT_MAX`) | `mcpRoutes.js` |
| Self-update apply/rollback | 10 / window | `systemRoutes.js` |

Rate-limit responses use HTTP `429` with standard `RateLimit-*` headers.

---

## Router inventory (`server/app.js` mounts, in mount order)

Gates are the router's own (`requireAuth`, `requireRole`, `requireView(id)` —
view ids in `server/auth/adminViews.js`), plus one in front of them all: a
mount that belongs to a module this instance has switched off (`modules.*` in
`config/client.json`; the owners are `server/config/moduleCatalog.js`) answers
`404 { "error": "Not found", "code": 404 }` from `moduleGate`, mounted after
`hpp()` and before every row below — before body parsing, limiters, CSRF and
auth (R4, [HISTORY](HISTORY.md#module-flags-2026-09-24)). Most `/api/v1/admin/*` routers are
mounted before the generic `/api/v1/admin` router, but `mcp-tokens` and
`events` are mounted AFTER it (their inline comments claim otherwise) — it
works today only because `adminRoutes.js` has no handler on those paths.

**One outer door** ([HISTORY](HISTORY.md#harvest-ice-a-2026-09-24)): `app.use('/api/v1/admin', requireAuth, requireStaff)` runs after
`moduleGate` and before every `/api/v1/admin*` row below (the `mcp-tokens`/`events`
mounts included). Signed out → 401; a signed-in account with no staff standing
(not admin/moderator, no admin view) → 403 before any admin router runs. Each
router's own gate still applies behind it.

| Mount | File | Gate | Feature doc |
|---|---|---|---|
| `/api/v1/seller-publish` | `sellerPublishRoutes.js` | mounted BEFORE `express.json` (raw body); `INSTANCE_ROLE=public` + `SELLER_PUBLISH_SECRET`, else 404; HMAC signature (401), shape (400), newer-than-last (409); own limiter 30/15 min | [ARCHITECTURE §21](ARCHITECTURE.md#21-seller-area--the-published-copy-on-the-public-instance) · [HISTORY](HISTORY.md#seller-area) |
| `/.well-known/oauth-protected-resource[/api/v1/mcp]`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/api/v1/oauth/requests/:id[/approve\|/deny]` | `mcpOAuthRoutes.js` (mounted at `/`, after the MCP router) | every route `MCP_ENABLED` else 404; register/token/revoke: no cookies, own IP limiters, RFC 6749 error bodies; authorize: validates, stores a pending request, 302 to `/<lc>/tengja/<id>`; consent API: session + `admin` + CSRF on writes | [ARCHITECTURE §15](ARCHITECTURE.md#15-mcp-connector) · [HISTORY](HISTORY.md#mcp-oauth-2026-09-24) |
| `/api/v1/admin/modules` | `adminModulesRoutes.js` | session + `admin`; `PATCH /:id` CSRF — `{ enabled }`, the contract is the ceiling (400 beyond it) | [ARCHITECTURE §20](ARCHITECTURE.md#20-infrastructure-and-cross-cutting) · [HISTORY](HISTORY.md#mcp-write-tools-2026-09-24) |
| `/api/v1/admin/demo` | `adminDemoRoutes.js` | 404 unless `DEMO_INSTANCE=true`; session + `admin`; `GET /` status, `POST /reset` CSRF → 202 (the reset runs after the answer and restarts the site) | [ARCHITECTURE §20](ARCHITECTURE.md#20-infrastructure-and-cross-cutting) · [HISTORY](history.d/2026-09-26-feat-demo-mode.md#demo-instance-2026-09-26) |
| `/auth` | `authRoutes.js` | per route (above); `/auth/signup`, `/auth/check-username`, `/auth/check-email` belong to the `signup` module (404 before auth when it is off, [HISTORY](HISTORY.md#signup-switch-2026-09-24)) | — |
| `/api/v1/projects` | `projectRoutes.js` | public reads; admin/moderator writes | — |
| `/api/v1/contact` | `contactRoutes.js` | public, 5/h | `docs/SALES-STAFF.md` |
| `/api/v1/users` | `userRoutes.js` | session; `PUT /me/{page-width, aside-width}` `{ path, width }` (`'*'` = all pages, `null` = page default; 100 keys) · `PUT /me/page-width-motion` `{ on }` · `PUT /me/cookie-consent` `{ value: accepted\|declined }` — CSRF, the caller's own row | [HISTORY](HISTORY.md#harvest-ice-b-2026-09-24) |
| `/api/v1/analytics` | `analyticsRoutes.js` | public beacon | `RUNBOOK.md` (Analytics) |
| `/api/v1/change-requests` | `changeRequestRoutes.js` | `changeRequestGate` (admin, and non-prod or switch on) | — |
| `/api/v1/system` | `systemRoutes.js` | `/changes` admin (above the module gate); `/version`, `/updates` and the writes are behind the `modules.selfUpdate.enabled` gate (404 when off) and the `updates` view / admin | `docs/SELF-UPDATE.md` |
| `/api/v1/admin/shop` | `adminShopRoutes.js` | `products` / `collections` / `sales` views per sub-path (hidden retail surface) | — |
| `/api/v1/admin/analytics` | `analyticsAdminRoutes.js` | `analytics` view | — |
| `/api/v1/admin/general-settings` | `adminGeneralSettingsRoutes.js` | `general` view | — |
| `/api/v1/admin/discounts` | `adminDiscountRoutes.js` | admin views (hidden) | — |
| `/api/v1/admin/background` | `adminBackgroundRoutes.js` | admin (hidden) | — |
| `/api/v1/admin/change-requests` | `adminChangeRequestRoutes.js` | `feedback` view | — |
| `/api/v1/admin/nav-config` | `adminNavRoutes.js` | admin (`requireRole`) | — |
| `/api/v1/admin/roles` | `adminRolesRoutes.js` | admin | — |
| `/api/v1/admin/bins` | `adminBinsRoutes.js` | admin views (hidden) | — |
| `/api/v1/admin/customers` | `adminCustomerRoutes.js` | `customers` view; `POST /` admin + CSRF — `{ email }` → welcome invite, `invited` only when it reached the customer, else `resetUrl` (+ `emailError`); `{ no_email: true, display_name }` → a name-only login, `{ username, password }` once (`no-store`); either takes an optional future `expires_at` (a time-limited login, migration 114) | `docs/SALES-STAFF.md` · [HISTORY](HISTORY.md#harvest-ice-a-2026-09-24) |
| `/api/v1/admin/customer-notes` | `adminCustomerNotesRoutes.js` | `customers` view | — |
| `/api/v1/admin/bookkeeping` | `adminBookkeepingRoutes.js` (76 routes) | `books`/`invoices`/`expenses`/`ar`/`vat`/`bank`/`ledger`/`payroll`/`pos` views; admin for issuing | `docs/BOOKKEEPING-SYSTEM.md` |
| `/api/v1/admin/handbok` | `salesGuidesRoutes.js` | `handbok` view; admin/moderator edit | `docs/SALES-STAFF.md` |
| `/api/v1/admin/leads` | `leadsRoutes.js` | `leads` view; delete + CSV admin | `docs/SALES-STAFF.md` |
| `/api/v1/admin/markadur` | `marketRoutes.js` | `markadur` view; status PATCH admin/moderator | [ARCHITECTURE §7](ARCHITECTURE.md#7-markaður--market-research-and-the-prospect-list) · [HISTORY](HISTORY.md#markadur) |
| `/api/v1/admin/accounts` | `adminAccountRoutes.js` | `accounts` view + `accountScope` | [ARCHITECTURE §8](ARCHITECTURE.md#8-customer-accounts-commission-staff-audit) · [HISTORY](HISTORY.md#accounts-commission) |
| `/api/v1/admin/commission` | `adminCommissionRoutes.js` | `commission` view + `commissionScope`; writes admin | [ARCHITECTURE §8](ARCHITECTURE.md#8-customer-accounts-commission-staff-audit) · [HISTORY](HISTORY.md#migrations-100-102) |
| `/api/v1/admin/audit` | `adminAuditRoutes.js` | admin | [ARCHITECTURE §8](ARCHITECTURE.md#8-customer-accounts-commission-staff-audit) · [HISTORY](HISTORY.md#accounts-commission) |
| `/api/v1/admin` | `adminRoutes.js` | admin views (catch-all); `POST /users/:id/totp/reset` admin + CSRF (never self; a staff target needs the acting admin's `{ password }`, else 400 `reason: password_required` / 403); `POST /users/:id/new-password` admin + CSRF (placeholder-address, non-staff logins only, else 409; answers once, `no-store`); `PATCH /users/:id/expiry` admin + CSRF `{ expires_at }` — ISO date-time with `Z`/±hh:mm, `YYYY-MM-DD` (end of day UTC) or `null`; future only, never self (400), never an account with admin powers (409 `reason: admin_account`; clearing is allowed); reviving an already-expired login revokes its MCP tokens first | [HISTORY](HISTORY.md#harvest-ice-a-2026-09-24) · [HISTORY](history.d/2026-09-26-feat-login-expiry.md#login-expiry-2026-09-26) |
| `/api/v1/content` | `contentRoutes.js` | public reads; admin writes | — |
| `/api/v1/seller` | `sellerRoutes.js` | GET only; `INSTANCE_ROLE=public` else 404; session; published seller (proven email) else 404; 2FA except `/me` only under `security.mfa.enrolment = required` (mfa-reminder-2026-09-23); per-section view else 403 | [ARCHITECTURE §21](ARCHITECTURE.md#21-seller-area--the-published-copy-on-the-public-instance) · [HISTORY](HISTORY.md#seller-area) |
| `/api/v1/mcp` | `mcpRoutes.js` | `MCP_ENABLED` + bearer token | `docs/mcp.md` |
| `/api/v1/events` | `eventRoutes.js` | public beacon, own limiter | [ARCHITECTURE §13](ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics) · [HISTORY](HISTORY.md#harvest-1) |
| `/api/v1/admin/mcp-tokens` | `mcpAdminRoutes.js` | admin | `docs/mcp.md` |
| `/api/v1/admin/events` | `adminEventRoutes.js` | admin (`requireRole`); `GET /health` = the full readiness report for Admin → Monitoring | [ARCHITECTURE §13](ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics) · [HISTORY](HISTORY.md#harvest-1) |
| `/api/v1/ambience` | `ambienceRoutes.js` | public, always 200 (`{available:false}` on failure) | [ARCHITECTURE §4](ARCHITECTURE.md#4-themes-scenes-ambience) · [HISTORY](HISTORY.md#scene-engine) |
| `/api/v1/news` | `newsRoutes.js` | public reads (hidden surface) | — |
| `/api/v1/party` | `partyRoutes.js` | party module (hidden) | — |
| `/api/v1/shop` | `shopRoutes.js` | public storefront (hidden surface) | — |

Root-level operational routes: `GET /health` (liveness, no DB), `GET /ready`
(DB + breaker + memory, `503` when not ready — anyone gets `status`, `uptime`
and `timestamp`; the `checks` detail only with the `/metrics` credential),
`GET /metrics` (`Authorization: Bearer <METRICS_TOKEN>`; without a token
configured, localhost only in production), `POST /csp-report`.

Root-level discovery routes, all public and cached 10 minutes:
`GET /sitemap.xml` (the advertised surface with `<lastmod>` from
`site_content`), `GET /llms.txt` (the product summary for AI assistants),
`GET /robots.txt`, `GET /manifest.json` — `sitemapRoutes.js`,
`robotsRoutes.js`, `manifestRoutes.js`; [ARCHITECTURE §3](ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo).

---

## Admin setup

After migrating, create the first admin user (writes the row directly with a
scrypt hash — no env values to copy):
```bash
node server/scripts/setup-admin.js <username> <email> <password>
```
