# Connecting Claude to this site (MCP)

The engine exposes an MCP (Model Context Protocol) endpoint so an admin can talk
to a deployment from Claude. Each deployment is its own connector — the tools
answer from whichever deployment the token belongs to. This file describes the
BASE's own connector; instances scaffolded from here carry their own copy.

The endpoint is `POST https://www.hallismiley.is/api/v1/mcp` **when enabled**.
On the live site it is dark: `MCP_ENABLED` is unset (read 2026-09-12) and the
route answers 404 before auth. Enabling it is an App Service settings change
(and a restart), Halli's act.

**Always start a session by calling `environment_info`** — it answers
`test` or `production`, and the server name shows `[TEST]`/`[PROD]` in the
client UI. Two connectors, identical tool names: the tag is how you avoid
asking PROD a TEST question.

## Enabling

Dark by default. Per stack (App Service settings — `server/routes/mcpRoutes.js`
and `server/mcp/registry.js` read them):

- `MCP_ENABLED=true` — without it the endpoint answers 404 before auth.
- `MCP_ALLOWED_SCOPES` — the environment's access ceiling: `read` (default
  when unset) or `read,write`. **Production stays `read` until there is a
  reason not to.** v1 ships read-only tools regardless; the ceiling exists so
  future write tools are a per-environment decision, not a deploy.
- Optional: `MCP_TOKEN_TTL_DAYS` (default 90, `mcpAdminController.js`),
  `MCP_RATE_LIMIT_MAX` (default 300 requests / 15 min / token, keyed by token
  id in `mcpRoutes.js`).

## Tokens

Minted on **Settings → Claude (MCP)** (`/admin/mcp`) — admin role only, behind
the normal TOTP-protected login (migration `084_mcp_tokens`). The plaintext
(`mcp_…`) is shown exactly once; the instance keeps a sha256 hash. Because a
token bypasses TOTP by design, it expires (90 days default), can be revoked
with one click, and shows its `last used` time on the page. Revocation is
immediate.

## Connecting each client

- **Claude Code** — the create-token panel prints the exact command,
  `claude mcp add --transport http hallismiley-<env> <endpoint> --header "Authorization: Bearer mcp_…"`.
  The connector name is only the local client-side alias (it said
  `icelandicstore-<env>` until 2026-09-12 — ported verbatim from the instance
  the connector came from).
- **claude.ai / Claude Desktop** — custom connectors authenticate via OAuth,
  which is **not built**. The 401s carry a plain `WWW-Authenticate: Bearer
  realm="hallismiley-mcp"` and deliberately do NOT advertise an RFC 9728
  `resource_metadata` URL (`server/middleware/mcpAuth.js` — advertising discovery
  with no `/.well-known` document behind it would make OAuth clients fail
  confusingly rather than cleanly). The realm is a label on a 401, not a
  credential. Until OAuth lands these clients need a local `mcp-remote` bridge
  that adds the bearer header. Migration 084 already carries the
  `kind`/`oauth_client_id`/`parent_id` columns for that phase.

## Tools (v1 — read-only, `server/mcp/tools/system.js`)

Exactly two tools are registered — and `tests/integration/mcp.test.js` asserts
the list is exactly these two, so adding one means widening that test:

| Tool | Scope | Answers |
|---|---|---|
| `environment_info` | read | `environment` (test/production), `app_url`, the instance name (`Halli Smiley (base engine)`), row counts for orders/products/users/projects, `server_time`, and `access` = the `MCP_ALLOWED_SCOPES` ceiling verbatim (it says nothing about what THIS token may do) |
| `updates_status` | read | the self-update ledger: mode/channel and the most recent release records with their status (`system_updates`, `docs/SELF-UPDATE.md`) |

Every response carries `_environment` (`server/mcp/envTag.js`). Order, stock,
customer and bookkeeping tools were deliberately left out of v1 (the header of
`system.js` says so); the icelandicstore connector this was ported from ships
fourteen such tools, and none of them exist here.

## Design notes (for maintainers)

- Transport is hand-rolled stateless Streamable HTTP
  (`server/mcp/transport.js`, protocol rev 2025-06-18): every POST answers
  plain JSON, `GET` is 405, no sessions/SSE. The registry
  (`server/mcp/registry.js`) is SDK-shaped, so moving to
  `@modelcontextprotocol/sdk` later only replaces the transport file.
- Auth (`server/middleware/mcpAuth.js`) is bearer-only and **never reads
  cookies** — that is why the router legitimately omits `csrfProtect`.
- **Mount order (corrected 2026-09-12).** The router is mounted near the end
  of `server/app.js`, AFTER `app.use(sanitizeBody)`, AFTER the global IP limiter
  and AFTER the production HTTP→HTTPS redirect. Consequences: tool arguments
  pass through the body sanitizer (string fields are tag-stripped), and MCP
  traffic counts against the 400/15 min global IP limit in addition to the
  router's own token-keyed limiter; the router's own TLS guard is a second
  line behind the app-wide redirect. The previous text here (and the header
  comment in `mcpRoutes.js`, fixed the same day) claimed the opposite. **Do
  not "fix" this by moving the mount up** — that would take the redirect and
  the IP limiter out from in front of it and needs its own security review.
- Tool calls are audited via `securityLogger.adminAction` — tool names and
  token ids, never arguments.
- Scope model: tool scope ⊆ token scopes ⊆ `MCP_ALLOWED_SCOPES`, evaluated
  per call, so lowering a stack's ceiling demotes existing tokens instantly.
