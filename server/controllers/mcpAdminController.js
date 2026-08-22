// Admin management of MCP connection tokens (/api/v1/admin/mcp-tokens).
// Minting happens HERE — behind the normal admin session (which is TOTP-
// protected) — never on the MCP endpoint itself. The mint response is the only
// place the plaintext token ever exists.
const McpToken = require('../models/McpToken');
const securityLogger = require('../observability/securityLogger');
const { allowedScopes } = require('../mcp/registry');
const { t } = require('../i18n');

function mcpEnabled() {
  return process.env.MCP_ENABLED === 'true';
}

const mcpAdminController = {
  // GET / — token list + the environment's config so the UI can explain itself.
  async list(req, res, next) {
    try {
      const tokens = await McpToken.listAll();
      return res.json({
        enabled: mcpEnabled(),
        allowed_scopes: allowedScopes(),
        app_env: (process.env.APP_ENV || 'production') === 'test' ? 'test' : 'production',
        tokens,
      });
    } catch (err) { return next(err); }
  },

  // POST / { name, scopes?, ttl_days? } → { token (plaintext, once), row }
  async create(req, res, next) {
    try {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: t(req.locale, 'errors.mcp.nameRequired'), code: 400 });
      }
      const ceiling = allowedScopes();
      const wantsWrite = req.body.scopes === 'read,write' || (Array.isArray(req.body.scopes) && req.body.scopes.includes('write'));
      if (wantsWrite && !ceiling.includes('write')) {
        return res.status(400).json({ error: t(req.locale, 'errors.mcp.writeNotAllowed'), code: 400 });
      }
      const scopes = wantsWrite ? ['read', 'write'] : ['read'];
      const ttlDays = Number(req.body.ttl_days) || Number(process.env.MCP_TOKEN_TTL_DAYS) || 90;
      const { token, row } = await McpToken.create({ userId: req.user.id, name, scopes, ttlDays });
      securityLogger.adminAction(req.user.id, 'mcp_token_created', String(row.id), { name, scopes });
      return res.status(201).json({ token, row });
    } catch (err) { return next(err); }
  },

  // POST /:id/revoke
  async revoke(req, res, next) {
    try {
      const row = await McpToken.revoke(req.params.id);
      if (!row) {
        return res.status(404).json({ error: t(req.locale, 'errors.mcp.tokenNotFound'), code: 404 });
      }
      securityLogger.adminAction(req.user.id, 'mcp_token_revoked', String(row.id), { name: row.name });
      return res.json({ row });
    } catch (err) { return next(err); }
  },
};

module.exports = mcpAdminController;
