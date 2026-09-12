/**
 * The canonical-host redirect in server/app.js must follow APP_URL, not a
 * literal — an instance on another domain would otherwise 301 every
 * production request to hallismiley.is (that is what orangesmiley hit).
 * No database, no app boot: this is the pure resolver.
 */
const { resolveCanonicalHost, DEFAULT_HOST } = require('../../server/utils/canonicalHost');

describe('resolveCanonicalHost', () => {
  test('falls back to the base host when APP_URL is unset or blank', () => {
    expect(DEFAULT_HOST).toBe('www.hallismiley.is');
    expect(resolveCanonicalHost(undefined)).toBe(DEFAULT_HOST);
    expect(resolveCanonicalHost('')).toBe(DEFAULT_HOST);
    expect(resolveCanonicalHost('   ')).toBe(DEFAULT_HOST);
    expect(resolveCanonicalHost(null)).toBe(DEFAULT_HOST);
  });

  test('uses the host of APP_URL, lower-cased, path and trailing slash dropped', () => {
    expect(resolveCanonicalHost('https://www.orangesmiley.is')).toBe('www.orangesmiley.is');
    expect(resolveCanonicalHost('https://WWW.Example.IS/')).toBe('www.example.is');
    expect(resolveCanonicalHost('https://www.example.is/some/path?x=1')).toBe('www.example.is');
  });

  test('keeps an explicit port so a local production-mode boot still resolves', () => {
    expect(resolveCanonicalHost('http://localhost:3000')).toBe('localhost:3000');
  });

  test('a SET but unparsable APP_URL throws (fail closed) instead of redirecting to the base host', () => {
    // "www.example.is" with no scheme is the realistic typo; silently falling
    // back would aim every production request of that instance at
    // hallismiley.is — the defect this resolver exists to remove.
    expect(() => resolveCanonicalHost('not a url')).toThrow(/APP_URL is set but/);
    expect(() => resolveCanonicalHost('www.example.is')).toThrow(/www\.example\.is/);
    expect(() => resolveCanonicalHost('https://')).toThrow(TypeError);
  });

  test('a custom fallback is honoured', () => {
    expect(resolveCanonicalHost('', 'x.example')).toBe('x.example');
  });
});
