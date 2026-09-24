// OAuth 2.1 for the MCP connector (R5a, 2026-09-24) — discovery, dynamic
// client registration, the authorization + token + revocation endpoints, and
// the admin's consent API. Handlers: controllers/mcpOAuthController.js.
//
// Mounted at '/' in app.js (the paths are fixed by the specs: /.well-known/…,
// and the endpoints the metadata names), so every route carries its own
// gates rather than a router-wide `use` that would touch the whole site:
//   • `mcpOn` — the whole flow is part of the connector and is as dark as it
//     is: MCP_ENABLED unset → 404, like /api/v1/mcp itself;
//   • the machine endpoints (register, token, revoke) take no cookies — the
//     same property that exempts /api/v1/mcp from csrfProtect (a browser's
//     ambient session proves nothing here; PKCE, the exact redirect URI and
//     the tokens themselves do). Each has its own IP limiter;
//   • /oauth/authorize is a plain browser GET that only validates and
//     redirects — it creates a PENDING request and nothing else;
//   • the consent API under /api/v1/oauth/requests is the normal admin stack:
//     session auth, `admin` role, CSRF on the two writes. Only an admin can
//     turn a pending request into a code.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const ctrl = require('../controllers/mcpOAuthController');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');

function mcpOn(req, res, next) {
  if (process.env.MCP_ENABLED !== 'true') return res.status(404).json({ error: 'Not found', code: 404 });
  return next();
}

const isTest = () => process.env.NODE_ENV === 'test';
// Machine endpoints answer in the OAuth error shape; the browser route in the
// app's own envelope.
const limiter = (max, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTest,
  message,
});
const OAUTH_BUSY = { error: 'temporarily_unavailable', error_description: 'Too many requests' };
const registerLimiter  = limiter(20, OAUTH_BUSY);
const authorizeLimiter = limiter(60, { error: 'Too many requests', code: 429 });
const tokenLimiter     = limiter(120, OAUTH_BUSY);

// RFC 6749 token and RFC 7009 revocation requests are form-encoded; the app's
// global parser is JSON only. Small: a token request is a handful of fields.
const form = express.urlencoded({ extended: false, limit: '8kb' });

// ── Discovery ────────────────────────────────────────────────────────────────
// RFC 9728 lets a client ask at the root or with the resource path appended.
router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp'],
  mcpOn, ctrl.protectedResource);
router.get('/.well-known/oauth-authorization-server', mcpOn, ctrl.authorizationServer);

// ── Machine endpoints ────────────────────────────────────────────────────────
router.post('/oauth/register', mcpOn, registerLimiter, ctrl.register);
router.post('/oauth/token',    mcpOn, tokenLimiter, form, ctrl.token);
router.post('/oauth/revoke',   mcpOn, tokenLimiter, form, ctrl.revoke);

// ── Browser: the authorization request → the consent page ───────────────────
router.get('/oauth/authorize', mcpOn, authorizeLimiter, ctrl.authorize);

// ── Consent API (the SPA's /tengja/<id>) ─────────────────────────────────────
const admin = [mcpOn, requireAuth, requireRole('admin')];
router.get('/api/v1/oauth/requests/:id',          ...admin, ctrl.getRequest);
router.post('/api/v1/oauth/requests/:id/approve', ...admin, csrfProtect, ctrl.approve);
router.post('/api/v1/oauth/requests/:id/deny',    ...admin, csrfProtect, ctrl.deny);

module.exports = router;
