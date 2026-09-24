---
id: mcp-connector
name: {is: MCP-tengill, en: "MCP connector"}
domain: 15
owner: engine
status: live
flag: null
paths:
  - server/routes/mcpRoutes.js
  - server/routes/mcpAdminRoutes.js
  - server/routes/mcpOAuthRoutes.js
  - server/controllers/mcpOAuthController.js
  - server/models/McpOAuth.js
  - public/js/views/ConnectClaudeView.js
  - tests/integration/mcpOAuth.test.js
  - tests/integration/mcpWriteTools.test.js
  - tests/integration/mcpCatalogTools.test.js
  - tests/unit/mcpOAuth.test.js
  - e2e/mcp-oauth.spec.js
  - server/controllers/mcpAdminController.js
  - server/models/McpToken.js
  - server/middleware/mcpAuth.js
  - server/mcp/**
  - public/js/views/AdminMcpSettingsView.js
  - public/js/services/adminMcp.js
  - tests/integration/mcp.test.js
migrations: [088_mcp_tokens, 110_mcp_oauth]
since: 2026-08-22
origin: null
history: [harvest-1, leads, mcp-oauth-2026-09-24, mcp-write-tools-2026-09-24, harvest-ice-a-2026-09-24, harvest-ice-c-2026-09-24]
---

The MCP endpoint (`/api/v1/mcp`, bearer tokens from 088) through which an AI client reads instance state and, later, files feature requests; token management at `/admin/mcp`. Ships dark behind `MCP_ENABLED`.

Demoting, disabling or removing an admin from the admin role revokes their live tokens too (`McpToken.revokeAllForUser`, icelandicstore #418, 2026-09-24).

**Rules**
- MCP arguments pass through `sanitizeBody` and the global IP limit on purpose; the router mounts AFTER the generic admin router.
- No leads tool without a separate sign-off.
- Write tools (R5b, 2026-09-24): `set_update_settings`, `set_module`, `file_feature_request` — scope `write`, so only a write token on a stack whose `MCP_ALLOWED_SCOPES` includes `write` sees them; each goes through the same service as the admin screen (`applyAdminSettings`, `setModuleSwitch`, `ChangeRequest`).
- OAuth 2.1 (R5a, 2026-09-24): claude.ai / Claude Desktop add the connector by URL — dynamic registration, PKCE S256, an admin approves on `/tengja/<id>`; single-use codes and rotated refresh tokens, a replay of either revokes the grant; refresh tokens are never bearer credentials. Every call re-checks that the token's owner is still an admin.
- Full rules: [../docs/ARCHITECTURE.md#15-mcp-connector](../docs/ARCHITECTURE.md#15-mcp-connector).
