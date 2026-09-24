// OAuth 2.1 endpoints for the MCP connector (R5a, 2026-09-24). Protocol rules
// in server/mcp/oauth.js, storage in models/McpOAuth.js + models/McpToken.js,
// routes and their gates in routes/mcpOAuthRoutes.js.
//
// ERROR-ENVELOPE EXEMPTION (stack-invariants #5), same class as the MCP
// transport's JSON-RPC errors: the machine endpoints (/oauth/register,
// /oauth/token, /oauth/revoke) answer RFC 6749 §5.2 / RFC 7591 §3.2.2 error
// bodies — `{ error: "invalid_grant", error_description }` — because OAuth
// clients parse exactly that shape. The admin endpoints under
// /api/v1/oauth/requests keep the app's `{ error, code }` envelope.
const McpOAuth = require('../models/McpOAuth');
const McpToken = require('../models/McpToken');
const oauth = require('../mcp/oauth');
const { ownerMayUseMcp } = require('../mcp/owner');
const { allowedScopes } = require('../mcp/registry');
const securityLogger = require('../observability/securityLogger');
const logger = require('../logger');
const { PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES } = require('../config/i18n');

const MAX_REDIRECT_URIS = 10;

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

function tokenError(res, status, error, description) {
  noStore(res);
  return res.status(status).json(oauth.oauthError(error, description));
}

// The body of a token/revoke request: form-encoded per RFC 6749 (the router
// parses it), JSON accepted too. Only string values count.
function field(req, name) {
  const v = req.body && req.body[name];
  return typeof v === 'string' ? v : undefined;
}

function consentLocale(req) {
  const c = req.cookies && req.cookies.locale_choice;
  return c && SUPPORTED_LOCALES.includes(c) ? c : PUBLIC_DEFAULT_LOCALE;
}

/** Mint the access + refresh pair for a grant. The refresh token stands for
 *  the connection (it is what /admin/mcp lists and revokes); the access token
 *  hangs off it. */
async function mintPair({ userId, clientId, clientName, scopes, parentRefreshId = null }) {
  const refresh = await McpToken.create({
    userId, name: clientName, kind: 'refresh', scopes, oauthClientId: clientId,
    parentId: parentRefreshId, ttlSeconds: oauth.REFRESH_TTL_SECONDS,
  });
  const access = await McpToken.create({
    userId, name: clientName, kind: 'access', scopes, oauthClientId: clientId,
    parentId: refresh.row.id, ttlSeconds: oauth.ACCESS_TTL_SECONDS,
  });
  return {
    refreshRow: refresh.row,
    body: {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: oauth.ACCESS_TTL_SECONDS,
      refresh_token: refresh.token,
      scope: scopes.join(' '),
    },
  };
}

