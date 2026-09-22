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
  - server/controllers/mcpAdminController.js
  - server/models/McpToken.js
  - server/middleware/mcpAuth.js
  - server/mcp/**
  - public/js/views/AdminMcpSettingsView.js
  - public/js/services/adminMcp.js
  - tests/integration/mcp.test.js
migrations: [088_mcp_tokens]
since: 2026-08-22
origin: null
history: [harvest-1, leads]
---

The MCP endpoint (`/api/v1/mcp`, bearer tokens from 088) through which an AI client reads instance state and, later, files feature requests; token management at `/admin/mcp`. Ships dark behind `MCP_ENABLED`.

**Rules**
- MCP arguments pass through `sanitizeBody` and the global IP limit on purpose; the router mounts AFTER the generic admin router.
- No leads tool without a separate sign-off.
- Full rules: [../docs/ARCHITECTURE.md#15-mcp-connector](../docs/ARCHITECTURE.md#15-mcp-connector).
