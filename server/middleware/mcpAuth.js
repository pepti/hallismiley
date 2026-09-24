// Bearer-only auth for /api/v1/mcp.
//
// This middleware NEVER reads cookies — that absence is the security property
// that lets the MCP router omit csrfProtect: a browser holding a logged-in
// admin's auth_session cookie cannot authenticate here, so there is no
// ambient-credential request for CSRF to forge. (stack-invariants #7: the
// exemption and its reason, in one place.)
//
// 401s carry `WWW-Authenticate: Bearer … resource_metadata="…"` (RFC 9728)
// since R5a (2026-09-24): the protected-resource document it names is served
// by routes/mcpOAuthRoutes.js, so an OAuth-capable client (claude.ai, Claude
// Desktop) discovers the authorization server from the first 401 and runs the
// flow itself. Until then the parameter was withheld on purpose — a discovery
// URL with nothing behind it breaks those clients confusingly.
//
// Accepted credentials: manual tokens (/admin/mcp) and OAuth ACCESS tokens.
// An OAuth REFRESH token is not a bearer credential (McpToken
// .findLiveByPlaintext refuses the kind). The token's owner must still be
// an admin, not disabled (mcp/owner.js) — checked on every call.
const McpToken = require('../models/McpToken');
const { ownerMayUseMcp } = require('../mcp/owner');
const { protectedResourceMetadataUrl } = require('../mcp/oauth');

function unauthorized(req, res) {
  res.set('WWW-Authenticate', `Bearer realm="orangesmiley-mcp", resource_metadata="${protectedResourceMetadataUrl()}"`);
  return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
}

async function mcpAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return unauthorized(req, res);
  const token = header.slice(7).trim();
  try {
    const row = await McpToken.findLiveByPlaintext(token);
    if (!row) return unauthorized(req, res);
    if (!(await ownerMayUseMcp(row.user_id))) return unauthorized(req, res);
    req.mcpToken = row;
    McpToken.touchLastUsed(row.id); // fire-and-forget
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { mcpAuth };
