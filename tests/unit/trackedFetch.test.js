'use strict';

// trackedFetch (server/observability/trackedFetch.js): same contract as
// fetch, plus one trackDependency call per outbound request when App Insights
// is live. Exercised with a fake client and a stubbed global fetch.
const aiClient = require('../../server/observability/aiClient');
const { trackedFetch, fetchNamed, dataOf, targetOf, resultCodeFor } = require('../../server/observability/trackedFetch');

const realFetch = global.fetch;
let deps;

function liveClient() {
  deps = [];
  jest.spyOn(aiClient, 'getClient').mockReturnValue({ trackDependency: d => deps.push(d) });
}

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  aiClient._reset();
});

describe('trackedFetch', () => {
  test('dark: without a client it is exactly fetch (no tracking, same result)', async () => {
    jest.spyOn(aiClient, 'getClient').mockReturnValue(null);
    const res = { ok: true, status: 200 };
    global.fetch = jest.fn().mockResolvedValue(res);
    await expect(trackedFetch('X', 'https://a.example/p', { method: 'POST' })).resolves.toBe(res);
    expect(global.fetch).toHaveBeenCalledWith('https://a.example/p', { method: 'POST' });
  });

  test('records a successful call as an HTTP dependency with the query string stripped', async () => {
    liveClient();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    const res = await trackedFetch('Graph sendMail', 'https://graph.microsoft.com/v1.0/users/x/sendMail?code=SECRET', {});
    expect(res.status).toBe(202);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      name: 'Graph sendMail',
      target: 'graph.microsoft.com',
      data: 'https://graph.microsoft.com/v1.0/users/x/sendMail',
      resultCode: '202',
      success: true,
      dependencyTypeName: 'HTTP',
      // survives the backend's "Web Service" rename of .asmx endpoints
      properties: { dependencyName: 'Graph sendMail' },
    });
    expect(typeof deps[0].duration).toBe('number');
    expect(JSON.stringify(deps[0])).not.toContain('SECRET');
  });

  test('a non-2xx response is recorded as a failed dependency but still returned', async () => {
    liveClient();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });
    const res = await trackedFetch('Regla SOAP CreateInvoice', 'https://regla.is/fibs/x.asmx', {});
    expect(res.status).toBe(502);
    expect(deps[0]).toMatchObject({ resultCode: '502', success: false, target: 'regla.is' });
  });

  test('a thrown AbortError is recorded as TIMEOUT and rethrown unchanged', async () => {
    liveClient();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    global.fetch = jest.fn().mockRejectedValue(abort);
    await expect(trackedFetch('Regla REST GET /x', 'https://regla.is/api/x', {})).rejects.toBe(abort);
    expect(deps[0]).toMatchObject({ resultCode: 'TIMEOUT', success: false });
  });

  test('a network error is recorded as NETWORK and rethrown', async () => {
    liveClient();
    const err = new TypeError('fetch failed');
    global.fetch = jest.fn().mockRejectedValue(err);
    await expect(trackedFetch('Alert webhook', 'https://hooks.example/abc', {})).rejects.toBe(err);
    expect(deps[0]).toMatchObject({ resultCode: 'NETWORK', success: false });
  });

  test('opts.data overrides the recorded URL — webhook tokens live in the PATH, not the query', async () => {
    liveClient();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const hook = 'https://hooks.slack.com/services/T000/B000/SECRETTOKEN';
    await trackedFetch('Alert webhook', hook, {}, { data: new URL(hook).origin + '/***' });
    expect(deps[0].data).toBe('https://hooks.slack.com/***');
    expect(JSON.stringify(deps[0])).not.toContain('SECRETTOKEN');
  });

  test('a throwing client never breaks the call', async () => {
    jest.spyOn(aiClient, 'getClient').mockReturnValue({ trackDependency() { throw new Error('sdk down'); } });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(trackedFetch('X', 'https://a.example/', {})).resolves.toMatchObject({ status: 200 });
  });

  test('fetchNamed binds a name and keeps the fetch signature (for SDK fetch options)', async () => {
    liveClient();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const f = fetchNamed('Anthropic messages (vision)');
    await f('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(deps[0]).toMatchObject({ name: 'Anthropic messages (vision)', target: 'api.anthropic.com' });
  });

  test('helpers', () => {
    expect(targetOf('https://x.example:8443/a?b=1')).toBe('x.example:8443');
    expect(dataOf('https://x.example/a/b?token=1')).toBe('https://x.example/a/b');
    expect(targetOf('not a url')).toBe('not a url');
    expect(resultCodeFor({ name: 'TimeoutError' })).toBe('TIMEOUT');
    expect(resultCodeFor(new Error('x'))).toBe('NETWORK');
  });
});
