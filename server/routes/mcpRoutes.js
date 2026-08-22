// MCP endpoint — POST /api/v1/mcp (Streamable HTTP, stateless; see
// server/mcp/transport.js).
//
// Mounted in app.js BEFORE sanitizeBody and BEFORE the global IP rate limiter
// (reasons documented at the mount), so this router carries its own:
//   • feature gate (MCP_ENABLED — dark by default, per-stack opt-in),
//   • pre-auth IP limiter (deters token guessing),
//   • bearer-only auth (middleware/mcpAuth.js — never reads cookies, which is
//     why there is deliberately NO csrfProtect here; stack-invariants #7),
//   • post-auth TOKEN-keyed limiter (claude.ai funnels many users' traffic
//     through few egress IPs — IP keying would starve legitimate sessions),
//   • the DB circuit breaker (the global mount at app.js covers /api/v1 later
//     in the file, but this router registers earlier; self-contained is
//     order-proof).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();

const { mcpAuth } = require('../middleware/mcpAuth');
const { dbCircuitBreakerMiddleware } = require('../observability/circuitBreaker');
const transport = require('../mcp/transport');

const isTest = () => process.env.NODE_ENV === 'test';

function mcpEnabled() {
  return process.env.MCP_ENABLED === 'true';
}

// Dark by default: a stack that hasn't opted in behaves as if the route does
// not exist (404 mirrors requireTestEnv's reveal-nothing posture).
router.use((req, res, next) => {
  if (!mcpEnabled()) return res.status(404).json({ error: 'Not found', code: 404 });
  next();
});

// TLS guard. This router is mounted ABOVE the app-wide HTTP→HTTPS redirect (it
// has to be, to clear sanitizeBody and the global limiter), so it would
// otherwise be the one data-serving route that answers plain HTTP in
// production — handing back customer and finance data to a request whose bearer
// token crossed the wire in clear. Refuse instead of redirecting: an MCP client
// posting JSON-RPC cannot follow a 301, and a silent downgrade is the failure
// mode worth being loud about. Azure terminates TLS at the front end, so the
// signal is x-forwarded-proto (trust proxy is set in production).
router.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (proto !== 'https') {
    return res.status(403).json({
      jsonrpc: '2.0', id: null,
      error: { code: -32000, message: 'HTTPS required — reconnect this connector using an https:// endpoint URL' },
    });
  }
  next();
});

// Pre-auth: strict per-IP budget for FAILED requests only. This exists to deter
// token guessing, so it must not count successful calls — it runs before
// mcpAuth, and counting 2xx responses would cap every authenticated session at
// this budget and re-create exactly the shared-egress-IP starvation the
// token-keyed limiter below exists to prevent (claude.ai funnels many users
// through few IPs).
const preAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTest,
  message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests' } },
});

// Post-auth: keyed by token id, generous enough for a chatty session.
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.MCP_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTest,
  keyGenerator: (req) => (req.mcpToken ? `tok:${req.mcpToken.id}` : ipKeyGenerator(req.ip)),
  message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests' } },
});

router.post('/', preAuthLimiter, mcpAuth, tokenLimiter, dbCircuitBreakerMiddleware, transport.handlePost);

// No server push stream is offered (stateless server) — the spec allows 405
// for GET; DELETE has no session to end.
router.all('/', (req, res) => {
  res.set('Allow', 'POST');
  return res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method Not Allowed' } });
});

module.exports = router;