const mcpOAuthController = {
  // ── Discovery ──────────────────────────────────────────────────────────────

  protectedResource(req, res) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(oauth.protectedResourceMetadata());
  },

  authorizationServer(req, res) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(oauth.authorizationServerMetadata());
  },

  // ── RFC 7591 dynamic client registration ───────────────────────────────────

  async register(req, res, next) {
    try {
      noStore(res);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const uris = body.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > MAX_REDIRECT_URIS) {
        return res.status(400).json(oauth.oauthError('invalid_redirect_uri', `redirect_uris must list 1–${MAX_REDIRECT_URIS} URIs`));
      }
      for (const u of uris) {
        const problem = oauth.redirectUriProblem(u);
        if (problem) return res.status(400).json(oauth.oauthError('invalid_redirect_uri', `${String(u).slice(0, 100)} ${problem}`));
      }
      if (body.grant_types !== undefined
          && (!Array.isArray(body.grant_types) || !body.grant_types.includes('authorization_code')
            || body.grant_types.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))) {
        return res.status(400).json(oauth.oauthError('invalid_client_metadata', 'grant_types must be authorization_code (and refresh_token)'));
      }
      if (body.response_types !== undefined
          && (!Array.isArray(body.response_types) || body.response_types.some((r) => r !== 'code'))) {
        return res.status(400).json(oauth.oauthError('invalid_client_metadata', 'response_types must be ["code"]'));
      }
      const name = typeof body.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim().slice(0, 200)
        : 'MCP client';
      const client = await McpOAuth.registerClient({ clientName: name, redirectUris: uris });
      logger.info({ clientId: client.client_id, clientName: client.client_name }, 'mcp.oauth.client_registered');
      // Every client is registered PUBLIC, whatever auth method it asked for
      // (RFC 7591 §3.2.1 lets the server substitute): there is no secret to
      // hand out, and PKCE plus the exact redirect URI are the proof.
      return res.status(201).json({
        client_id: client.client_id,
        client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    } catch (err) { return next(err); }
  },

  // ── Authorization endpoint (browser) ───────────────────────────────────────
  //
  // Validates the client and the redirect URI FIRST: until both check out,
  // errors are shown here and never sent to an unverified URI (RFC 6749
  // §4.1.2.1). After that, errors go back to the client by redirect. A valid
  // request becomes a pending row and the admin is sent to the consent page.
  async authorize(req, res, next) {
    try {
      const q = req.query || {};
      const str = (k) => (typeof q[k] === 'string' ? q[k] : undefined);
      const client = await McpOAuth.findClient(str('client_id'));
      if (!client) {
        return res.status(400).json({ error: 'Unknown OAuth client — add the connector again from Claude', code: 400 });
      }
      let redirectUri = str('redirect_uri');
      if (!redirectUri && client.redirect_uris.length === 1) redirectUri = client.redirect_uris[0];
      if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
        return res.status(400).json({ error: 'redirect_uri is not registered for this client', code: 400 });
      }

      const state = str('state');
      const fail = (error, description) => res.redirect(302, oauth.redirectWith(redirectUri, {
        error, error_description: description, state, iss: oauth.issuer(),
      }));

      if (str('response_type') !== 'code') return fail('unsupported_response_type', 'response_type must be code');
      const challenge = str('code_challenge');
      if (!oauth.challengeLooksValid(challenge) || str('code_challenge_method') !== 'S256') {
        return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
      }
      const resource = str('resource');
      if (!oauth.resourceMatches(resource)) return fail('invalid_target', 'resource is not this MCP server');

      const request = await McpOAuth.createRequest({
        clientId: client.client_id,
        redirectUri,
        codeChallenge: challenge,
        scopes: oauth.parseScopes(str('scope')),
        state,
        resource,
      });
      return res.redirect(302, `/${consentLocale(req)}/tengja/${request.request_id}`);
    } catch (err) { return next(err); }
  },

  // ── Consent (admin session; the SPA's /tengja/<id>) ────────────────────────

  async getRequest(req, res, next) {
    try {
      const r = await McpOAuth.findPendingRequest(req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found', code: 404 });
      noStore(res);
      return res.json({
        client_name: r.client_name,
        redirect_uri: r.redirect_uri,
        redirect_host: new URL(r.redirect_uri).host,
        scopes: r.scopes,
        write_allowed: allowedScopes().includes('write'),
        expires_at: r.expires_at,
      });
    } catch (err) { return next(err); }
  },

  async approve(req, res, next) {
    try {
      const pending = await McpOAuth.findPendingRequest(req.params.id);
      if (!pending) return res.status(404).json({ error: 'Not found', code: 404 });
      // Write only if the client asked for it, the admin left it ticked, and
      // this environment's ceiling allows it at all.
      const scopes = ['read'];
      if (pending.scopes.includes('write') && req.body && req.body.allow_write === true
          && allowedScopes().includes('write')) {
        scopes.push('write');
      }
      const approved = await McpOAuth.approveRequest(req.params.id, { userId: req.user.id, scopes });
      if (!approved) return res.status(404).json({ error: 'Not found', code: 404 });
      securityLogger.adminAction(req.user.id, 'mcp_oauth_approved', pending.client_id, { client: pending.client_name, scopes });
      noStore(res); // the redirect carries a live code
      return res.json({
        redirect: oauth.redirectWith(approved.row.redirect_uri, {
          code: approved.code, state: approved.row.state, iss: oauth.issuer(),
        }),
      });
    } catch (err) { return next(err); }
  },

  async deny(req, res, next) {
    try {
      const row = await McpOAuth.denyRequest(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found', code: 404 });
      securityLogger.adminAction(req.user.id, 'mcp_oauth_denied', row.client_id, {});
      noStore(res);
      return res.json({
        redirect: oauth.redirectWith(row.redirect_uri, {
          error: 'access_denied', state: row.state, iss: oauth.issuer(),
        }),
      });
    } catch (err) { return next(err); }
  },

  // ── Token endpoint ─────────────────────────────────────────────────────────

  async token(req, res, next) {
    try {
      const grant = field(req, 'grant_type');
      const clientId = field(req, 'client_id');
      const client = await McpOAuth.findClient(clientId);
      if (!client) return tokenError(res, 401, 'invalid_client', 'unknown client_id');

      if (grant === 'authorization_code') {
        const { row, replay } = await McpOAuth.consumeCode(field(req, 'code'));
        if (replay) {
          // A code presented twice: assume it leaked and end the grant.
          const n = await McpToken.revokeClientGrant(replay.user_id, replay.client_id);
          logger.warn({ clientId: replay.client_id, revoked: n }, 'mcp.oauth.code_replay');
          return tokenError(res, 400, 'invalid_grant', 'authorization code already used');
        }
        if (!row) return tokenError(res, 400, 'invalid_grant', 'authorization code is invalid or expired');
        if (row.client_id !== client.client_id) return tokenError(res, 400, 'invalid_grant', 'code was issued to another client');
        if (field(req, 'redirect_uri') !== row.redirect_uri) return tokenError(res, 400, 'invalid_grant', 'redirect_uri does not match');
        if (!oauth.pkceMatches(field(req, 'code_verifier'), row.code_challenge)) {
          return tokenError(res, 400, 'invalid_grant', 'code_verifier does not match');
        }
        if (!oauth.resourceMatches(field(req, 'resource'))) return tokenError(res, 400, 'invalid_target', 'resource is not this MCP server');
        if (!(await ownerMayUseMcp(row.user_id))) return tokenError(res, 400, 'invalid_grant', 'the approving account may no longer connect');

        const { refreshRow, body } = await mintPair({
          userId: row.user_id, clientId: client.client_id, clientName: client.client_name, scopes: row.scopes,
        });
        await McpOAuth.setCodeToken(row.id, refreshRow.id);
        McpOAuth.touchClient(client.client_id);
        securityLogger.adminAction(row.user_id, 'mcp_oauth_token_issued', client.client_id, { scopes: row.scopes });
        noStore(res);
        return res.json(body);
      }

      if (grant === 'refresh_token') {
        const presented = await McpToken.findByPlaintext(field(req, 'refresh_token'));
        if (!presented || presented.kind !== 'refresh' || presented.oauth_client_id !== client.client_id) {
          return tokenError(res, 400, 'invalid_grant', 'refresh token is invalid');
        }
        if (presented.revoked_at) {
          // A rotated (or revoked) refresh token came back: it was copied.
          // End every token this client holds for this user.
          const n = await McpToken.revokeClientGrant(presented.user_id, client.client_id);
          logger.warn({ clientId: client.client_id, revoked: n }, 'mcp.oauth.refresh_replay');
          return tokenError(res, 400, 'invalid_grant', 'refresh token was already used');
        }
        if (new Date(presented.expires_at) <= new Date()) return tokenError(res, 400, 'invalid_grant', 'refresh token expired');
        if (!(await ownerMayUseMcp(presented.user_id))) return tokenError(res, 400, 'invalid_grant', 'the approving account may no longer connect');
        // Rotate: retire the presented token (only the first of two racing
        // requests wins), keep its live access token for the rest of its hour.
        const retired = await McpToken.retire(presented.id);
        if (!retired) return tokenError(res, 400, 'invalid_grant', 'refresh token was already used');
        // A client may narrow the scope on refresh, never widen it.
        const asked = field(req, 'scope');
        const scopes = asked ? oauth.parseScopes(asked).filter((s) => presented.scopes.includes(s)) : presented.scopes;
        const { body } = await mintPair({
          userId: presented.user_id, clientId: client.client_id, clientName: client.client_name,
          scopes, parentRefreshId: presented.id,
        });
        McpOAuth.touchClient(client.client_id);
        noStore(res);
        return res.json(body);
      }

      return tokenError(res, 400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
    } catch (err) { return next(err); }
  },

  // ── RFC 7009 revocation ────────────────────────────────────────────────────
  // Always 200 (the spec: an invalid token is not an error the client can act
  // on). A token is revoked only when it belongs to the calling client.
  async revoke(req, res, next) {
    try {
      noStore(res);
      const row = await McpToken.findByPlaintext(field(req, 'token'));
      if (row && row.oauth_client_id && row.oauth_client_id === field(req, 'client_id')) {
        await McpToken.revoke(row.id);
        logger.info({ clientId: row.oauth_client_id, tokenId: row.id }, 'mcp.oauth.revoked');
      }
      return res.status(200).json({});
    } catch (err) { return next(err); }
  },
};

module.exports = mcpOAuthController;
