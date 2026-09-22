// config/appEnv.js — the one definition of "which environment is this", and of
// the derived "is this the test stack?" that gates the change-request submit
// door, skips its limiter, and decides what ssrMeta stamps for the client.
// The whole point of the module is that these agree, so pin the mapping.
const { appEnv, isTestStack, clientAppEnv, OPEN_ENVS } = require('../../server/config/appEnv');

const saved = { APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV };
function setEnv(appEnvValue, nodeEnvValue) {
  if (appEnvValue === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = appEnvValue;
  if (nodeEnvValue === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnvValue;
}
afterAll(() => setEnv(saved.APP_ENV, saved.NODE_ENV));

describe('appEnv()', () => {
  test('APP_ENV wins over NODE_ENV', () => { setEnv('test', 'production'); expect(appEnv()).toBe('test'); });
  test('falls back to NODE_ENV', () => { setEnv(undefined, 'development'); expect(appEnv()).toBe('development'); });
  test('defaults to production', () => { setEnv(undefined, undefined); expect(appEnv()).toBe('production'); });
  test('is read per call, not memoised (the integration tests flip it at runtime)', () => {
    setEnv('test', 'production'); expect(appEnv()).toBe('test');
    setEnv('staging', 'production'); expect(appEnv()).toBe('staging');
  });
});

describe('isTestStack()', () => {
  test('only test and development open the door', () => {
    expect([...OPEN_ENVS].sort()).toEqual(['development', 'test']);
    for (const v of ['test', 'development']) { setEnv(v, 'production'); expect(isTestStack()).toBe(true); }
    for (const v of ['production', 'staging', 'TEST', 'qa', '']) { setEnv(v || undefined, 'production'); expect(isTestStack()).toBe(false); }
  });
  test('the deployed TEST shape — APP_ENV=test with NODE_ENV=production — is the test stack', () => {
    setEnv('test', 'production'); expect(isTestStack()).toBe(true);
  });
});

describe('clientAppEnv() — what ssrMeta stamps', () => {
  test('every env the gate opens on is stamped as "test", so the client badge and the gate agree', () => {
    setEnv('development', 'production'); expect(clientAppEnv()).toBe('test');
    setEnv(undefined, 'development');    expect(clientAppEnv()).toBe('test');
    setEnv('test', 'production');        expect(clientAppEnv()).toBe('test');
  });
  test('an env the gate treats as live is stamped as itself — the client treats anything but "test" as production', () => {
    setEnv('staging', 'production');   expect(clientAppEnv()).toBe('staging');
    setEnv(undefined, 'staging');      expect(clientAppEnv()).toBe('staging'); // used to be stamped "test" → widget on, submits 404
    setEnv('production', 'production'); expect(clientAppEnv()).toBe('production');
  });
});
