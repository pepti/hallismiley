# API Reference — public + auth surface

Base URL: `https://www.hallismiley.is` (in production `server/app.js` 301s every
other host to the host part of `APP_URL`).

This document covers the **public and authentication** endpoints in detail and
ends with an **inventory of every mounted router** so the admin surface is at
least findable. The admin API (28 router mounts in `server/app.js`; 298 route declarations across
`server/routes/*.js`, 68 of them the books, 58 the party module — counted 2026-09-12 by summing
`grep -cE '^\s*router\.(get|post|put|patch|delete)\('` over `server/routes/*.js`)
is documented by its route files and the feature docs they point at, not here.
Read 2026-09-12 against `server/app.js` and `server/routes/`; the previous
version dated from 2026-04-22.

Auth endpoints are mounted at `/auth`; everything else is under `/api/v1/`.
Authenticated endpoints require a valid session cookie (`auth_session`)
obtained via `POST /auth/login`.

---

## Authentication

Authentication uses Lucia v3 session-based cookies (one auth system — there is
no JWT layer). The `auth_session` httpOnly, `SameSite=Strict` cookie is set by
the server on login and cleared on logout — the browser handles it
automatically. No tokens are stored in the frontend.

### CSRF — required on every session-authenticated write

Every session-authenticated write route that changes state (POST/PUT/PATCH/DELETE,
including `POST /auth/logout`) carries `csrfProtect` (`server/middleware/csrf.js`).
Three session-gated POSTs omit it BY DESIGN because they write nothing —
`/api/v1/admin/customers/import/preview`, `/api/v1/admin/customers/send-invites/render`
and `/api/v1/admin/shop/products/import/preview` (each says so in its route
comment). Fetch a token first and send it back as the `X-CSRF-Token` header:

```
GET /api/v1/csrf-token            →  200 { "token": "…" }
```

The token is bound to a `SameSite=Strict` cookie (`secure` in production). A
missing or stale token answers `403` in the standard error envelope. Routes
that deliberately omit `csrfProtect`: the bearer-only MCP endpoint
(`docs/mcp.md`), the anonymous contact form, the analytics beacon and the client
error beacon (`POST /api/v1/events`), the Stripe webhook (signature-verified
instead), and the read-only routers.

### POST /auth/login

Authenticate and start a session (or a 2FA challenge).

**Rate limit:** 10 requests / 15 min per IP — the same bucket also covers
`/auth/login/totp` and the four OAuth routes.

**Request body:**
```json
{ "username": "string", "password": "string" }
```

**Response `200 OK`** — password accepted, no 2FA on the account:
```json
{ "user": { "id": "uuid", "username": "admin", "email": "admin@example.com", "role": "admin" } }
```
Sets the `auth_session` cookie.

**Response `200 OK`** — password accepted, account is 2FA-protected (admins;
`mfaService.isProtected`):
```json
{ "mfaRequired": true, "challengeId": "uuid", "expiresInMs": 300000 }
```
No cookie is set on this branch. Complete the login with
`POST /auth/login/totp` `{ "challengeId": "…", "code": "123456" }`, which sets
the cookie and answers `{ "usedRecoveryCode": false, "recoveryCodesRemaining": n, "user": { … } }`.

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

### Other `/auth` routes (`server/routes/authRoutes.js`, limits read 2026-09-12)

| Route | Gate / limiter |
|---|---|
| `POST /auth/signup` | 15 / 10 min per IP, validated body |
| `POST /auth/verify-email` | — |
| `POST /auth/resend-verification` | 1 / minute per IP |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | 5 / hour per IP |
| `POST /auth/totp/setup`, `/totp/confirm`, `/totp/disable` | session + CSRF |
| `GET /auth/check-username/:username`, `GET /auth/check-email/:email` | 30 / hour per IP |
| `POST /auth/party-magic-login` | 10 / 15 min per IP (party module) |
| `GET /auth/google`, `/google/callback`, `/facebook`, `/facebook/callback` | `socialLoginGate` — answer `404` unless `SOCIAL_LOGIN_ENABLED=true`; then the login limiter |

---

## Projects

### GET /api/v1/projects

