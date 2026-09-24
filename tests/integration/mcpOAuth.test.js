'use strict';

// OAuth 2.1 for the MCP connector, end to end (R5a, 2026-09-24): discovery,
// dynamic client registration, the authorization request → admin consent →
// code → token exchange, refresh rotation with replay detection, revocation,
// and the owner re-check on every MCP call. The pure rules (PKCE, redirect
// URIs, scopes, metadata) are tests/unit/mcpOAuth.test.js.
process.env.MCP_ENABLED = 'true';

const crypto = require('crypto');
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const UserRole = require('../../server/models/UserRole');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const s256 = (v) => crypto.createHash('sha256').update(v, 'ascii').digest('base64url');
const issuer = () => process.env.APP_URL.replace(/\/+$/, '');

let adminId, adminCookie, userCookie;

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mcp_oauth_codes, mcp_oauth_clients, mcp_tokens RESTART IDENTITY CASCADE');
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(await createTestRegularUser());
  delete process.env.MCP_ALLOWED_SCOPES;
});

afterAll(() => { delete process.env.MCP_ALLOWED_SCOPES; });

async function register(body = {}) {
  const res = await request(app).post('/oauth/register')
    .send({ client_name: 'Claude', redirect_uris: [CALLBACK], ...body });
  return res;
}

/** Register, start an authorization request, return the pieces. */
async function startFlow({ scope, resource, state = 'st-123' } = {}) {
  const client = (await register()).body;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const q = {
    response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK,
    code_challenge: s256(verifier), code_challenge_method: 'S256', state,
  };
  if (scope) q.scope = scope;
  if (resource) q.resource = resource;
  const res = await request(app).get('/oauth/authorize').query(q);
  const m = /^\/(is|en)\/tengja\/([a-f0-9]{48})$/.exec(res.headers.location || '');
  return { client, verifier, res, requestId: m && m[2], state };
}

/** The whole happy path up to a token response. */
async function connect(opts = {}) {
  const flow = await startFlow(opts);
  const approved = await request(app).post(`/api/v1/oauth/requests/${flow.requestId}/approve`)
    .set('Cookie', adminCookie).send({ allow_write: opts.allowWrite === true });
  const code = new URL(approved.body.redirect).searchParams.get('code');
  const tokenRes = await request(app).post('/oauth/token').type('form').send({
    grant_type: 'authorization_code', client_id: flow.client.client_id, code,
    redirect_uri: CALLBACK, code_verifier: flow.verifier, resource: `${issuer()}/api/v1/mcp`,
  });
  return { ...flow, code, approved, tokenRes };
}

const rpc = (bearer, body) => request(app).post('/api/v1/mcp').set('Authorization', `Bearer ${bearer}`).send(body);
const toolsList = (bearer) => rpc(bearer, { jsonrpc: '2.0', id: 1, method: 'tools/list' });

describe('discovery', () => {
  test('protected-resource and authorization-server metadata name this instance', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp']) {
      const pr = await request(app).get(path);
      expect(pr.status).toBe(200);
      expect(pr.body.resource).toBe(`${issuer()}/api/v1/mcp`);
      expect(pr.body.authorization_servers).toEqual([issuer()]);
    }
    const as = await request(app).get('/.well-known/oauth-authorization-server');
    expect(as.status).toBe(200);
    expect(as.body.issuer).toBe(issuer());
    expect(as.body.token_endpoint).toBe(`${issuer()}/oauth/token`);
    expect(as.body.code_challenge_methods_supported).toEqual(['S256']);
  });

  test('an unauthenticated MCP call points at the metadata (RFC 9728)', async () => {
    const res = await request(app).post('/api/v1/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate'])
      .toBe(`Bearer realm="orangesmiley-mcp", resource_metadata="${issuer()}/.well-known/oauth-protected-resource"`);
  });

  test('the whole flow is dark with MCP_ENABLED off', async () => {
    process.env.MCP_ENABLED = 'false';
    try {
      for (const [m, p] of [['get', '/.well-known/oauth-authorization-server'], ['get', '/.well-known/oauth-protected-resource'],
        ['post', '/oauth/register'], ['get', '/oauth/authorize'], ['post', '/oauth/token'], ['post', '/oauth/revoke'],
        ['get', '/api/v1/oauth/requests/x']]) {
        const res = await request(app)[m](p);
        expect([p, res.status]).toEqual([p, 404]);
      }
    } finally { process.env.MCP_ENABLED = 'true'; }
  });
});

