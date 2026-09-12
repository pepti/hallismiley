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

  test('an unparsable APP_URL falls back instead of throwing at boot', () => {
    expect(resolveCanonicalHost('not a url')).toBe(DEFAULT_HOST);
    expect(resolveCanonicalHost('www.example.is')).toBe(DEFAULT_HOST); // no scheme → not a URL
  });

  test('a custom fallback is honoured', () => {
    expect(resolveCanonicalHost('', 'x.example')).toBe('x.example');
  });
});