List all projects. Supports filtering and pagination.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | `carpentry` \| `tech` | — | Filter by category |
| `featured` | `true` \| `false` | — | Filter by featured status |
| `year` | integer 1900–2100 | — | Filter by year |
| `limit` | integer 1–100 | `20` | Max results per page |
| `offset` | integer 0–1 000 000 | `0` | Number of results to skip |

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
`/:id/videos`, plus their admin writes, `PATCH /:id/cover` and three
`…/reorder` endpoints (25 routes in `projectRoutes.js`).

### POST /api/v1/projects

Create a project. **Requires a session with role `admin` or `moderator`, plus
`X-CSRF-Token`.**

**Rate limit:** 90 write requests / 15 min per IP (the write limiter; see below).

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

## Contact

### POST /api/v1/contact

Submit a contact form message. **In this repo the handler is a stub**: it
validates, records a no-PII analytics event and logs a correlation id — it
delivers nothing anywhere (`server/controllers/contactController.js` — its header
says so since 2026-09-12; it also still uses `console.log`, against invariant 6).
Instances that need a real inbox implement it themselves (orangesmiley stores
leads and e-mails them).

**Rate limit:** 10 / hour per IP (`contactRoutes.js`).

```json
{ "name": "≤100", "email": "≤200", "message": "10–2000 chars", "topic": "optional", "website": "honeypot — leave empty" }
```

**Response `200 OK`:** `{ "message": "<localised confirmation>" }` (a filled
honeypot also answers 200 and is silently discarded).

**Errors:** `400 { "errors": ["<localised message>", …] }` — **the one endpoint
that does not use the standard envelope**; it returns the full list of
validation failures as an array.

---

## Error format

Every other error returns the envelope from `server/middleware/errorHandler.js`:
```json
{ "error": "Human-readable message", "code": 400 }
```

## Rate limits (`express-rate-limit`)

Skip rules differ by file, and the difference matters when developing locally: the app-level limiters in `server/app.js` (global, writes) and the shop/events/change-request/analytics ones skip when `NODE_ENV` is `test` **or** `development`; the auth (`authRoutes.js`), MCP (`mcpRoutes.js`), party (`partyRoutes.js`) and contact (`contactRoutes.js`) limiters skip under `test` **only**, so a dev server enforces them.

| Scope | Limit | Where |
|-------|-------|-------|
| Global (all endpoints; static-asset GETs exempt) | 400 / 15 min per IP | `server/app.js` |
| Writes (POST/PUT/PATCH/DELETE on `/api/v1/projects`, `/api/v1/party`, `/api/v1/admin/shop`, `/api/v1/admin/bins`, `/api/v1/admin/bookkeeping`) | 90 / 15 min per IP | `server/app.js` |
| Auth login (+ TOTP step + OAuth routes) | 10 / 15 min per IP | `authRoutes.js` |
| Signup | 15 / 10 min per IP | `authRoutes.js` |
| Password reset (forgot + reset) | 5 / hour per IP | `authRoutes.js` |
| Resend verification | 1 / minute per IP | `authRoutes.js` |
| Username/email availability checks | 30 / hour per IP | `authRoutes.js` |
| Contact | 10 / hour per IP | `contactRoutes.js` |
| Party: access request / approval action / e-mail blast / uploads | 5 per h · 20 per h · 10 per h · 1000 / 15 min per IP | `partyRoutes.js` |
| Shop: checkout / discount lookup | 10 / 15 min · 30 / 15 min per IP | `shopRoutes.js` |
| Client error beacon (`POST /api/v1/events`) | 20 / minute per IP | `eventRoutes.js` |
| MCP pre-auth (per IP, before the bearer is checked) | 60 / 15 min | `mcpRoutes.js` |
| Books PDF/CSV/document downloads (12 GETs) | `docLimiter` — 60 / 15 min per IP | `server/middleware/booksLimiters.js` |
| MCP (per token) | 300 / 15 min (`MCP_RATE_LIMIT_MAX`) | `mcpRoutes.js` |
| Self-update apply/rollback | 10 / 15 min | `systemRoutes.js` |

Rate-limit responses use HTTP `429` with standard `RateLimit-*` headers.

---

## Router inventory (`server/app.js` mounts, in mount order, read 2026-09-12)

Gates are the router's own (`requireAuth`, `requireRole`, `requireView(id)` —
view ids in `server/auth/adminViews.js`). Most `/api/v1/admin/*` routers are
mounted before the generic `/api/v1/admin` router; `mcp-tokens` and `events`
are mounted after it (their inline comments claim otherwise) — it works only
because `adminRoutes.js` has no handler on those paths.