describe('dynamic client registration', () => {
  test('registers a public client', async () => {
    const res = await register({ token_endpoint_auth_method: 'client_secret_post' });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toMatch(/^mcpc_[a-f0-9]{32}$/);
    expect(res.body.token_endpoint_auth_method).toBe('none');
    expect(res.body.redirect_uris).toEqual([CALLBACK]);
    expect(res.body.client_secret).toBeUndefined();
  });

  test.each([
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://evil.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: 'https://claude.ai/cb' }, 'invalid_redirect_uri'],
    [{ grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ response_types: ['token'] }, 'invalid_client_metadata'],
  ])('refuses %j', async (body, error) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
  });
});

describe('the authorization request', () => {
  test('an unknown client or an unregistered redirect URI is answered here, never redirected', async () => {
    const unknown = await request(app).get('/oauth/authorize').query({ client_id: 'mcpc_nope', redirect_uri: CALLBACK });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.location).toBeUndefined();

    const client = (await register()).body;
    const wrong = await request(app).get('/oauth/authorize')
      .query({ client_id: client.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code' });
    expect(wrong.status).toBe(400);
    expect(wrong.headers.location).toBeUndefined();
  });

  test('without PKCE S256 the client gets invalid_request at its redirect URI', async () => {
    const client = (await register()).body;
    for (const q of [{}, { code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' }]) {
      const res = await request(app).get('/oauth/authorize')
        .query({ response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK, state: 'abc', ...q });
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.location);
      expect(loc.origin + loc.pathname).toBe(CALLBACK);
      expect(loc.searchParams.get('error')).toBe('invalid_request');
      expect(loc.searchParams.get('state')).toBe('abc');
      expect(loc.searchParams.get('iss')).toBe(issuer());
    }
  });

  test('a resource that is not this server is invalid_target', async () => {
    const { res } = await startFlow({ resource: 'https://evil.example/api/v1/mcp' });
    expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_target');
  });

  test('a valid request goes to the consent page, which only an admin can read', async () => {
    const { requestId } = await startFlow({ scope: 'read write' });
    expect(requestId).toBeTruthy();
    expect((await request(app).get(`/api/v1/oauth/requests/${requestId}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/oauth/requests/${requestId}`).set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).post(`/api/v1/oauth/requests/${requestId}/approve`).set('Cookie', userCookie).send({})).status).toBe(403);
    const res = await request(app).get(`/api/v1/oauth/requests/${requestId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ client_name: 'Claude', redirect_host: 'claude.ai', scopes: ['read', 'write'], write_allowed: false });
  });

  test('the consent page itself is served noindex', async () => {
    const { requestId } = await startFlow();
    const page = await request(app).get(`/is/tengja/${requestId}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<meta name="robots" content="noindex, nofollow"');
  });

  test('deny sends access_denied back with the state; the request is then gone', async () => {
    const { requestId } = await startFlow();
    const res = await request(app).post(`/api/v1/oauth/requests/${requestId}/deny`).set('Cookie', adminCookie).send({});
    const loc = new URL(res.body.redirect);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('st-123');
    expect((await request(app).get(`/api/v1/oauth/requests/${requestId}`).set('Cookie', adminCookie)).status).toBe(404);
    expect((await request(app).post(`/api/v1/oauth/requests/${requestId}/approve`).set('Cookie', adminCookie).send({})).status).toBe(404);
  });

  test('an expired request cannot be approved', async () => {
    const { requestId } = await startFlow();
    await db.query(`UPDATE mcp_oauth_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE request_id = $1`, [requestId]);
    expect((await request(app).post(`/api/v1/oauth/requests/${requestId}/approve`).set('Cookie', adminCookie).send({})).status).toBe(404);
  });
});

describe('code → tokens', () => {
  test('approve → code → a token pair that works on /api/v1/mcp', async () => {
    const { tokenRes, approved, state } = await connect();
    const loc = new URL(approved.body.redirect);
    expect(loc.searchParams.get('state')).toBe(state);
    expect(loc.searchParams.get('iss')).toBe(issuer());
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers['cache-control']).toBe('no-store');
    expect(tokenRes.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read' });
    const list = await toolsList(tokenRes.body.access_token);
    expect(list.status).toBe(200);
    expect(list.body.result.tools.map((t) => t.name)).toContain('environment_info');
  });

  test('a refresh token is not a bearer credential', async () => {
    const { tokenRes } = await connect();
    expect((await toolsList(tokenRes.body.refresh_token)).status).toBe(401);
  });

  test('write is granted only if asked, ticked AND allowed by the environment ceiling', async () => {
    expect((await connect({ scope: 'read write', allowWrite: true })).tokenRes.body.scope).toBe('read');
    process.env.MCP_ALLOWED_SCOPES = 'read,write';
    expect((await connect({ scope: 'read write', allowWrite: false })).tokenRes.body.scope).toBe('read');
    expect((await connect({ scope: 'read', allowWrite: true })).tokenRes.body.scope).toBe('read');
    expect((await connect({ scope: 'read write', allowWrite: true })).tokenRes.body.scope).toBe('read write');
  });

  test.each([
    ['a wrong verifier', () => ({ code_verifier: crypto.randomBytes(32).toString('base64url') })],
    ['a different redirect_uri', () => ({ redirect_uri: 'https://claude.ai/other' })],
    ['a foreign resource', () => ({ resource: 'https://evil.example/api/v1/mcp' })],
  ])('%s is refused', async (_label, override) => {
    const flow = await startFlow();
    const approved = await request(app).post(`/api/v1/oauth/requests/${flow.requestId}/approve`).set('Cookie', adminCookie).send({});
    const code = new URL(approved.body.redirect).searchParams.get('code');
    const res = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code', client_id: flow.client.client_id, code,
      redirect_uri: CALLBACK, code_verifier: flow.verifier, ...override(flow),
    });
    expect(res.status).toBe(400);
    expect(['invalid_grant', 'invalid_target']).toContain(res.body.error);
  });

  test('a code redeemed twice ends the grant', async () => {
    const { client, code, verifier, tokenRes } = await connect();
    const again = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier,
    });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');
    expect((await toolsList(tokenRes.body.access_token)).status).toBe(401);
  });

  test('a code issued to one client cannot be redeemed by another', async () => {
    const flow = await startFlow();
    const approved = await request(app).post(`/api/v1/oauth/requests/${flow.requestId}/approve`).set('Cookie', adminCookie).send({});
    const code = new URL(approved.body.redirect).searchParams.get('code');
    const other = (await register()).body;
    const res = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code', client_id: other.client_id, code, redirect_uri: CALLBACK, code_verifier: flow.verifier,
    });
    expect(res.body.error).toBe('invalid_grant');
  });

  test('an unknown client or grant type is refused', async () => {
    expect((await request(app).post('/oauth/token').type('form').send({ grant_type: 'authorization_code', client_id: 'nope' })).body.error).toBe('invalid_client');
    const client = (await register()).body;
    expect((await request(app).post('/oauth/token').type('form').send({ grant_type: 'password', client_id: client.client_id })).body.error).toBe('unsupported_grant_type');
  });
});

