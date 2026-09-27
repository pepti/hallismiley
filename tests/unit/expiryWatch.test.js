/**
 * scripts/expiry-watch.js — the judging half of the weekly secret/certificate
 * watch (.github/workflows/secret-cert-watch.yml; ported from icelandicstore
 * #90, harvest 2 lane 9). The workflow only gathers inputs; every threshold,
 * the "no expiry stamp" rule and the host validation are pinned here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { daysUntil, parseHosts, judgeCert, judgeSecret, run } = require('../../scripts/expiry-watch');

const NOW = new Date('2026-09-26T12:00:00Z');
const inDays = (d) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe('daysUntil', () => {
  test('whole days, negative once past, null when unparseable', () => {
    expect(daysUntil(inDays(30), NOW)).toBe(30);
    expect(daysUntil(inDays(-2), NOW)).toBe(-2);
    // openssl / Node valid_to form
    expect(daysUntil('Mar 22 23:59:59 2027 GMT', NOW)).toBe(177);
    expect(daysUntil('not a date', NOW)).toBeNull();
  });
});

describe('parseHosts', () => {
  test('space- or comma-separated, optional port, lower-cased', () => {
    expect(parseHosts('www.Example.is, example.is  api.example.is:8443')).toEqual([
      { host: 'www.example.is', port: 443 },
      { host: 'example.is', port: 443 },
      { host: 'api.example.is', port: 8443 },
    ]);
    expect(parseHosts('')).toEqual([]);
    expect(parseHosts(undefined)).toEqual([]);
  });

  test.each([
    'https://example.is', 'example.is/path', '-bad.is', 'a.is:0', 'a.is:99999', 'a.is;rm', '$(id).is',
  ])('refuses %p', (entry) => {
    expect(() => parseHosts(entry)).toThrow(/WATCH_HOSTS entry/);
  });
});

describe('judgeCert — 21-day window', () => {
  const opts = { warnDays: 21, now: NOW };
  test('outside the window, trusted → no finding', () => {
    expect(judgeCert({ host: 'a.is', validTo: inDays(60), authorized: true }, opts)).toBeNull();
    expect(judgeCert({ host: 'a.is', validTo: inDays(21), authorized: true }, opts)).toBeNull();
  });
  test('inside the window → renewal failed', () => {
    expect(judgeCert({ host: 'a.is', validTo: inDays(20), authorized: true }, opts))
      .toEqual({ subject: 'tls/a.is', message: expect.stringMatching(/expires in 20d .*renewal may have FAILED/) });
  });
  test('expired, unreadable, and untrusted are findings', () => {
    expect(judgeCert({ host: 'a.is', validTo: inDays(-3) }, opts).message).toMatch(/EXPIRED 3d ago/);
    expect(judgeCert({ host: 'a.is', error: 'ECONNREFUSED' }, opts).message).toMatch(/could not read the certificate \(ECONNREFUSED\)/);
    expect(judgeCert({ host: 'a.is', validTo: 'garbage' }, opts).message).toMatch(/unreadable expiry/);
    expect(judgeCert({ host: 'a.is', validTo: inDays(90), authorized: false, authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID' }, opts).message)
      .toMatch(/not trusted: ERR_TLS_CERT_ALTNAME_INVALID/);
  });
});

describe('judgeSecret — 30-day window', () => {
  const opts = { warnDays: 30, now: NOW };
  const s = (expires, extra = {}) => ({ vault: 'kv', name: 'csrf-secret', expires, ...extra });
  test('outside the window → no finding', () => {
    expect(judgeSecret(s(inDays(31)), opts)).toBeNull();
    expect(judgeSecret(s(inDays(30)), opts)).toBeNull();
  });
  test('inside the window, expired → findings named vault/secret', () => {
    expect(judgeSecret(s(inDays(29)), opts)).toEqual({ subject: 'kv/csrf-secret', message: expect.stringMatching(/expires in 29d/) });
    expect(judgeSecret(s(inDays(-1)), opts).message).toMatch(/EXPIRED 1d ago/);
  });
  test.each([null, undefined, '', 'None'])('no expiry stamp (%p) is a finding', (expires) => {
    expect(judgeSecret(s(expires), opts).message).toMatch(/no expiry stamp/);
  });
  test('a disabled secret is ignored', () => {
    expect(judgeSecret(s(null, { enabled: false }), opts)).toBeNull();
  });
});

describe('run', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l9-expiry-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('nothing configured → green, both halves say they skipped', async () => {
    const lines = [];
    const out = path.join(dir, 'out');
    const findings = await run({ env: { GITHUB_OUTPUT: out }, now: NOW, log: (l) => lines.push(l) });
    expect(findings).toEqual([]);
    expect(fs.readFileSync(out, 'utf8')).toBe('found=false\n');
    expect(lines.join('\n')).toMatch(/TLS: no hosts to watch/);
    expect(lines.join('\n')).toMatch(/Key Vault: no secret list/);
  });

  test('findings reach the file and the output; values are never read', async () => {
    const secrets = path.join(dir, 'secrets.json');
    fs.writeFileSync(secrets, JSON.stringify([
      { vault: 'kv', name: 'ok', expires: inDays(100), enabled: true },
      { vault: 'kv', name: 'soon', expires: inDays(5), enabled: true },
      { vault: 'kv', name: 'forever', expires: null, enabled: true },
    ]));
    const findingsFile = path.join(dir, 'findings.txt');
    const out = path.join(dir, 'out');
    const read = async ({ host }) => (host === 'good.is'
      ? { host, validTo: inDays(80), authorized: true }
      : { host, validTo: inDays(10), authorized: true });
    const findings = await run({
      env: { WATCH_HOSTS: 'good.is bad.is', SECRETS_JSON: secrets, FINDINGS_FILE: findingsFile, GITHUB_OUTPUT: out },
      now: NOW, log: () => {}, read,
    });
    expect(findings.map((f) => f.subject)).toEqual(['tls/bad.is', 'kv/soon', 'kv/forever']);
    expect(fs.readFileSync(findingsFile, 'utf8').trim().split('\n')).toHaveLength(3);
    expect(fs.readFileSync(out, 'utf8')).toBe('found=true\n');
  });

  test('the thresholds are overridable (the dispatch input) and validated', async () => {
    const read = async ({ host }) => ({ host, validTo: inDays(100), authorized: true });
    const f = await run({ env: { WATCH_HOSTS: 'a.is', TLS_WARN_DAYS: '400' }, now: NOW, log: () => {}, read });
    expect(f).toHaveLength(1);
    await expect(run({ env: { TLS_WARN_DAYS: 'lots' }, now: NOW, log: () => {} })).rejects.toThrow(/whole number/);
  });
});

describe('secret-cert-watch.yml', () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '../../.github/workflows/secret-cert-watch.yml'), 'utf8'));
  const on = doc.on || doc[true];
  const steps = doc.jobs.watch.steps;
  const text = JSON.stringify(doc);

  test('runs weekly and on demand', () => {
    expect(on.schedule[0].cron).toMatch(/^\S+ \S+ \* \* \d$/);
    expect(on.workflow_dispatch).toBeTruthy();
  });

  test('reads hosts and vaults from repository variables and judges in the script', () => {
    expect(text).toContain('vars.WATCH_HOSTS');
    expect(text).toContain('vars.WATCH_KEY_VAULTS');
    expect(steps.find((s) => s.id === 'scan').run).toBe('node scripts/expiry-watch.js');
  });

  test('the Azure half is optional: login and listing run only when armed', () => {
    const login = steps.find((s) => /^azure\/login@/.test(s.uses || ''));
    expect(login.if).toBe("steps.plan.outputs.kv == 'true'");
    expect(steps.find((s) => s.name === 'List vault secret metadata').if).toBe("steps.plan.outputs.kv == 'true'");
    expect(doc.jobs.watch.permissions['id-token']).toBe('write');
    // Metadata only — never `secret show`, which returns the value.
    expect(text).not.toMatch(/keyvault secret show/);
  });

  test('findings email (when configured) and then fail the run', () => {
    const last = steps[steps.length - 1];
    expect(last.if).toBe("steps.scan.outputs.found == 'true'");
    expect(last.run).toMatch(/exit 1/);
  });
});
