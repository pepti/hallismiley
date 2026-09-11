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
`403` party-guest approval pending · `403` party-guest request declined

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

**Response `200 OK`** (not logged in): `{ "authenticated": false }`

Use this on page load to restore session state.

---

### Other `/auth` routes (`server/routes/authRoutes.js`)

| Route | Gate / limiter |
|---|---|
| `POST /auth/signup` | 75 / 10 min per IP, validated body |
| `POST /auth/verify-email` | — |
| `POST /auth/resend-verification` | 5 / minute per IP |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | 25 / hour per IP |
| `POST /auth/totp/setup`, `/totp/confirm`, `/totp/disable` | session + CSRF |
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
view ids in `server/auth/adminViews.js`). Most `/api/v1/admin/*` routers are
mounted before the generic `/api/v1/admin` router, but `mcp-tokens` and
`events` are mounted AFTER it (their inline comments claim otherwise) — it
works today only because `adminRoutes.js` has no handler on those paths.

| Mount | File | Gate | Feature doc |
|---|---|---|---|
| `/auth` | `authRoutes.js` | per route (above) | — |
| `/api/v1/projects` | `projectRoutes.js` | public reads; admin/moderator writes | — |
| `/api/v1/contact` | `contactRoutes.js` | public, 5/h | `docs/SALES-STAFF.md` |
| `/api/v1/users` | `userRoutes.js` | session | — |
| `/api/v1/analytics` | `analyticsRoutes.js` | public beacon | `RUNBOOK.md` (Analytics) |
| `/api/v1/change-requests` | `changeRequestRoutes.js` | `changeRequestGate` (non-prod, or switch on + admin) | — |
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
| `/api/v1/admin/customers` | `adminCustomerRoutes.js` | `customers` view | `docs/SALES-STAFF.md` |
| `/api/v1/admin/customer-notes` | `adminCustomerNotesRoutes.js` | `customers` view | — |
| `/api/v1/admin/bookkeeping` | `adminBookkeepingRoutes.js` (76 routes) | `books`/`invoices`/`expenses`/`ar`/`vat`/`bank`/`ledger`/`payroll`/`pos` views; admin for issuing | `docs/BOOKKEEPING-SYSTEM.md` |
| `/api/v1/admin/handbok` | `salesGuidesRoutes.js` | `handbok` view; admin/moderator edit | `docs/SALES-STAFF.md` |
| `/api/v1/admin/leads` | `leadsRoutes.js` | `leads` view; delete + CSV admin | `docs/SALES-STAFF.md` |
| `/api/v1/admin/markadur` | `marketRoutes.js` | `markadur` view; status PATCH admin/moderator | CLAUDE.md (Markaður) |
| `/api/v1/admin/accounts` | `adminAccountRoutes.js` | `accounts` view + `accountScope` | CLAUDE.md (Customer accounts) |
| `/api/v1/admin/commission` | `adminCommissionRoutes.js` | `commission` view + `commissionScope`; writes admin | CLAUDE.md (migration 102) |
| `/api/v1/admin/audit` | `adminAuditRoutes.js` | admin | CLAUDE.md (staff_audit_log) |
| `/api/v1/admin` | `adminRoutes.js` | admin views (catch-all) | — |
| `/api/v1/content` | `contentRoutes.js` | public reads; admin writes | — |
| `/api/v1/mcp` | `mcpRoutes.js` | `MCP_ENABLED` + bearer token | `docs/mcp.md` |
| `/api/v1/events` | `eventRoutes.js` | public beacon, own limiter | CLAUDE.md (Monitoring) |
| `/api/v1/admin/mcp-tokens` | `mcpAdminRoutes.js` | admin | `docs/mcp.md` |
| `/api/v1/admin/events` | `adminEventRoutes.js` | admin (`requireRole`) | CLAUDE.md (Monitoring) |
| `/api/v1/ambience` | `ambienceRoutes.js` | public, always 200 (`{available:false}` on failure) | CLAUDE.md (scene engine) |
| `/api/v1/news` | `newsRoutes.js` | public reads (hidden surface) | — |
| `/api/v1/party` | `partyRoutes.js` | party module (hidden) | — |
| `/api/v1/shop` | `shopRoutes.js` | public storefront (hidden surface) | — |

Root-level operational routes: `GET /health` (liveness, no DB), `GET /ready`
(DB + breaker + memory, `503` when not ready), `GET /metrics`
(`Authorization: Bearer <METRICS_TOKEN>`), `POST /csp-report`.

---

## Admin setup

After migrating, create the first admin user (writes the row directly with a
scrypt hash — no env values to copy):
```bash
node server/scripts/setup-admin.js <username> <email> <password>
```
