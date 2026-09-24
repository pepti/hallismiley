'use strict';

// The Claude features themselves on workload identity — no ANTHROPIC_API_KEY
// anywhere. The translator must report enabled and send `Authorization: Bearer
// <exchanged token>` through the REAL SDK, with only the network (global
// fetch) stubbed. Reverting it to reading ANTHROPIC_API_KEY fails these.
// (Harvested from icelandicstore #326, 2026-09-24; ice's visionCore cases are
// ice-only — the engine's Claude caller is the translator.)

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WIF_AUDIENCE',
  'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID', 'IDENTITY_ENDPOINT', 'IDENTITY_HEADER',
  'VISION_ENABLED', 'TRANSLATE_ENABLED', 'ANTHROPIC_AUTH_TIMEOUT_MS', 'ANTHROPIC_BASE_URL',
];
let saved;
let calls;

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'request-id': 'req_wiring' },
});

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_wiring',
    ANTHROPIC_ORGANIZATION_ID: 'org-wiring',
    ANTHROPIC_WIF_AUDIENCE: 'api://f775334a-e3d5-4087-87e6-631ff5fc1c4f',
    IDENTITY_ENDPOINT: 'http://127.0.0.1:41741/msi/token',
    IDENTITY_HEADER: 'hdr',
    VISION_ENABLED: 'true',
    TRANSLATE_ENABLED: 'true',
  });
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(process.env.IDENTITY_ENDPOINT)) return jsonResponse(200, { access_token: 'entra.jwt' });
    if (u.endsWith('/v1/oauth/token')) return jsonResponse(200, { access_token: 'sk-ant-oat-wiring', expires_in: 3600 });
    if (u.includes('/v1/messages')) {
      return jsonResponse(200, {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test',
        content: [{ type: 'text', text: '{"items":[]}' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    return jsonResponse(404, {});
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  delete global.fetch;
});

function bearerOn(path) {
  const c = calls.find((x) => x.url.includes(path));
  if (!c) return null;
  const h = new Headers(c.init.headers);
  return { authorization: h.get('authorization'), apiKey: h.get('x-api-key') };
}

test('translator: enabled without a key, and the model call carries the exchanged bearer token', async () => {
  let translator;
  jest.isolateModules(() => { translator = require('../../server/services/translator'); });
  expect(translator.isEnabled()).toBe(true);

  await translator.translate({ text: 'Hello', targetLocale: 'is' });
  expect(bearerOn('/v1/messages')).toEqual({ authorization: 'Bearer sk-ant-oat-wiring', apiKey: null });
});

test('neither federation nor a key: the translator reports disabled', () => {
  for (const k of ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WIF_AUDIENCE']) delete process.env[k];
  let translator;
  jest.isolateModules(() => { translator = require('../../server/services/translator'); });
  expect(translator.isEnabled()).toBe(false);
});
