# Connecting Claude to the store (MCP)

The app exposes an MCP (Model Context Protocol) endpoint so the store admin
can talk to a deployment from Claude: *"what were yesterday's orders?"*,
*"what's low on stock?"*, *"who owes money?"*. Each environment is its own
connector — the tools answer from whichever deployment the token belongs to.

| | Endpoint |
|---|---|
| TEST | `https://icelandicstore-test-web.azurewebsites.net/api/v1/mcp` |
| PROD | `https://wholesale.icelandicstore.is/api/v1/mcp` (post-cutover; App Service hostname before) |

**Always start a session by calling `environment_info`** — it answers
`test` or `production`, and the server name shows `[TEST]`/`[PROD]` in the
client UI. Two connectors, identical tool names: the tag is how you avoid
asking PROD a TEST question.

## Enabling

Dark by default. Per stack (App Service settings):

- `MCP_ENABLED=true` — without it the endpoint answers 404.
- `MCP_ALLOWED_SCOPES` — the environment's access ceiling: `read` (default
  when unset) or `read,write`. PROD should stay `read` until there is a
  reason not to. v1 ships read-only tools regardless; the ceiling exists so
  future write tools are a per-environment decision, not a deploy.
- Optional: `MCP_TOKEN_TTL_DAYS` (default 90), `MCP_RATE_LIMIT_MAX`
  (default 300 requests / 15 min / token).

## Tokens

Minted on **Stillingar → Claude (MCP)** (`/admin/mcp`) — admin role only,
behind the normal TOTP-protected login. The plaintext (`mcp_…`) is shown
exactly once; the store keeps a sha256 hash. Because a token bypasses TOTP
by design, it expires (90 days default), can be revoked with one click, and
shows its `last used` time on the page. Revocation is immediate.

## Connecting each client

- **Claude Code** — the create-token panel prints the exact command:
  `claude mcp add --transport http icelandicstore-test <endpoint> --header "Authorization: Bearer mcp_…"`
- **claude.ai / Claude Desktop** — custom connectors authenticate via OAuth,
  which lands in PR 2 (the endpoint already advertises the discovery URL in
  its 401s). Until then these clients need a local `mcp-remote` bridge with
  the bearer header; after PR 2 they connect natively: add the endpoint URL,
  the browser opens the store login, sign in as admin, approve.

## Tools (v1 — read-only)

`environment_info` · `sales_report` · `order_metrics` · `list_orders` ·
`get_order` · `inventory_watch` · `reorder_suggestions` · `list_products` ·
`ar_aging` · `company_statement` · `invoice_overview` · `vat_report` ·
`financial_statements` · `list_customers` · `get_customer`

Every response carries `_environment`. Bookkeeping figures are the in-app
parallel-run preview — Regla remains the accounting system of record.

## Design notes (for maintainers)

- Transport is hand-rolled stateless Streamable HTTP
  (`server/mcp/transport.js`, protocol rev 2025-06-18): every POST answers
  plain JSON, `GET` is 405, no sessions/SSE. The registry
  (`server/mcp/registry.js`) is SDK-shaped, so moving to
  `@modelcontextprotocol/sdk` later only replaces the transport file.
- Auth (`server/middleware/mcpAuth.js`) is bearer-only and **never reads
  cookies** — that is why the router legitimately omits `csrfProtect`.
- The mount in `app.js` sits deliberately before `sanitizeBody` (would
  corrupt tool arguments) and before the global IP rate limiter (claude.ai
  funnels traffic through few egress IPs); the router carries its own
  token-keyed limiter instead.
- Tool calls are audited via `securityLogger.adminAction` — tool names and
  token ids, never arguments.
- Scope model: tool scope ⊆ token scopes ⊆ `MCP_ALLOWED_SCOPES`, evaluated
  per call, so lowering a stack's ceiling demotes existing tokens instantly.
