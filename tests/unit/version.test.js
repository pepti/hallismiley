const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { readBuildInfo, buildInfo, isDevBuild, shortSha, DEV_BUILD } = require('../../server/config/version');
const generate = require('../../scripts/generate-version.js');

describe('readBuildInfo', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
  };

  test('reads a well-formed stamp', () => {
    const stamp = { version: '1.4.2', gitSha: 'abc123def456789', builtAt: '2026-08-10T03:00:00.000Z', channel: 'stable' };
    expect(readBuildInfo(write('ok.json', JSON.stringify(stamp)))).toEqual(stamp);
  });

  test('a missing file is the dev fallback, not an error', () => {
    expect(readBuildInfo(path.join(dir, 'absent.json'))).toEqual(DEV_BUILD);
  });

  test('a corrupt stamp falls back to dev rather than claiming a wrong version', () => {
    expect(readBuildInfo(write('bad.json', '{ nope'))).toEqual(DEV_BUILD);
  });

  test('missing or wrong-typed fields fall back field by field', () => {
    const file = write('partial.json', JSON.stringify({ version: '2.0.0', gitSha: 42, channel: '' }));
    expect(readBuildInfo(file)).toEqual({
      version: '2.0.0',
      gitSha:  'dev',
      builtAt: null,
      channel: 'dev',
    });
  });
});

describe('build identity singleton', () => {
  test('a checkout with no stamped build reports the dev identity', () => {
    // The repo never commits server/version.json — it is stamped at image build.
    expect(buildInfo).toEqual(DEV_BUILD);
    expect(isDevBuild).toBe(true);
  });

  test('the dev version is never mistaken for a release', () => {
    // Guards the rule the update checker depends on: a dev box must not decide
    // it is out of date against a published channel.
    expect(buildInfo.version).toBe('dev');
    expect(/^\d/.test(buildInfo.version)).toBe(false);
  });

  test('is frozen — a running process cannot rewrite its own identity', () => {
    expect(Object.isFrozen(buildInfo)).toBe(true);
    expect(() => { buildInfo.version = '9.9.9'; }).toThrow(TypeError);
    expect(buildInfo.version).toBe('dev');
  });

  test('shortSha truncates for display', () => {
    expect(shortSha('0123456789abcdef0123')).toBe('0123456789ab');
    expect(shortSha('')).toBe('');
    expect(shortSha(null)).toBe('');
  });
});

describe('generate-version', () => {
  const ENV_KEYS = ['APP_VERSION', 'GIT_SHA', 'BUILT_AT', 'RELEASE_CHANNEL'];
  let saved;
  beforeEach(() => { saved = {}; for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test('build args win over every default', () => {
    process.env.APP_VERSION     = '1.4.2';
    process.env.GIT_SHA         = 'deadbeefdeadbeefdeadbeef';
    process.env.BUILT_AT        = '2026-08-10T03:00:00.000Z';
    process.env.RELEASE_CHANNEL = 'canary';
    expect(generate.build()).toEqual({
      version: '1.4.2',
      gitSha:  'deadbeefdeadbeefdeadbeef',
      builtAt: '2026-08-10T03:00:00.000Z',
      channel: 'canary',
    });
  });

  test('version defaults to package.json and channel to dev', () => {
    const pkg = require('../../package.json');
    const info = generate.build();
    expect(info.version).toBe(pkg.version);
    expect(info.channel).toBe('dev');
    expect(() => new Date(info.builtAt).toISOString()).not.toThrow();
  });

  test('gitSha resolves from the checkout when no build arg is given', () => {
    // In a git checkout this is a real sha; in a bare Docker context it is the
    // literal "unknown". Both are acceptable — a wrong sha would not be.
    const sha = generate.build().gitSha;
    expect(sha === 'unknown' || /^[0-9a-f]{40}$/.test(sha)).toBe(true);
  });

  test('writes to server/version.json, which the app reads back', () => {
    expect(generate.OUT.replace(/\\/g, '/')).toMatch(/\/server\/version\.json$/);
  });
});
