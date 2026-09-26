'use strict';

/**
 * The optional Microsoft Graph sendMail transport (harvest 2 lane 2,
 * 2026-09-26; ported from icelandicstore #173). global fetch is stubbed —
 * trackedFetch resolves it at call time — so nothing leaves the process.
 *
 * Pinned:
 *  - selection is ONE explicit switch (EMAIL_TRANSPORT=graph); the GRAPH_*
 *    variables alone never move an instance off Resend; an unknown value is
 *    "not configured", named;
 *  - client-credentials token, cached until a minute before expiry, keyed by
 *    tenant/app; a 401 retries once with a fresh token;
 *  - sendMail: the mailbox in the path, saveToSentItems:false, recipients /
 *    replyTo mapped, the minted client-request-id returned as the message id
 *    (the invite-sent-means-sent contract reads it);
 *  - failures map to { error } with the AADSTS code / Graph error code, the
 *    secret never in a message; through deliver() they are logged loudly and
 *    EMAIL_ALLOWLIST still rewrites every recipient.
 */

const mt = require('../../server/services/mailTransport');

const GRAPH_ENV = {
  EMAIL_TRANSPORT: 'graph',
  GRAPH_TENANT_ID: 'tenant-1',
  GRAPH_CLIENT_ID: 'client-1',
  GRAPH_CLIENT_SECRET: 's3cret-value',
  GRAPH_SENDER: 'mailbox@example.test',
};

const json = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300, headers: new Map(Object.entries(headers)), json: async () => body,
});

let calls;
let script;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  script = [];
  mt._resetTokenCache();
  globalThis.fetch = jest.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const next = script.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === 'function' ? next(url, init) : next;
  });
});
afterAll(() => { globalThis.fetch = realFetch; });

const TOKEN_OK = () => json(200, { access_token: 'tok-A', expires_in: 3600 });
const msg = { from: 'Brand <mailbox@example.test>', to: 'anna@example.test', replyTo: 'owner@example.test', subject: 'Halló', html: '<p>x</p>' };