| Mount | File | Gate | Feature doc |
|---|---|---|---|
| `/auth` | `authRoutes.js` | per route (above) | — |
| `/api/v1/projects` | `projectRoutes.js` | public reads; admin/moderator writes | — |
| `/api/v1/contact` | `contactRoutes.js` | public, 10/h (stub) | — |
| `/api/v1/users` | `userRoutes.js` | session | — |
| `/api/v1/analytics` | `analyticsRoutes.js` | public beacon | `RUNBOOK.md` (Analytics) |
| `/api/v1/change-requests` | `changeRequestRoutes.js` | `changeRequestGate` (TEST stacks) | — |
| `/api/v1/admin/shop` | `adminShopRoutes.js` | `products` / `collections` / `orders` / `sales` views per sub-path | — |
| `/api/v1/admin/analytics` | `analyticsAdminRoutes.js` | `analytics` view | — |
| `/api/v1/admin/general-settings` | `adminGeneralSettingsRoutes.js` | `general` view | — |
| `/api/v1/admin/discounts` | `adminDiscountRoutes.js` | `discounts` view | — |
| `/api/v1/admin/background` | `adminBackgroundRoutes.js` | `background` view | — |
| `/api/v1/admin/change-requests` | `adminChangeRequestRoutes.js` | `feedback` view | — |
| `/api/v1/admin/nav-config` | `adminNavRoutes.js` | admin (`requireRole`) | — |
| `/api/v1/admin/roles` | `adminRolesRoutes.js` | admin | — |
| `/api/v1/admin/bins` | `adminBinsRoutes.js` | `bins` view | — |
| `/api/v1/admin/customers` | `adminCustomerRoutes.js` | `customers` view | — |
| `/api/v1/admin/customer-notes` | `adminCustomerNotesRoutes.js` | `customers` view | — |
| `/api/v1/admin/bookkeeping` | `adminBookkeepingRoutes.js` (68 routes) | `books`/`invoices`/`expenses`/`ar`/`vat`/`bank`/`ledger`/`payroll`/`pos` views for reads; **admin for every write** (the one non-admin POST, `/expenses/preview-vat`, posts nothing) | `docs/BOOKKEEPING-SYSTEM.md` |
| `/api/v1/admin` | `adminRoutes.js` | admin views (catch-all) | — |
| `/api/v1/content` | `contentRoutes.js` | public reads; admin/moderator writes | — |
| `/api/v1/mcp` | `mcpRoutes.js` | `MCP_ENABLED` + bearer token | `docs/mcp.md` |
| `/api/v1/events` | `eventRoutes.js` | public beacon, own limiter | RUNBOOK (Event log) |
| `/api/v1/admin/mcp-tokens` | `mcpAdminRoutes.js` | admin | `docs/mcp.md` |
| `/api/v1/admin/events` | `adminEventRoutes.js` | admin | RUNBOOK (Event log) |
| `/api/v1/news` | `newsRoutes.js` | public reads; admin/moderator writes | — |
| `/api/v1/party` | `partyRoutes.js` (58 routes) | party module | — |
| `/api/v1/shop` | `shopRoutes.js` | public storefront; Stripe checkout | `docs/SHOP_REDESIGN.md` |
| `/api/v1/system` | `systemRoutes.js` | `/version` and `/updates` = `updates` view; writes admin + CSRF; **the whole router answers 404 while `modules.selfUpdate.enabled` is off — which it is here** | `docs/SELF-UPDATE.md` |

Root-level routes outside the routers: `GET /health` (liveness, no DB),
`GET /ready` (DB + pool + breaker; `503` when not ready), `GET /metrics`
(`Authorization: Bearer <METRICS_TOKEN>`; localhost-only in production when
unset), `POST /csp-report`, `POST /api/v1/shop/webhook` (Stripe, raw body,
signature-verified), `GET /api/v1/csrf-token`, the sitemap and IndexNow key
routes, and the SPA catch-all.

---

## Admin setup

After migrating, create the first admin user (writes the row directly with a
Scrypt hash — no env values to copy):
```bash
node server/scripts/setup-admin.js <username> <email> <password>
```