describe('refresh', () => {
  test('rotates: a new pair, the old refresh token retired', async () => {
    const { client, tokenRes } = await connect();
    const first = tokenRes.body;
    const res = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token', client_id: client.client_id, refresh_token: first.refresh_token,
    });
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).not.toBe(first.refresh_token);
    expect((await toolsList(res.body.access_token)).status).toBe(200);
    // The previous access token keeps its hour.
    expect((await toolsList(first.access_token)).status).toBe(200);
  });

  test('a replayed refresh token ends every token the client holds', async () => {
    const { client, tokenRes } = await connect();
    const first = tokenRes.body;
    const second = (await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token', client_id: client.client_id, refresh_token: first.refresh_token,
    })).body;
    const replay = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token', client_id: client.client_id, refresh_token: first.refresh_token,
    });
    expect(replay.body.error).toBe('invalid_grant');
    expect((await toolsList(second.access_token)).status).toBe(401);
    expect((await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token', client_id: client.client_id, refresh_token: second.refresh_token,
    })).body.error).toBe('invalid_grant');
  });

  test('a client may narrow the scope on refresh, never widen it', async () => {
    process.env.MCP_ALLOWED_SCOPES = 'read,write';
    const { client, tokenRes } = await connect({ scope: 'read' });
    const res = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokenRes.body.refresh_token, scope: 'read write',
    });
    expect(res.body.scope).toBe('read');
  });
});

