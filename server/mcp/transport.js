// MCP Streamable HTTP transport — hand-rolled, STATELESS, pinned to protocol
// revision 2025-06-18.
//
// Why not @modelcontextprotocol/sdk: read-only tools need no sessions, no
// server-initiated notifications and no SSE, so every POST can answer plain
// JSON (the spec permits application/json instead of an event stream) and GET
// can 405 (permitted for servers that offer no push stream). That sidesteps
// compression buffering, App Service's ~230s response timeout and long-stream
// metrics skew in one move. The registry stays SDK-shaped, so adopting the SDK
// later only replaces this file.
//
// ERROR-ENVELOPE EXEMPTION (stack-invariants #5): MCP clients require JSON-RPC
// 2.0 error objects ({jsonrpc, id, error:{code,message}}), which is
// structurally incompatible with the app-wide {error, code} envelope. This
// module is its own error boundary and never calls next(err) — nothing here
// may reach errorHandler. Same class of documented exemption as the Stripe
// webhook's raw body.
const logger = require('../logger');
const securityLogger = require('../observability/securityLogger');
const registry = require('./registry');

const PROTOCOL_VERSION = '2025-06-18';
// Older revisions we can serve identically (no session, plain JSON responses).
const ACCEPTED_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

function serverInfo() {
  const env = (process.env.APP_ENV || 'production') === 'test' ? 'TEST' : 'PROD';
  return {
    name: `Icelandic Store Wholesale [${env}]`,
    version: process.env.npm_package_version || '1.0.0',
  };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

// One text content block; every tool result is a JSON document.
function toolText(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

async function handleToolsCall(req, params) {
  const name = params && typeof params.name === 'string' ? params.name : '';
  const tool = registry.getTool(name);
  const scopes = req.mcpToken.scopes || [];
  // Unknown and not-permitted are deliberately the same answer: a read-only
  // caller learns nothing about which write tools exist.
  if (!tool || !registry.permitted(tool, scopes)) {
    return { ...toolText({ error: `Unknown tool: ${name}` }), isError: true };
  }
  const args = (params && params.arguments) || {};
  const invalid = registry.validateArgs(tool, args);
  if (invalid) return { ...toolText({ error: invalid }), isError: true };

  // Audit: who ran what, never the arguments (they may carry customer data).
  securityLogger.adminAction(req.mcpToken.user_id, 'mcp_tool_call', name, { tokenId: req.mcpToken.id });

  const started = Date.now();
  try {
    const result = await tool.handler(args);
    logger.info({ tool: name, tokenId: req.mcpToken.id, durationMs: Date.now() - started }, 'mcp.tool_call');
    return toolText(result);
  } catch (err) {
    logger.warn({ tool: name, tokenId: req.mcpToken.id, err: { message: err.message } }, 'mcp.tool_error');
    return { ...toolText({ error: err.message || 'Tool failed' }), isError: true };
  }
}

// The single POST handler. Body is one JSON-RPC message (claude.ai does not
// batch; a batch would be a spec-2025-03 array — answered per-message).
async function handlePost(req, res) {
  const msg = req.body;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return res.status(400).json(rpcError(null, -32700, 'Expected a single JSON-RPC 2.0 message'));
  }

  // Notifications get 202 + no body (spec). The only one we expect is
  // notifications/initialized; others are acknowledged and ignored.
  if (msg.id === undefined || msg.id === null) {
    return res.status(202).end();
  }

  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params && msg.params.protocolVersion;
        const version = ACCEPTED_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION;
        return res.json(rpcResult(msg.id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: serverInfo(),
        }));
      }
      case 'ping':
        return res.json(rpcResult(msg.id, {}));
      case 'tools/list':
        return res.json(rpcResult(msg.id, { tools: registry.listTools(req.mcpToken.scopes) }));
      case 'tools/call':
        return res.json(rpcResult(msg.id, await handleToolsCall(req, msg.params)));
      default:
        return res.json(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  } catch (err) {
    // Own error boundary — see header. Message stays generic: internals belong
    // in the log line, not on the wire.
    logger.error({ err: { message: err.message }, method: msg.method }, 'mcp.transport_error');
    return res.status(200).json(rpcError(msg.id, -32603, 'Internal error'));
  }
}

module.exports = { handlePost, PROTOCOL_VERSION };
