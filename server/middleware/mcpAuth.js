// Bearer-only auth for /api/v1/mcp.
//
// This middleware NEVER reads cookies — that absence is the security property
// that lets the MCP router omit csrfProtect: a browser holding a logged-in
// admin's auth_session cookie cannot authenticate here, so there is no
// ambient-credential request for CSRF to forge. (stack-invariants #7: the
// exemption and its reason, in one place.)
//
// 401s carry a plain `WWW-Authenticate: Bearer`. They deliberately do NOT yet
// carry the RFC 9728 `resource_metadata` parameter: this PR serves no
// /.well-known/oauth-protected-resource document, and advertising a discovery
// URL that the SPA catch-all answers with 200 text/html sends OAuth-capable
// clients (claude.ai, Desktop) into a broken authorization flow instead of a
// clean failure. PR 2 adds the metadata endpoint and the parameter together.
const McpToken = require('../models/McpToken');

function unauthorized(req, res) {
  res.set('WWW-Authenticate', 'Bearer realm="icelandicstore-mcp"');
  return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
}

async function mcpAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return unauthorized(req, res);
  const token = header.slice(7).trim();
  try {
    const row = await McpToken.findLiveByPlaintext(token);
    if (!row) return unauthorized(req, res);
    req.mcpToken = row;
    McpToken.touchLastUsed(row.id); // fire-and-forget
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { mcpAuth };
