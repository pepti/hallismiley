# Connecting Claude to Rekstrarkerfið (MCP)

The app exposes an MCP (Model Context Protocol) endpoint so an admin can talk
to a deployment from Claude. Each environment is its own connector — the tools
answer from whichever deployment the token belongs to.

The endpoint is `POST <app-service-hostname>/api/v1/mcp`. This repo has no
deployed instance yet (deploy is dispatch-only, see `docs/DEPLOYMENT.md`), so
there is no hostname to write here — read it off the App Service when one
exists. `environment_info` reports the `app_env` of whatever answered.

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
  reason not to** (write tools are a separate Halli sign-off, ENHANCEMENTS
  #13). v1 ships read-only tools regardless; the ceiling exists so future
  write tools are a per-environment decision, not a deploy.
- Optional: `MCP_TOKEN_TTL_DAYS` (default 90, `mcpAdminController.js`),
  `MCP_RATE_LIMIT_MAX` (default 300 requests / 15 min / token, keyed by token
  id in `mcpRoutes.js`).

## Tokens

Minted on **Stillingar → Claude (MCP)** (`/admin/mcp`) — admin role only,
behind the normal TOTP-protected login (migration `088_mcp_tokens`). The
plaintext (`mcp_…`) is shown exactly once; the instance keeps a sha256 hash.
Because a token bypasses TOTP by design, it expires (90 days default), can be
revoked with one click, and shows its `last used` time on the page.
Revocation is immediate.

## Connecting each client

- **Claude Code** — the create-token panel prints the exact command,
  `claude mcp add --transport http orangesmiley-<env> <endpoint> --header "Authorization: Bearer mcp_…"`
  (the connector name is only the client-side label; it said
  `icelandicstore-<env>` until 2026-09-12).
- **claude.ai / Claude Desktop** — Settings → Connectors → *Add custom
  connector*, URL `<origin>/api/v1/mcp`, nothing else. Since R5a (2026-09-24)
  the instance is its own OAuth 2.1 server: Claude reads the discovery
  documents, registers itself, and opens `/oauth/authorize` in the browser,
  which lands on **`/tengja/<id>`** — sign in as an admin, check that the
  "Sendir þig til baka á" host is `claude.ai` (or `localhost` for Claude
  Code/Desktop), approve. Claude gets an access token (1 hour) and a refresh
  token (30 days, rotated on every use); the connection shows on `/admin/mcp`
  with an OAuth tag, and revoking it there ends both. Write access is granted
  only when Claude asks for it, the admin ticks it AND the stack's
  `MCP_ALLOWED_SCOPES` includes `write`.
- *History:* until R5a custom connectors authenticated via OAuth,
  which was **not built**. The 401s carry a plain `WWW-Authenticate: Bearer`
  and deliberately do NOT advertise an RFC 9728 `resource_metadata` URL
  (`server/middleware/mcpAuth.js:9-11` — advertising discovery with no
  `/.well-known` document behind it would make OAuth clients fail confusingly
  rather than cleanly; realm `orangesmiley-mcp`). Until OAuth lands these clients need a local
  `mcp-remote` bridge that adds the bearer header.

## Tools (v1 — read-only, `server/mcp/tools/system.js`)

Exactly two tools are registered on this instance:

| Tool | Scope | Answers |
|---|---|---|
| `environment_info` | read | `environment` (test/production), `app_url`, the instance name (`Rekstrarkerfið — Orange Smiley ehf.`), row counts for orders/products/users/projects, `server_time`, and `access` = the `MCP_ALLOWED_SCOPES` ceiling verbatim (it says nothing about what THIS token may do) |
| `updates_status` | read | the self-update ledger: mode/channel and the most recent release records with their status (`system_updates`, `docs/SELF-UPDATE.md`) |

Every response carries `_environment` (`server/mcp/envTag.js`). Leads are
deliberately NOT queryable yet — that needs its own sign-off (ENHANCEMENTS
#13 note) — and customer/order/bookkeeping tools wait for a real need. The
icelandicstore connector this was ported from ships fourteen commerce and
finance tools besides `environment_info`; none of them exist here.

## OAuth 2.1 (R5a)

`server/mcp/oauth.js` holds the rules, `controllers/mcpOAuthController.js`
the endpoints, migration `110_mcp_oauth` the clients and requests; tokens
stay in `mcp_tokens` (kind `access`/`refresh`). Public clients only (PKCE
S256, exact redirect URIs, https or loopback http); a replayed code or
refresh token revokes every token that client holds for that admin; a
refresh token is never accepted as a bearer credential. Every MCP call and
token exchange re-checks that the owner is still an admin and not disabled
(`server/mcp/owner.js`) — that applies to manual tokens too. Full rules:
`docs/ARCHITECTURE.md` §15; the story: `docs/HISTORY.md#mcp-oauth-2026-09-24`.

**Rolling back past R5a:** the previous release accepts any live token row as
a bearer (no kind filter, no owner check), so revoke the OAuth tokens first:
`UPDATE mcp_tokens SET revoked_at = NOW() WHERE kind IN ('access','refresh') AND revoked_at IS NULL`.
Redirect hosts: `claude.ai` and `claude.com` by default;
`MCP_OAUTH_REDIRECT_HOSTS` (comma list) replaces them for another client.

## Design notes (for maintainers)

- Transport is hand-rolled stateless Streamable HTTP
  (`server/mcp/transport.js`, protocol rev 2025-06-18): every POST answers
  plain JSON, `GET` is 405, no sessions/SSE. The registry
  (`server/mcp/registry.js`) is SDK-shaped, so moving to
  `@modelcontextprotocol/sdk` later only replaces the transport file.
- Auth (`server/middleware/mcpAuth.js`) is bearer-only and **never reads
  cookies** — that is why the router legitimately omits `csrfProtect`.
- **Mount order (corrected 2026-09-11).** The router is mounted at
  `server/app.js:630`, which is AFTER `app.use(sanitizeBody)` (`:209`) and
  AFTER the global IP limiter (`:266`). Two consequences: tool arguments do
  pass through the body sanitizer (string fields are HTML-stripped), and MCP
  traffic counts against the 2000/15 min global IP limit in addition to the
  router's own token-keyed limiter. The previous text here (and the header
  comment in `mcpRoutes.js`, fixed the same day) claimed the opposite; if
  either consequence ever bites, moving the mount above those two
  middlewares is the fix, and it is a decision, not a doc edit.
- Tool calls are audited via `securityLogger.adminAction` — tool names and
  token ids, never arguments.
- Scope model: tool scope ⊆ token scopes ⊆ `MCP_ALLOWED_SCOPES`, evaluated
  per call, so lowering a stack's ceiling demotes existing tokens instantly.
