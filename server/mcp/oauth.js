// OAuth 2.1 for the MCP connector — the pure protocol helpers (R5a,
// 2026-09-24). No database, no Express: controllers/mcpOAuthController.js
// does the I/O, this file decides what is valid, so the unit tier can hold
// every rule (tests/unit/mcpOAuth.test.js).
//
// The profile, per the MCP authorization spec (rev 2025-06-18):
//   • the instance is both the resource server (/api/v1/mcp) and its own
//     authorization server — issuer = APP_URL;
//   • RFC 9728 protected-resource metadata + RFC 8414 server metadata;
//   • RFC 7591 dynamic client registration, PUBLIC clients only (no secret —
//     the redirect URI and PKCE are the proof), exact redirect-URI match;
//   • authorization code + PKCE S256 (plain is refused), refresh tokens
//     rotated on use, RFC 8707 resource indicators checked when sent.
// Redirect URIs: https on an ALLOWLISTED host (claude.ai, claude.com — or
// MCP_OAUTH_REDIRECT_HOSTS), or http on a loopback host (Claude Code / Desktop
// listen on localhost). Nothing else. The allowlist is the answer to an open
// redirect (security review, 2026-09-24; RFC 9700 §4.11.2): registration is
// anonymous and authorization errors go back to the registered URI, so an
// arbitrary https host would let anyone bounce a visitor off this domain.
const crypto = require('crypto');
const { identity } = require('../config/identity');

const SCOPES = ['read', 'write'];
const ACCESS_TTL_SECONDS  = 60 * 60;            // one hour
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;  // thirty days, rotated on use
const REQUEST_TTL_SECONDS = 10 * 60;            // an admin has ten minutes to approve
const CODE_TTL_SECONDS    = 5 * 60;             // and the client five to redeem

/** The issuer: APP_URL without a trailing slash, read per call so a test (or
 *  an App Service setting) decides it. The same fallback as ssrMeta.js. */
function issuer() {
  return (process.env.APP_URL || 'https://www.orangesmiley.is').replace(/\/+$/, '');
}

/** The protected resource — the MCP endpoint's canonical URL. */
function mcpResource() {
  return `${issuer()}/api/v1/mcp`;
}

function protectedResourceMetadataUrl() {
  return `${issuer()}/.well-known/oauth-protected-resource`;
}

/** RFC 9728. */
function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: SCOPES.slice(),
    bearer_methods_supported: ['header'],
    resource_name: `${identity.brand.name} MCP`,
  };
}

/** RFC 8414. */
function authorizationServerMetadata() {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    scopes_supported: SCOPES.slice(),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The https hosts a client may register a redirect URI on — exact host
 *  names, read per call. Default: Anthropic's two callback hosts. A stack that
 *  wants another MCP client sets MCP_OAUTH_REDIRECT_HOSTS (comma list; it
 *  REPLACES the default). */
function allowedRedirectHosts() {
  const raw = process.env.MCP_OAUTH_REDIRECT_HOSTS;
  const list = raw && raw.trim() ? raw.split(',') : ['claude.ai', 'claude.com'];
  return list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Is `uri` acceptable as a registered redirect URI? Returns an error string
 *  or null. */
function redirectUriProblem(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > 500) return 'must be a URL of at most 500 characters';
  let u;
  try { u = new URL(uri); } catch { return 'is not a valid URL'; }
  if (u.hash) return 'must not carry a fragment';
  if (u.username || u.password) return 'must not carry credentials';
  if (u.protocol === 'https:' && allowedRedirectHosts().includes(u.hostname.toLowerCase())) return null;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return null;
  return `must be https on ${allowedRedirectHosts().join(' / ')} (MCP_OAUTH_REDIRECT_HOSTS), or http on localhost`;
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) === challenge, constant time.
 *  The verifier's own shape is checked first (43–128 unreserved chars). */
function pkceMatches(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  if (typeof challenge !== 'string' || !challenge) return false;
  const computed = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A challenge is a base64url SHA-256: 43 characters. */
function challengeLooksValid(challenge) {
  return typeof challenge === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(challenge);
}

/** The scopes a request asks for: the known ones from a space-separated
 *  string; `read` always (write without read is meaningless here); nothing
 *  asked means read. Unknown scopes are dropped, not refused — a client that
 *  asks for more than exists gets what exists. */
function parseScopes(raw) {
  const asked = typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : [];
  const out = ['read'];
  if (asked.includes('write')) out.push('write');
  return out;
}

/** RFC 8707: a `resource` the client names must be this MCP endpoint (or the
 *  issuer origin, which some clients send). Absent is accepted. */
function resourceMatches(resource) {
  if (resource === undefined || resource === null || resource === '') return true;
  if (typeof resource !== 'string') return false;
  const norm = (s) => s.replace(/\/+$/, '');
  return [mcpResource(), issuer()].includes(norm(resource));
}

/** Append OAuth response parameters to a registered redirect URI. */
function redirectWith(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** An RFC 6749 §5.2 error body. */
function oauthError(error, description) {
  return description ? { error, error_description: description } : { error };
}

module.exports = {
  SCOPES,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  REQUEST_TTL_SECONDS,
  CODE_TTL_SECONDS,
  issuer,
  mcpResource,
  allowedRedirectHosts,
  protectedResourceMetadataUrl,
  protectedResourceMetadata,
  authorizationServerMetadata,
  redirectUriProblem,
  pkceMatches,
  challengeLooksValid,
  parseScopes,
  resourceMatches,
  redirectWith,
  oauthError,
};
