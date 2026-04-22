# API Reference

Base URL: `https://www.hallismiley.is`

All API endpoints are under `/api/v1/`. Authenticated endpoints require a valid session cookie (`auth_session`) obtained via `POST /auth/login`.

---

## Authentication

Authentication uses Lucia v3 session-based cookies. The `auth_session` httpOnly cookie is set by the server on login and cleared on logout — the browser handles it automatically. No tokens are stored in the frontend.

### POST /auth/login

Authenticate as admin and start a session.

**Rate limit:** 10 requests / 15 min per IP.

**Request body:**
```json
{ "username": "string", "password": "string" }
```

**Response `200 OK`:**
```json
{
  "user": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```
Sets an `httpOnly`, `SameSite=Strict` `auth_session` cookie.

**Errors:** `400` missing fields · `401` invalid credentials · `401` account temporarily locked (after 5 failed attempts)

---

### POST /auth/logout

Invalidate the current session and clear the cookie.

**Request:** No body. Session is read from the `auth_session` httpOnly cookie.

**Response:** `204 No Content`

Safe to call when not logged in (idempotent).

---

### GET /auth/session

Return the current session/user info without requiring auth.

**Request:** No body. Session is read from the `auth_session` httpOnly cookie.

**Response `200 OK`** (logged in):
```json
{
  "authenticated": true,
  "user": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

**Response `200 OK`** (not logged in):
```json
{ "authenticated": false }
```

Use this on page load to restore session state.

---

## Projects

### GET /api/v1/projects

List all projects. Supports filtering and pagination.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | `carpentry` \| `tech` | — | Filter by category |
| `featured` | `true` \| `false` | — | Filter by featured status |
| `year` | integer 1900–2100 | — | Filter by year |
| `limit` | integer 1–100 | `20` | Max results per page |
| `offset` | integer ≥ 0 | `0` | Number of results to skip |

**Response `200 OK`:** Array of project objects.
```json
[
  {
    "id": 1,
    "title": "Timber Frame Barn",
    "description": "Hand-cut mortise and tenon joinery...",
    "category": "carpentry",
    "year": 2023,
    "tools_used": ["Timber framing", "Hand tools"],
    "image_url": "https://example.com/img.jpg",
    "featured": true,
    "created_at": "2026-01-15T10:00:00Z",
    "updated_at": "2026-01-15T10:00:00Z"
  }
]
```

**Errors:** `400` invalid query params

---

### GET /api/v1/projects/featured

Return all featured projects.

**Cache:** `public, max-age=300, stale-while-revalidate=60`

**Response `200 OK`:** Array of featured project objects (same shape as above).

---

### GET /api/v1/projects/:id

Return a single project by ID.

**Response `200 OK`:** Single project object.

**Errors:** `404` not found

---

### POST /api/v1/projects

Create a new project. **Requires auth.**

**Rate limit:** 30 write requests / 15 min per IP.

**Request body:**
```json
{
  "title": "string (max 200)",
  "description": "string (max 2000)",
  "category": "carpentry | tech",
  "year": 2024,
  "tools_used": ["string (max 100 each, max 50 items)"],
  "image_url": "https://...",
  "featured": false
}
```
`title`, `description`, `category`, and `year` are required. All other fields are optional.

**Response `201 Created`:** Created project object.

**Errors:** `400` validation failure · `401` no valid session

---

### PUT /api/v1/projects/:id

Replace a project. **Requires auth.** Same body shape as POST (all fields required).

**Response `200 OK`:** Updated project object.

**Errors:** `400` validation · `401` auth · `404` not found

---

### PATCH /api/v1/projects/:id

Partially update a project. **Requires auth.** Send only the fields to change.

**Response `200 OK`:** Updated project object.

**Errors:** `400` validation · `401` auth · `404` not found

---

### DELETE /api/v1/projects/:id

Delete a project. **Requires auth.**

**Response:** `204 No Content`

**Errors:** `401` auth · `404` not found

---

## Contact

### POST /api/v1/contact

Submit a contact form message.

**Request body:**
```json
{ "name": "string", "email": "string", "message": "string" }
```

**Response `200 OK`:** `{ "ok": true }`

**Errors:** `400` validation failure

---

## Error Format

All errors return JSON:
```json
{ "error": "Human-readable message", "code": 400 }
```

## Rate Limits

| Scope | Limit |
|-------|-------|
| Global (all endpoints) | 200 req / 15 min |
| Auth login | 10 req / 15 min |
| Project writes (POST/PUT/PATCH/DELETE) | 30 req / 15 min |

Rate limit responses use HTTP `429` with standard `RateLimit-*` headers.

## Admin Setup

After deploying and running migrations, create the first admin user:
```bash
node server/scripts/setup-admin.js <username> <email> <password>
```