describe('transport selection', () => {
  test('resend is the default; graph only by the explicit switch', () => {
    expect(mt.transportName({})).toBe('resend');
    expect(mt.transportName({ GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's' })).toBe('resend');
    expect(mt.transportName({ EMAIL_TRANSPORT: ' Graph ' })).toBe('graph');
    expect(mt.transportName({ EMAIL_TRANSPORT: 'smtp' })).toBeNull();
  });

  test('what each transport still lacks is named', () => {
    expect(mt.missingSettings({})).toEqual(['RESEND_API_KEY']);
    expect(mt.missingSettings({ RESEND_API_KEY: 're_x' })).toEqual([]);
    expect(mt.missingSettings({ EMAIL_TRANSPORT: 'graph' })).toEqual(
      ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER (or EMAIL_FROM)']);
    // The sender falls back to the From address.
    const { GRAPH_SENDER, ...noSender } = GRAPH_ENV;
    expect(GRAPH_SENDER).toBeTruthy();
    expect(mt.isTransportConfigured(noSender, 'info@example.test')).toBe(true);
    expect(mt.missingSettings({ EMAIL_TRANSPORT: 'smtp' })[0]).toMatch(/EMAIL_TRANSPORT \(unknown value "smtp"/);
  });
});

describe('Graph sendMail', () => {
  test('token then sendMail; the client-request-id is the message id', async () => {
    script.push(TOKEN_OK(), json(202, {}));
    const r = await mt.sendViaGraph(msg, { env: GRAPH_ENV });
    expect(r.error).toBeNull();
    expect(r.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const [tokenCall, sendCall] = calls;
    expect(tokenCall.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    const form = new URLSearchParams(tokenCall.init.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(form.get('client_id')).toBe('client-1');
    expect(tokenCall.init.signal).toBeDefined();   // bounded

    expect(sendCall.url).toBe('https://graph.microsoft.com/v1.0/users/mailbox%40example.test/sendMail');
    expect(sendCall.init.headers.Authorization).toBe('Bearer tok-A');
    expect(sendCall.init.headers['client-request-id']).toBe(r.data.id);
    expect(sendCall.init.signal).toBeDefined();
    const body = JSON.parse(sendCall.init.body);
    expect(body.saveToSentItems).toBe(false);
    expect(body.message).toEqual({
      subject: 'Halló',
      body: { contentType: 'HTML', content: '<p>x</p>' },
      toRecipients: [{ emailAddress: { address: 'anna@example.test' } }],
      replyTo: [{ emailAddress: { address: 'owner@example.test' } }],
    });
  });

  test('the token is cached until near expiry, per tenant/app', async () => {
    script.push(TOKEN_OK(), json(202, {}), json(202, {}));
    await mt.sendViaGraph(msg, { env: GRAPH_ENV });
    await mt.sendViaGraph(msg, { env: GRAPH_ENV });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['login.microsoftonline.com', 'graph.microsoft.com', 'graph.microsoft.com']);

    // Another app registration does not reuse it.
    script.push(json(200, { access_token: 'tok-B', expires_in: 3600 }), json(202, {}));
    await mt.sendViaGraph(msg, { env: { ...GRAPH_ENV, GRAPH_CLIENT_ID: 'client-2' } });
    expect(calls[4].init.headers.Authorization).toBe('Bearer tok-B');
  });

  test('a 401 on a cached token retries once with a fresh one', async () => {
    script.push(TOKEN_OK(), json(401, {}), json(200, { access_token: 'tok-C', expires_in: 3600 }), json(202, {}));
    const r = await mt.sendViaGraph(msg, { env: GRAPH_ENV });
    expect(r.error).toBeNull();
    expect(calls[3].init.headers.Authorization).toBe('Bearer tok-C');
  });

  test('a token failure maps to an error naming the AADSTS code, never the secret', async () => {
    script.push(json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' }));
    const r = await mt.sendViaGraph(msg, { env: GRAPH_ENV });
    expect(r.data).toBeNull();
    expect(r.error.message).toBe('Entra token request failed (401): AADSTS7000215: Invalid client secret provided.');
    expect(r.error.message).not.toContain('s3cret-value');
    expect(calls).toHaveLength(1);   // no sendMail attempted
  });

  test('a sendMail failure maps to the Graph error code and the request id', async () => {
    script.push(TOKEN_OK(), json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }));
    const r = await mt.sendViaGraph(msg, { env: GRAPH_ENV });
    expect(r.data).toBeNull();
    expect(r.error.message).toMatch(/^Graph sendMail failed: 403 ErrorAccessDenied Access is denied\. \(client-request-id [0-9a-f-]{36}\)$/);
  });
});

describe('through deliver() — the choke point still rules', () => {
  const KEYS = [...Object.keys(GRAPH_ENV), 'EMAIL_ALLOWLIST', 'RESEND_API_KEY'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  function load(extra = {}) {
    let svc;
    jest.isolateModules(() => {
      for (const k of KEYS) delete process.env[k];
      Object.assign(process.env, GRAPH_ENV, extra);
      svc = require('../../server/services/emailService');
      svc.__logger = require('../../server/logger');
    });
    return svc;
  }

  test('a sender returns the Graph request id; the health check names the transport', async () => {
    const svc = load();
    expect(svc.isConfigured()).toBe(true);
    expect(svc.emailHealthCheck()).toMatchObject({ transport: 'graph', transportConfigured: true });
    script.push(TOKEN_OK(), json(202, {}));
    const id = await svc.sendPasswordResetEmail('anna@example.test', 'tok', 'is');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(calls[1].init.body).message.toRecipients).toEqual([{ emailAddress: { address: 'anna@example.test' } }]);
  });

  test('EMAIL_ALLOWLIST rewrites the Graph recipients too', async () => {
    const svc = load({ EMAIL_ALLOWLIST: 'tester@example.test' });
    script.push(TOKEN_OK(), json(202, {}));
    await svc.sendPasswordResetEmail('real.customer@example.test', 'tok', 'is');
    expect(JSON.parse(calls[1].init.body).message.toRecipients).toEqual([{ emailAddress: { address: 'tester@example.test' } }]);
  });

  test('a failed Graph send is logged and alerted, and the sender throws', async () => {
    const svc = load();
    const logger = svc.__logger;
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    script.push(TOKEN_OK(), json(500, { error: { code: 'ErrorInternalServerError', message: 'boom' } }));
    await expect(svc.sendPasswordResetEmail('anna@example.test', 'tok', 'is')).rejects.toThrow(/Graph sendMail failed: 500 ErrorInternalServerError boom/);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ channel: 'generic', transport: 'graph' }), expect.stringMatching(/email send FAILED/));
    spy.mockRestore();
  });

  test('with the switch off, GRAPH_* alone leaves Resend in charge (and unconfigured without its key)', () => {
    const svc = load({ EMAIL_TRANSPORT: '' });
    expect(svc.emailHealthCheck()).toMatchObject({ transport: 'resend', transportConfigured: false });
    expect(svc.isConfigured()).toBe(false);
  });
});
