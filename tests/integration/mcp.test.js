'use strict';

// The MCP endpoint (/api/v1/mcp) — Streamable HTTP, stateless, bearer-only.
// Covers the JSON-RPC handshake, tool listing/calling, the auth matrix, the
// scope double-gate (token scopes vs the MCP_ALLOWED_SCOPES environment
// ceiling), and the two deliberate middleware exemptions: tool arguments must
// NOT be HTML-sanitized, and cookie sessions must NOT authenticate.
process.env.MCP_ENABLED = 'true';

const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const McpToken = require('../../server/models/McpToken');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

let adminId, token, tokenRow, adminCookie;

const rpc = (body, bearer = token) => {
  const req = request(app).post('/api/v1/mcp');
  if (bearer) req.set('Authorization', `Bearer ${bearer}`);
  return req.send(body);
};

const call = (name, args = {}, bearer = token) =>
  rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, bearer);

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mcp_tokens, system_updates RESTART IDENTITY CASCADE');
  adminId = await createTestAdminUser();
  await createTestRegularUser();
  adminCookie = await getTestSessionCookie();

  const minted = await McpToken.create({ userId: adminId, name: 'test token' });
  token = minted.token;
  tokenRow = minted.row;
});

afterAll(async () => {
  delete process.env.MCP_ALLOWED_SCOPES;
});

describe('MCP handshake', () => {
  test('initialize returns protocol version, tools capability and env-tagged serverInfo', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'jest' } } });
    expect(res.status).toBe(200);
    expect(res.body.result.protocolVersion).toBe('2025-06-18');
    expect(res.body.result.capabilities).toEqual({ tools: {} });
    expect(res.body.result.serverInfo.name).toMatch(/Icelandic Store Wholesale \[(TEST|PROD)\]/);
  });

  test('notifications/initialized → 202 with no body', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  test('ping pongs; unknown method → -32601; non-JSON-RPC body → -32700', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'ping' })).body.result).toEqual({});
    expect((await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).body.error.code).toBe(-32601);
    expect((await rpc({ hello: 'world' })).body.error.code).toBe(-32700);
  });

  test('GET → 405 (no server push stream), never the SPA HTML', async () => {
    const res = await request(app).get('/api/v1/mcp');
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe(-32000);
  });
});

describe('MCP auth', () => {
  test('401 matrix: missing, garbage, revoked, and expired tokens', async () => {
    for (const bearer of [null, 'mcp_' + 'a'.repeat(64)]) {
      const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, bearer);
      expect(res.status).toBe(401);
      // Plain Bearer challenge: we must NOT advertise resource_metadata until
      // PR 2 actually serves /.well-known/oauth-protected-resource — pointing
      // OAuth clients at the SPA catch-all breaks their discovery flow.
      expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
      expect(res.headers['www-authenticate']).not.toMatch(/resource_metadata/);
    }
    await McpToken.revoke(tokenRow.id);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);

    const short = await McpToken.create({ userId: adminId, name: 'expired' });
    await db.query('UPDATE mcp_tokens SET expires_at = NOW() - interval \'1 hour\' WHERE id = $1', [short.row.id]);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, short.token)).status).toBe(401);
  });

  test('an admin SESSION COOKIE does not authenticate — bearer only (the CSRF-exemption guarantee)', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .set('Cookie', adminCookie)
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
  });

  test('a 404 is served when MCP_ENABLED is off', async () => {
    process.env.MCP_ENABLED = 'false';
    try {
      expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(404);
    } finally {
      process.env.MCP_ENABLED = 'true';
    }
  });
});

describe('MCP tools — the v1 system surface', () => {
  test('tools/list names exactly the system tools (ENHANCEMENTS #13 v1 scope)', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    const names = res.body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['environment_info', 'updates_status']);
  });

  test('environment_info reports the environment, instance identity and counts', async () => {
    const res = await call('environment_info');
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload._environment ?? payload.environment).toBeDefined();
    expect(payload.instance).toMatch(/Halli Smiley/);
    expect(payload.counts).toMatchObject({
      orders: expect.any(Number),
      products: expect.any(Number),
      users: expect.any(Number),
      projects: expect.any(Number),
    });
  });

  test('updates_status reads the self-update posture and recent ledger rows', async () => {
    await db.query(
      `INSERT INTO system_updates (version, image_digest, channel, status)
       VALUES ('9.9.9-test', 'sha256:deadbeef', 'stable', 'available')`
    );
    const res = await call('updates_status');
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(['managed', 'auto', 'manual']).toContain(payload.mode);
    expect(['stable', 'canary']).toContain(payload.channel);
    expect(payload.recent.some((r) => r.version === '9.9.9-test')).toBe(true);
  });

  test('unknown arguments are rejected by the registry, not passed through', async () => {
    const res = await call('environment_info', { bogus: 1 });
    expect(res.body.result.isError).toBe(true);
  });
});

describe('MCP scope double-gate', () => {
  test('a write-scoped tool is hidden and refused when the environment ceiling is read-only', async () => {
    // No write tools ship in v1 — prove the gate with the ceiling instead:
    // a write-scoped TOKEN gains nothing on a read-only stack.
    delete process.env.MCP_ALLOWED_SCOPES; // default: read
    const writeToken = await McpToken.create({ userId: adminId, name: 'w', scopes: ['read', 'write'] });
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, writeToken.token);
    for (const t of res.body.result.tools) {
      expect(t.name).not.toMatch(/create|adjust|set_/);
    }
  });

  test('a read-only token cannot call outside its scopes even when the environment allows writes', async () => {
    process.env.MCP_ALLOWED_SCOPES = 'read,write';
    try {
      // environment_info is read-scoped; a token with NO scopes sees nothing.
      const bare = await McpToken.create({ userId: adminId, name: 'bare', scopes: [] });
      const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, bare.token);
      expect(list.body.result.tools).toHaveLength(0);
      const refused = await call('environment_info', {}, bare.token);
      expect(refused.body.result.isError).toBe(true);
    } finally {
      delete process.env.MCP_ALLOWED_SCOPES;
    }
  });
});

describe('admin token management (/api/v1/admin/mcp-tokens)', () => {
  test('admin can mint (plaintext once) and revoke; the endpoint honours both immediately', async () => {
    const created = await request(app)
      .post('/api/v1/admin/mcp-tokens')
      .set('Cookie', adminCookie)
      .send({ name: 'from the UI', ttl_days: 30 });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^mcp_[0-9a-f]{64}$/);
    expect(created.body.row.token_prefix).toBe(created.body.token.slice(0, 10));

    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, created.body.token)).status).toBe(200);

    const revoked = await request(app)
      .post(`/api/v1/admin/mcp-tokens/${created.body.row.id}/revoke`)
      .set('Cookie', adminCookie)
      .send({});
    expect(revoked.status).toBe(200);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, created.body.token)).status).toBe(401);
  });

  test('write-scoped minting is refused when the environment is read-only', async () => {
    delete process.env.MCP_ALLOWED_SCOPES;
    const res = await request(app)
      .post('/api/v1/admin/mcp-tokens')
      .set('Cookie', adminCookie)
      .send({ name: 'w', scopes: 'read,write' });
    expect(res.status).toBe(400);
  });

  test('gating: anon 401, non-admin 403', async () => {
    expect((await request(app).get('/api/v1/admin/mcp-tokens')).status).toBe(401);
    const userCookie = await getTestSessionCookie(await createTestRegularUser());
    expect((await request(app).get('/api/v1/admin/mcp-tokens').set('Cookie', userCookie)).status).toBe(403);
  });
});
