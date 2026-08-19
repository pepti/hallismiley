// Integration tests for the update checker (real Postgres, per the invariants).
//
// Everything the checker talks to is injected — settings, build identity, fetch,
// clock — so these exercise the real ledger writes without a network or a wall
// clock. The one thing NOT injected is the outbound allowlist: it must sit in
// the path even when fetch is a stub, or the guard would be untested theatre.
const db = require('../../server/config/database');
const { checkOnce, validateManifest } = require('../../server/services/updateChecker');
const SystemUpdate = require('../../server/models/SystemUpdate');

const HOST = 'releases.orangesmiley.is';
const RUNNING = { version: '1.4.0', gitSha: 'abc', builtAt: '2026-08-01T00:00:00Z', channel: 'stable' };

const settings = (over = {}) => ({
  mode: 'managed',
  channel: 'stable',
  manifestUrl: `https://${HOST}/store/{channel}.json`,
  allowCriticalOutsideWindow: true,
  maintenanceWindow: { days: ['tue', 'wed', 'thu'], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' },
  managed: false,
  ...over,
});

const manifest = (over = {}) => ({
  version: '1.4.2',
  imageDigest: 'sha256:' + 'a'.repeat(64),
  publishedAt: '2026-08-09T12:00:00.000Z',
  minCompatibleVersion: '1.3.0',
  changelogMd: '## 1.4.2\n\n- Fixed the thing',
  critical: false,
  ...over,
});

/** A fetch stub in the shape the checker consumes. */
const respond = (body, { status = 200, contentLength = null } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-length' ? contentLength : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const silent = { info() {}, warn() {}, error() {}, debug() {} };

// 2026-08-10 12:00Z is a Monday — outside the Tue/Wed/Thu 03–05 window.
const MONDAY_NOON = new Date('2026-08-10T12:00:00Z');

const run = (over = {}) => checkOnce({
  settings: settings(),
  build: RUNNING,
  fetchImpl: respond(manifest()),
  now: MONDAY_NOON,
  log: silent,
  ...over,
});

beforeEach(async () => {
  await db.query('TRUNCATE TABLE system_updates RESTART IDENTITY');
});

describe('new-version detection', () => {
  test('records a newer release as available', async () => {
    const res = await run();
    expect(res.outcome).toBe('recorded');
    expect(res.update).toMatchObject({
      version: '1.4.2',
      image_digest: 'sha256:' + 'a'.repeat(64),
      channel: 'stable',
      status: 'available',
      changelog_md: '## 1.4.2\n\n- Fixed the thing',
    });
    expect(res.update.detail).toMatchObject({
      publishedAt: '2026-08-09T12:00:00.000Z',
      critical: false,
      compatible: true,
      discoveredFromVersion: '1.4.0',
    });
  });

  test('the running version is not an update', async () => {
    const res = await run({ fetchImpl: respond(manifest({ version: '1.4.0' })) });
    expect(res.outcome).toBe('up-to-date');
    expect(await SystemUpdate.listRecent()).toEqual([]);
  });

  test('an OLDER published version is not an update either', async () => {
    const res = await run({ fetchImpl: respond(manifest({ version: '1.3.9' })) });
    expect(res.outcome).toBe('up-to-date');
    expect(await SystemUpdate.listRecent()).toEqual([]);
  });

  test('a dev build never checks — it has no release identity to compare', async () => {
    const res = await run({ build: { ...RUNNING, version: 'dev' } });
    expect(res.outcome).toBe('skipped-dev');
    expect(await SystemUpdate.listRecent()).toEqual([]);
  });

  test('the channel is part of the identity — the same version on canary is a separate row', async () => {
    await run();
    await run({ settings: settings({ channel: 'canary' }) });
    const rows = await SystemUpdate.listRecent();
    expect(rows.map(r => r.channel).sort()).toEqual(['canary', 'stable']);
  });
});

describe('idempotent re-checks', () => {
  test('re-reading an unchanged manifest does not grow the table', async () => {
    await run(); await run(); await run();
    const rows = await SystemUpdate.listRecent();
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('1.4.2');
  });

  test('a re-published digest updates the row in place while it is still actionable', async () => {
    await run();
    const digest = 'sha256:' + 'b'.repeat(64);
    await run({ fetchImpl: respond(manifest({ imageDigest: digest })) });
    const rows = await SystemUpdate.listRecent();
    expect(rows).toHaveLength(1);
    expect(rows[0].image_digest).toBe(digest);
  });

  test('history is not rewritten — an applied row ignores a later manifest edit', async () => {
    const { update } = await run();
    await SystemUpdate.markApplying(update.id, 'sha256:' + 'c'.repeat(64));
    await SystemUpdate.markApplied(update.id);

    await run({ fetchImpl: respond(manifest({ imageDigest: 'sha256:' + 'd'.repeat(64) })) });

    const row = await SystemUpdate.findById(update.id);
    expect(row.status).toBe('applied');
    expect(row.image_digest).toBe('sha256:' + 'a'.repeat(64));   // unchanged
  });
});

describe('mode gating', () => {
  test('managed records but never schedules — visibility without controls', async () => {
    const res = await run({ settings: settings({ mode: 'managed' }) });
    expect(res.update.status).toBe('available');
    expect(res.update.detail.scheduledFor).toBeUndefined();
  });

  test('manual records but never schedules — the admin presses the button', async () => {
    const res = await run({ settings: settings({ mode: 'manual' }) });
    expect(res.update.status).toBe('available');
    expect(res.update.detail.scheduledFor).toBeUndefined();
  });

  test('auto schedules into the next maintenance window', async () => {
    const res = await run({ settings: settings({ mode: 'auto' }) });
    expect(res.update.status).toBe('scheduled');
    // Monday noon → the Tuesday 03:00 window.
    expect(res.update.detail.scheduledFor).toBe('2026-08-11T03:00:00.000Z');
  });

  test('auto + critical applies immediately when the instance permits it', async () => {
    const res = await run({
      settings: settings({ mode: 'auto' }),
      fetchImpl: respond(manifest({ critical: true })),
    });
    expect(res.update.status).toBe('scheduled');
    expect(res.update.detail.scheduledFor).toBe(MONDAY_NOON.toISOString());
  });

  test('auto + critical still waits for the window when the instance forbids the bypass', async () => {
    const res = await run({
      settings: settings({ mode: 'auto', allowCriticalOutsideWindow: false }),
      fetchImpl: respond(manifest({ critical: true })),
    });
    expect(res.update.detail.scheduledFor).toBe('2026-08-11T03:00:00.000Z');
  });

  test('auto with an impossible window leaves the update for a human', async () => {
    const res = await run({
      settings: settings({ mode: 'auto', maintenanceWindow: { days: [], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' } }),
    });
    expect(res.update.status).toBe('available');
  });
});

describe('compatibility gating', () => {
  test('an update that cannot be reached in one hop is recorded but never auto-scheduled', async () => {
    // Running 1.4.0, published release needs at least 1.5.0 to upgrade FROM.
    const res = await run({
      settings: settings({ mode: 'auto' }),
      fetchImpl: respond(manifest({ version: '2.0.0', minCompatibleVersion: '1.5.0' })),
    });
    expect(res.update.status).toBe('available');           // visible…
    expect(res.update.detail.compatible).toBe(false);      // …but not self-applied
    expect(res.update.detail.minCompatibleVersion).toBe('1.5.0');
  });

  test('a release with no minCompatibleVersion is treated as reachable', async () => {
    const m = manifest({ version: '2.0.0' });
    delete m.minCompatibleVersion;
    const res = await run({ settings: settings({ mode: 'auto' }), fetchImpl: respond(m) });
    expect(res.update.detail.compatible).toBe(true);
    expect(res.update.status).toBe('scheduled');
  });
});

describe('malformed manifests are rejected, not recorded', () => {
  const rejects = async (body, fragment) => {
    const res = await run({ fetchImpl: respond(body) });
    expect(res.outcome).toBe('invalid-manifest');
    expect(res.reason).toContain(fragment);
    expect(await SystemUpdate.listRecent()).toEqual([]);
  };

  test('a non-semver version', () => rejects(manifest({ version: 'latest' }), 'not semver'));
  test('a digest that is not sha256:<64 hex>', () => rejects(manifest({ imageDigest: 'sha256:short' }), 'imageDigest'));
  test('a tag masquerading as a digest', () => rejects(manifest({ imageDigest: 'v1.4.2' }), 'imageDigest'));
  test('an unparseable publishedAt', () => rejects(manifest({ publishedAt: 'whenever' }), 'ISO 8601'));
  test('a non-boolean critical flag', () => rejects(manifest({ critical: 'yes' }), 'critical'));
  test('a non-semver minCompatibleVersion', () => rejects(manifest({ minCompatibleVersion: '1.x' }), 'minCompatibleVersion'));
  test('an oversized changelog', () => rejects(manifest({ changelogMd: 'x'.repeat(65 * 1024) }), 'exceeds'));
  test('a JSON array instead of an object', () => rejects([manifest()], 'not a JSON object'));

  test('body that is not JSON at all', async () => {
    const res = await run({ fetchImpl: respond('<html>404</html>') });
    expect(res.outcome).toBe('fetch-failed');
    expect(res.reason).toContain('not valid JSON');
    expect(await SystemUpdate.listRecent()).toEqual([]);
  });

  test('validateManifest reports every problem at once, not just the first', () => {
    const res = validateManifest({ version: 'nope', imageDigest: 'nope', publishedAt: 'nope' });
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(3);
  });
});

describe('transport failures are survivable, never fatal', () => {
  test('a non-200 is a warning, not a throw', async () => {
    const res = await run({ fetchImpl: respond('', { status: 503 }) });
    expect(res.outcome).toBe('fetch-failed');
    expect(res.reason).toContain('503');
  });

  test('a redirect is refused rather than followed off the allowlist', async () => {
    const res = await run({ fetchImpl: respond('', { status: 302 }) });
    expect(res.outcome).toBe('fetch-failed');
    expect(res.reason).toContain('redirect');
  });

  test('an oversized body is refused on the declared length', async () => {
    const res = await run({ fetchImpl: respond(manifest(), { contentLength: String(10 * 1024 * 1024) }) });
    expect(res.outcome).toBe('fetch-failed');
    expect(res.reason).toContain('too large');
  });

  test('a body that lies about its length is still refused', async () => {
    const res = await run({ fetchImpl: respond('x'.repeat(300 * 1024)) });
    expect(res.outcome).toBe('fetch-failed');
    expect(res.reason).toContain('too large');
  });

  test('a thrown fetch (DNS, timeout) is a warning, not a crash', async () => {
    const res = await run({ fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
    expect(res.outcome).toBe('fetch-failed');
    expect(res.reason).toContain('ENOTFOUND');
  });
});

describe('the allowlist sits in the path', () => {
  test('a manifest URL pointed off the allowlist is never fetched', async () => {
    let called = false;
    const res = await run({
      settings: settings({ manifestUrl: 'https://evil.example.com/{channel}.json' }),
      fetchImpl: async () => { called = true; throw new Error('should not run'); },
    });
    expect(res.outcome).toBe('blocked');
    expect(called).toBe(false);
    expect(await SystemUpdate.listRecent()).toEqual([]);
  });

  test('a plaintext manifest URL is blocked before the request', async () => {
    const res = await run({ settings: settings({ manifestUrl: `http://${HOST}/{channel}.json` }) });
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('https');
  });

  test('the channel placeholder is substituted before the check', async () => {
    const seen = [];
    await run({
      settings: settings({ channel: 'canary' }),
      fetchImpl: async (url) => { seen.push(url); return (await respond(manifest())()); },
    });
    expect(seen).toEqual([`https://${HOST}/store/canary.json`]);
  });
});