describe('revocation and the owner', () => {
  test('RFC 7009: revoking the refresh token (the connection) ends its access token too', async () => {
    const { client, tokenRes } = await connect();
    const res = await request(app).post('/oauth/revoke').type('form').send({ token: tokenRes.body.refresh_token, client_id: client.client_id });
    expect(res.status).toBe(200);
    expect((await toolsList(tokenRes.body.access_token)).status).toBe(401);
  });

  test('revoking the current connection also ends the access token a rotation left running', async () => {
    const { client, tokenRes } = await connect();
    const first = tokenRes.body;
    await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token', client_id: client.client_id, refresh_token: first.refresh_token,
    });
    const list = await request(app).get('/api/v1/admin/mcp-tokens').set('Cookie', adminCookie);
    const conns = list.body.tokens.filter((t) => t.kind === 'refresh');
    expect(conns).toHaveLength(1); // one row per connection, not per rotation
    expect((await toolsList(first.access_token)).status).toBe(200);
    await request(app).post(`/api/v1/admin/mcp-tokens/${conns[0].id}/revoke`).set('Cookie', adminCookie).send({});
    expect((await toolsList(first.access_token)).status).toBe(401);
  });

  test('another client cannot revoke a token; an unknown token is still 200', async () => {
    const { tokenRes } = await connect();
    const other = (await register()).body;
    expect((await request(app).post('/oauth/revoke').type('form').send({ token: tokenRes.body.access_token, client_id: other.client_id })).status).toBe(200);
    expect((await toolsList(tokenRes.body.access_token)).status).toBe(200);
    expect((await request(app).post('/oauth/revoke').type('form').send({ token: 'mcp_nope', client_id: other.client_id })).status).toBe(200);
  });

  test('/admin/mcp lists the connection (not its access tokens) and revoking it ends both', async () => {
    const { tokenRes } = await connect();
    const list = await request(app).get('/api/v1/admin/mcp-tokens').set('Cookie', adminCookie);
    const conns = list.body.tokens.filter((t) => t.kind === 'refresh');
    expect(conns).toHaveLength(1);
    expect(conns[0].client_name).toBe('Claude');
    expect(list.body.tokens.some((t) => t.kind === 'access')).toBe(false);
    await request(app).post(`/api/v1/admin/mcp-tokens/${conns[0].id}/revoke`).set('Cookie', adminCookie).send({});
    expect((await toolsList(tokenRes.body.access_token)).status).toBe(401);
  });

  test('a token stops working when its owner is no longer an admin, or is disabled', async () => {
    const { tokenRes } = await connect();
    const bearer = tokenRes.body.access_token;
    expect((await toolsList(bearer)).status).toBe(200);

    await UserRole.add(adminId, 'user');
    await UserRole.remove(adminId, 'admin');
    expect((await toolsList(bearer)).status).toBe(401);

    await UserRole.add(adminId, 'admin');
    expect((await toolsList(bearer)).status).toBe(200);
    await db.query('UPDATE users SET disabled = true WHERE id = $1', [adminId]);
    expect((await toolsList(bearer)).status).toBe(401);
  });
});
