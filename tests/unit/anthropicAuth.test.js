'use strict';

// server/services/anthropicAuth.js — how the app authenticates to Anthropic:
// Azure managed identity → Anthropic workload identity federation when the
// federation settings are present, else the static ANTHROPIC_API_KEY.
//
// The exchange is exercised end to end through the REAL SDK provider
// (@anthropic-ai/sdk/lib/credentials/oidc-federation.js) with only `fetch`
// replaced, so a change in what the SDK sends — or in how we call the App
// Service identity endpoint — fails here, not on a deployed slot.

const auth = require('../../server/services/anthropicAuth');

const WIF_ENV = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: 'org-uuid',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_test',
  ANTHROPIC_WIF_AUDIENCE: 'api://f775334a-e3d5-4087-87e6-631ff5fc1c4f',
  IDENTITY_ENDPOINT: 'http://127.0.0.1:41741/msi/token',
  IDENTITY_HEADER: 'identity-header-secret',
};

function jsonResponse(status, body) {
  // Real fetch Responses: the SDK reads the token response the way it reads a
  // live one (headers, body stream), so a hand-rolled stub would test the stub.
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_123' },
  });
}

describe('authMode', () => {
  test('nothing configured → null', () => {
    expect(auth.authMode({})).toBeNull();
    expect(auth.isConfigured({})).toBe(false);
  });

  test('only the key → api_key', () => {
    expect(auth.authMode({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('api_key');
  });

  test('all federation settings + the App Service identity endpoint → workload_identity, even with a key present', () => {
    expect(auth.authMode({ ...WIF_ENV, ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('workload_identity');
  });

  test.each(['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WIF_AUDIENCE', 'IDENTITY_ENDPOINT', 'IDENTITY_HEADER'])(
    'missing %s → falls back to the key (never a half-configured federation)',
    (k) => {
      const env = { ...WIF_ENV, ANTHROPIC_API_KEY: 'sk-ant-x', [k]: '  ' };
      expect(auth.authMode(env)).toBe('api_key');
    },
  );

  test('service account and workspace are optional', () => {
    const env = { ...WIF_ENV };
    delete env.ANTHROPIC_SERVICE_ACCOUNT_ID;
    delete env.ANTHROPIC_WORKSPACE_ID;
    expect(auth.authMode(env)).toBe('workload_identity');
  });
});

describe('clientAuthOptions', () => {
  test('api_key mode passes the key only', () => {
    expect(auth.clientAuthOptions({ env: { ANTHROPIC_API_KEY: ' sk-ant-x ' } })).toEqual({ apiKey: 'sk-ant-x' });
  });

  test('workload identity passes apiKey and authToken as null (else the SDK reads ANTHROPIC_API_KEY and it wins) plus a credentials provider', () => {
    const opts = auth.clientAuthOptions({ env: { ...WIF_ENV, ANTHROPIC_API_KEY: 'sk-ant-x' } });
    expect(opts.apiKey).toBeNull();
    expect(opts.authToken).toBeNull();
    expect(typeof opts.credentials).toBe('function');
  });

  test('nothing configured → null', () => {
    expect(auth.clientAuthOptions({ env: {} })).toBeNull();
  });
});

describe('the exchange, through the real SDK provider', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith(WIF_ENV.IDENTITY_ENDPOINT)) {
        return jsonResponse(200, { access_token: 'entra.jwt.value', expires_on: '1999999999', resource: WIF_ENV.ANTHROPIC_WIF_AUDIENCE });
      }
      if (String(url) === 'https://api.anthropic.com/v1/oauth/token') {
        return jsonResponse(200, { access_token: 'sk-ant-oat-short-lived', token_type: 'Bearer', expires_in: 3600 });
      }
      return jsonResponse(404, {});
    });
  });
  afterEach(() => { delete global.fetch; });

  test('asks the App Service identity endpoint for the audience, then posts a jwt-bearer grant with the rule, org, service account and workspace', async () => {
    const { credentials } = auth.clientAuthOptions({ env: WIF_ENV });
    const result = await credentials();

    expect(result.token).toBe('sk-ant-oat-short-lived');
    expect(result.expiresAt).toBeGreaterThan(Date.now() / 1000);

    const mi = calls[0];
    const u = new URL(mi.url);
    expect(`${u.origin}${u.pathname}`).toBe(WIF_ENV.IDENTITY_ENDPOINT);
    expect(u.searchParams.get('api-version')).toBe('2019-08-01');
    expect(u.searchParams.get('resource')).toBe(WIF_ENV.ANTHROPIC_WIF_AUDIENCE);
    expect(mi.init.headers['X-IDENTITY-HEADER']).toBe(WIF_ENV.IDENTITY_HEADER);

    const ex = calls[1];
    expect(ex.url).toBe('https://api.anthropic.com/v1/oauth/token');
    expect(ex.init.method).toBe('POST');
    const body = JSON.parse(ex.init.body);
    expect(body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: 'entra.jwt.value',
      federation_rule_id: 'fdrl_test',
      organization_id: 'org-uuid',
      service_account_id: 'svac_test',
      workspace_id: 'wrkspc_test',
    });
    expect(ex.init.headers['anthropic-beta']).toMatch(/oidc-federation/);
  });

  test('a failing identity endpoint surfaces its status and never reaches Anthropic', async () => {
    global.fetch.mockImplementationOnce(async () => jsonResponse(500, { error: 'boom' }));
    const { credentials } = auth.clientAuthOptions({ env: WIF_ENV });
    await expect(credentials()).rejects.toThrow(/managed identity token request failed: HTTP 500/);
    expect(calls.some(c => c.url.includes('anthropic.com'))).toBe(false);
  });

  test('a real SDK client sends Authorization: Bearer <exchanged token> and no x-api-key, even with ANTHROPIC_API_KEY in the environment', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-be-used';
    try {
      global.fetch.mockImplementation(async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).startsWith(WIF_ENV.IDENTITY_ENDPOINT)) return jsonResponse(200, { access_token: 'entra.jwt.value' });
        if (String(url).endsWith('/v1/oauth/token')) return jsonResponse(200, { access_token: 'sk-ant-oat-short-lived', expires_in: 3600 });
        return jsonResponse(200, { data: [], has_more: false, first_id: null, last_id: null });
      });
      const AnthropicMod = require('@anthropic-ai/sdk');
      const Ctor = AnthropicMod.default || AnthropicMod.Anthropic || AnthropicMod;
      const client = new Ctor({ ...auth.clientAuthOptions({ env: WIF_ENV }), maxRetries: 0, fetch: (u, i) => global.fetch(u, i) });
      await client.models.list({ limit: 1 }).catch(() => {});
      const apiCall = calls.find(c => c.url.includes('/v1/models'));
      expect(apiCall).toBeDefined();
      const h = new Headers(apiCall.init.headers);
      expect(h.get('authorization')).toBe('Bearer sk-ant-oat-short-lived');
      expect(h.get('x-api-key')).toBeNull();
      expect(h.get('anthropic-beta')).toMatch(/oauth-2025-04-20/);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('authSignature', () => {
  test('changes when the key rotates or the mode switches, so callers rebuild their client', () => {
    const a = auth.authSignature({ ANTHROPIC_API_KEY: 'one' });
    const b = auth.authSignature({ ANTHROPIC_API_KEY: 'two' });
    const c = auth.authSignature({ ...WIF_ENV, ANTHROPIC_API_KEY: 'two' });
    const d = auth.authSignature({ ...WIF_ENV, ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_other' });
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(auth.authSignature({})).toBe('');
  });
});

describe('selfCheck', () => {
  test('workload identity: a successful authenticated call reports ok', async () => {
    const list = jest.fn().mockResolvedValue({ data: [] });
    const r = await auth.selfCheck({ env: WIF_ENV, makeClient: () => ({ models: { list } }) });
    expect(r).toMatchObject({ mode: 'workload_identity', ok: true, checked: true, missing: [] });
    expect(list).toHaveBeenCalledWith({ limit: 1 });
  });

  test('workload identity: a failure is reported, never thrown', async () => {
    const list = jest.fn().mockRejectedValue(Object.assign(new Error('Token exchange failed with status 401'), { status: 401 }));
    await expect(auth.selfCheck({ env: WIF_ENV, makeClient: () => ({ models: { list } }) }))
      .resolves.toMatchObject({ mode: 'workload_identity', ok: false, checked: true });
  });

  test('api key: no network call', async () => {
    const makeClient = jest.fn();
    await expect(auth.selfCheck({ env: { ANTHROPIC_API_KEY: 'k' }, makeClient })).resolves.toMatchObject({ mode: 'api_key', ok: true, checked: false });
    expect(makeClient).not.toHaveBeenCalled();
  });
});

describe('bounded token fetches (a hung endpoint must not stall every Claude call)', () => {
  afterEach(() => { delete global.fetch; });

  // A fetch that never answers, but honours its abort signal like undici does.
  const hanging = (url, init = {}) => new Promise((_, reject) => {
    if (init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')));
  });

  test('a hung managed-identity endpoint fails within ANTHROPIC_AUTH_TIMEOUT_MS', async () => {
    global.fetch = jest.fn(hanging);
    const { credentials } = auth.clientAuthOptions({ env: { ...WIF_ENV, ANTHROPIC_AUTH_TIMEOUT_MS: '50' } });
    const started = Date.now();
    await expect(credentials()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a hung token exchange fails within ANTHROPIC_AUTH_TIMEOUT_MS', async () => {
    global.fetch = jest.fn(async (url, init = {}) => {
      if (String(url).startsWith(WIF_ENV.IDENTITY_ENDPOINT)) return jsonResponse(200, { access_token: 'entra.jwt.value' });
      return hanging(url, init);
    });
    const { credentials } = auth.clientAuthOptions({ env: { ...WIF_ENV, ANTHROPIC_AUTH_TIMEOUT_MS: '50' } });
    const started = Date.now();
    await expect(credentials()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('the timeout defaults to 10 s and ignores junk', () => {
    expect(auth._internal.authTimeoutMs({})).toBe(10000);
    expect(auth._internal.authTimeoutMs({ ANTHROPIC_AUTH_TIMEOUT_MS: 'nope' })).toBe(10000);
    expect(auth._internal.authTimeoutMs({ ANTHROPIC_AUTH_TIMEOUT_MS: '2500' })).toBe(2500);
  });
});

describe('selfCheck warnings (a silent fallback is the dangerous case)', () => {
  const logger = require('../../server/logger');
  let warn;
  beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); delete global.fetch; });

  test('federation partly configured → warns naming only the missing settings, then uses the key', async () => {
    const env = { ...WIF_ENV, ANTHROPIC_API_KEY: 'k' };
    delete env.ANTHROPIC_WIF_AUDIENCE;
    const r = await auth.selfCheck({ env, makeClient: jest.fn() });
    expect(r.mode).toBe('api_key');
    expect(r.missing).toEqual(['ANTHROPIC_WIF_AUDIENCE']);
    const [fields, msg] = warn.mock.calls[0];
    expect(fields.missing).toEqual(['ANTHROPIC_WIF_AUDIENCE']);
    expect(msg).toMatch(/incomplete/);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/fdrl_test|org-uuid|identity-header-secret/);
  });

  test('no identity endpoint in the container (identity switched off) is reported too', async () => {
    const env = { ...WIF_ENV };
    delete env.IDENTITY_ENDPOINT;
    delete env.IDENTITY_HEADER;
    const r = await auth.selfCheck({ env });
    expect(r.mode).toBeNull();
    expect(r.missing).toEqual(['IDENTITY_ENDPOINT', 'IDENTITY_HEADER']);
    expect(warn).toHaveBeenCalled();
  });

  test('no credentials while a Claude feature is switched on → warn; with features off → no warn', async () => {
    await auth.selfCheck({ env: { VISION_ENABLED: 'true' } });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    await auth.selfCheck({ env: {} });
    expect(warn).not.toHaveBeenCalled();
  });

  test('the real-client branch (no makeClient) runs the whole chain and reports ok', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.startsWith(WIF_ENV.IDENTITY_ENDPOINT)) return jsonResponse(200, { access_token: 'entra.jwt.value' });
      if (u.endsWith('/v1/oauth/token')) return jsonResponse(200, { access_token: 'sk-ant-oat-short-lived', expires_in: 3600 });
      if (u.includes('/v1/models')) return jsonResponse(200, { data: [], has_more: false, first_id: null, last_id: null });
      return jsonResponse(404, {});
    });
    await expect(auth.selfCheck({ env: WIF_ENV })).resolves.toMatchObject({ mode: 'workload_identity', ok: true, checked: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
