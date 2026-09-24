'use strict';

// pino → App Insights forwarder (server/observability/aiLogStream.js).
// Runs against a fake client: no SDK, no connection string.
const { createAiLogStream, severityFor, SEVERITY } = require('../../server/observability/aiLogStream');
const aiClient = require('../../server/observability/aiClient');

function fakeClient() {
  const calls = { traces: [], exceptions: [] };
  return {
    calls,
    trackTrace(t) { calls.traces.push(t); },
    trackException(e) { calls.exceptions.push(e); },
  };
}

function line(obj) { return JSON.stringify({ level: 30, time: 1, pid: 1, hostname: 'h', ...obj }) + '\n'; }

describe('aiLogStream', () => {
  test('is a no-op when there is no client (telemetry dark)', () => {
    const stream = createAiLogStream({ getClient: () => null });
    expect(() => stream.write(line({ level: 50, msg: 'boom' }))).not.toThrow();
  });

  test('forwards warn lines as traces with Warning severity and string-valued properties', () => {
    const client = fakeClient();
    const stream = createAiLogStream({ getClient: () => client });
    stream.write(line({
      level: 40, msg: 'Regla send-invoice failed',
      requestId: 'r1', reglaMessages: ['ERROR_PRODUCT_NAME_TOO_LONG'], orderId: 'o1',
    }));
    expect(client.calls.traces).toHaveLength(1);
    const t = client.calls.traces[0];
    expect(t.message).toBe('Regla send-invoice failed');
    expect(t.severity).toBe(SEVERITY.Warning);
    expect(t.properties.requestId).toBe('r1');
    expect(t.properties.orderId).toBe('o1');
    expect(t.properties.reglaMessages).toBe(JSON.stringify(['ERROR_PRODUCT_NAME_TOO_LONG']));
    // pino housekeeping fields are not forwarded as dimensions
    expect(t.properties.pid).toBeUndefined();
    expect(t.properties.hostname).toBeUndefined();
  });

  test('error lines with a serialised err become exceptions carrying the stack', () => {
    const client = fakeClient();
    const stream = createAiLogStream({ getClient: () => client });
    stream.write(line({
      level: 50, msg: 'Unhandled request error',
      err: { type: 'TypeError', message: 'x is not a function', stack: 'TypeError: x is not a function\n    at a.js:1' },
      requestId: 'r2',
    }));
    expect(client.calls.traces).toHaveLength(0);
    expect(client.calls.exceptions).toHaveLength(1);
    const e = client.calls.exceptions[0];
    expect(e.exception).toBeInstanceOf(Error);
    expect(e.exception.message).toBe('x is not a function');
    expect(e.exception.stack).toContain('at a.js:1');
    expect(e.severity).toBe(SEVERITY.Error);
    expect(e.properties.message).toBe('Unhandled request error');
    expect(e.properties.requestId).toBe('r2');
  });

  test('drops info lines and pino-http 4xx completions, keeps 5xx completions', () => {
    const client = fakeClient();
    const stream = createAiLogStream({ getClient: () => client });
    stream.write(line({ level: 30, msg: 'request completed', res: { statusCode: 200 } }));
    stream.write(line({ level: 40, msg: 'request completed', res: { statusCode: 404 } }));
    stream.write(line({ level: 50, msg: 'request errored', res: { statusCode: 502 } }));
    expect(client.calls.traces.map(t => t.message)).toEqual(['request errored']);
  });

  test('ignores lines that are not JSON and never throws when the client throws', () => {
    const client = { trackTrace() { throw new Error('sdk down'); }, trackException() { throw new Error('sdk down'); } };
    const stream = createAiLogStream({ getClient: () => client });
    expect(() => stream.write('not json\n')).not.toThrow();
    expect(() => stream.write(line({ level: 40, msg: 'warn' }))).not.toThrow();
  });

  test('severity mapping follows pino levels', () => {
    expect(severityFor(20)).toBe(SEVERITY.Verbose);
    expect(severityFor(30)).toBe(SEVERITY.Information);
    expect(severityFor(40)).toBe(SEVERITY.Warning);
    expect(severityFor(50)).toBe(SEVERITY.Error);
    expect(severityFor(60)).toBe(SEVERITY.Critical);
  });
});

describe('aiClient.getClient()', () => {
  afterEach(() => aiClient._reset());

  test('returns null without a connection string and never loads the SDK', () => {
    const orig = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    try {
      expect(aiClient.getClient()).toBeNull();
    } finally {
      if (orig !== undefined) process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = orig;
    }
  });
});
