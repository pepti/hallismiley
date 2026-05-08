'use strict';

/**
 * Unit tests for server/auth/oauthHelpers.js.
 * Stubs the database module so generateUniqueUsername can be exercised
 * without a live Postgres — each test scripts the sequence of rows() the
 * uniqueness probe will see.
 */

jest.mock('../../server/config/database', () => ({
  query: jest.fn(),
}));

const { query: dbQuery } = require('../../server/config/database');
const { generateUniqueUsername, isSafeReturnTo } = require('../../server/auth/oauthHelpers');

// Default: the candidate is always free (no row found).
function mockUsernameFree() {
  dbQuery.mockResolvedValue({ rows: [] });
}

beforeEach(() => {
  dbQuery.mockReset();
  mockUsernameFree();
});

describe('generateUniqueUsername', () => {
  test('lowercases an ASCII display name', async () => {
    const username = await generateUniqueUsername('john@example.com', 'John Doe');
    expect(username).toBe('johndoe');
  });

  test('preserves Icelandic letters in lowercase', async () => {
    const username = await generateUniqueUsername('jon@example.is', 'Jón Þórsson');
    expect(username).toBe('jónþórsson');
  });

  test('preserves all 10 lowercase Icelandic letters', async () => {
    const username = await generateUniqueUsername(
      'a@b.c',
      'Áéíóú Ýðþæö',
    );
    expect(username).toBe('áéíóúýðþæö');
  });

  test('handles mixed Icelandic + ASCII', async () => {
    const username = await generateUniqueUsername('a@b.c', 'Anna Þórsdóttir');
    expect(username).toBe('annaþórsdóttir');
  });

  test('falls back to email local-part when name is empty', async () => {
    const username = await generateUniqueUsername('alice.smith@example.com', '');
    expect(username).toBe('alicesmith');
  });

  test('falls back to email local-part when name is null', async () => {
    const username = await generateUniqueUsername('bob@example.com', null);
    expect(username).toBe('bob');
  });

  test('falls back to "user" when both name and email yield nothing usable', async () => {
    // Email split('@')[0] is "!!!" which strips to '' → triggers 'user' fallback.
    const username = await generateUniqueUsername('!!!@example.com', '');
    expect(username).toBe('user');
  });

  test('truncates a long name to 40 chars', async () => {
    const longName = 'a'.repeat(60);
    const username = await generateUniqueUsername('x@y.z', longName);
    expect(username).toHaveLength(40);
    expect(username).toBe('a'.repeat(40));
  });

  test('truncates a long Icelandic name to 40 chars', async () => {
    // 25 Icelandic chars + 25 ASCII = 50 chars before truncation
    const longName = 'þórsson '.repeat(7);
    const username = await generateUniqueUsername('x@y.z', longName);
    expect(username).toHaveLength(40);
    expect(username.startsWith('þórsson')).toBe(true);
  });

  test('pads a short stripped name to ≥ 3 chars', async () => {
    // "Al" strips to "al" (2 chars) — should be padded with "123".
    const username = await generateUniqueUsername('x@y.z', 'Al');
    expect(username).toBe('al123');
    expect(username.length).toBeGreaterThanOrEqual(3);
  });

  test('pads a 1-char Icelandic name to ≥ 3 chars', async () => {
    const username = await generateUniqueUsername('x@y.z', 'Þ');
    expect(username).toBe('þ123');
  });

  test('appends a random hex suffix when the base username is taken', async () => {
    // First probe: "johndoe" is taken. Second probe: any candidate is free.
    dbQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const username = await generateUniqueUsername('john@example.com', 'John Doe');
    // "johndoe" + 4 hex chars (2 random bytes → 4 hex chars).
    expect(username).toMatch(/^johndoe[0-9a-f]{4}$/);
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  test('falls back to user_<hex> after 5 collisions', async () => {
    // Every probe returns a hit — the loop exhausts and the fallback path runs.
    dbQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const username = await generateUniqueUsername('john@example.com', 'John Doe');
    expect(username).toMatch(/^user_[0-9a-f]{12}$/);
    expect(dbQuery).toHaveBeenCalledTimes(5);
  });

  test('strips spaces and punctuation but keeps letters and digits', async () => {
    const username = await generateUniqueUsername('x@y.z', "John  O'Brien-3rd!");
    expect(username).toBe('johnobrien3rd');
  });

  test('returns a username that satisfies the signup USERNAME_RE', async () => {
    // Regex is exported from validate.js indirectly — recreate the rule here
    // to lock down the contract: any value generateUniqueUsername returns
    // (in the happy path) must pass server-side signup validation.
    const USERNAME_RE = /^[a-zA-Z0-9_áéíóúýðþæöÁÉÍÓÚÝÐÞÆÖ]{3,40}$/;
    const cases = [
      ['john@example.com', 'John Doe'],
      ['jon@example.is',   'Jón Þórsson'],
      ['anna@example.is',  'Anna Þórsdóttir'],
      ['x@y.z',            'a'.repeat(60)],
      ['x@y.z',            'Al'],
    ];
    for (const [email, name] of cases) {
      const username = await generateUniqueUsername(email, name);
      expect(username).toMatch(USERNAME_RE);
    }
  });
});

describe('isSafeReturnTo', () => {
  test('accepts a simple absolute path', () => {
    expect(isSafeReturnTo('/party')).toBe(true);
  });

  test('accepts a locale-prefixed path', () => {
    expect(isSafeReturnTo('/is/party')).toBe(true);
    expect(isSafeReturnTo('/en/projects/123')).toBe(true);
  });

  test('accepts a path with query string', () => {
    expect(isSafeReturnTo('/shop?category=mugs')).toBe(true);
  });

  test('accepts a bare slash', () => {
    expect(isSafeReturnTo('/')).toBe(true);
  });

  test('rejects protocol-relative URLs (open redirect via //)', () => {
    expect(isSafeReturnTo('//evil.com/phish')).toBe(false);
    expect(isSafeReturnTo('//evil.com')).toBe(false);
  });

  test('rejects absolute URLs with http(s) scheme', () => {
    expect(isSafeReturnTo('http://evil.com')).toBe(false);
    expect(isSafeReturnTo('https://evil.com')).toBe(false);
  });

  test('rejects javascript: and data: schemes', () => {
    expect(isSafeReturnTo('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnTo('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  test('rejects mailto: and other schemes', () => {
    expect(isSafeReturnTo('mailto:foo@bar.com')).toBe(false);
    expect(isSafeReturnTo('tel:+15551234')).toBe(false);
  });

  test('rejects relative paths (must start with /)', () => {
    expect(isSafeReturnTo('party')).toBe(false);
    expect(isSafeReturnTo('./party')).toBe(false);
    expect(isSafeReturnTo('../party')).toBe(false);
  });

  test('rejects empty / nullish values', () => {
    expect(isSafeReturnTo('')).toBe(false);
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isSafeReturnTo(123)).toBe(false);
    expect(isSafeReturnTo({})).toBe(false);
    expect(isSafeReturnTo([])).toBe(false);
    expect(isSafeReturnTo(true)).toBe(false);
  });

  test('rejects values longer than 500 chars', () => {
    const long = '/' + 'a'.repeat(500);
    expect(long.length).toBe(501);
    expect(isSafeReturnTo(long)).toBe(false);
  });

  test('accepts values up to 500 chars', () => {
    const exact = '/' + 'a'.repeat(499);
    expect(exact.length).toBe(500);
    expect(isSafeReturnTo(exact)).toBe(true);
  });

  test('rejects embedded :// even after a leading /', () => {
    // Prevents "/redirect?next=https://evil.com" from sneaking through.
    expect(isSafeReturnTo('/redirect?next=https://evil.com')).toBe(false);
  });

  test('rejects backslash (browsers normalize \\ → /, turning /\\evil.com into //evil.com)', () => {
    expect(isSafeReturnTo('/\\evil.com')).toBe(false);
    expect(isSafeReturnTo('/\\\\evil.com')).toBe(false);
    expect(isSafeReturnTo('/foo\\bar')).toBe(false);
    expect(isSafeReturnTo('\\evil.com')).toBe(false);
  });

  test('rejects percent-encoded backslash (%5c, %5C)', () => {
    expect(isSafeReturnTo('/%5cevil.com')).toBe(false);
    expect(isSafeReturnTo('/%5Cevil.com')).toBe(false);
    expect(isSafeReturnTo('/foo%5cbar')).toBe(false);
  });

  test('rejects raw null bytes', () => {
    expect(isSafeReturnTo('/foo\0bar')).toBe(false);
    expect(isSafeReturnTo('/\0')).toBe(false);
  });

  test('rejects percent-encoded null bytes (%00)', () => {
    expect(isSafeReturnTo('/foo%00bar')).toBe(false);
    expect(isSafeReturnTo('/%00')).toBe(false);
    // case-insensitive
    expect(isSafeReturnTo('/foo%00')).toBe(false);
  });

  test('rejects auth pages that would loop the user (login, signup, etc.)', () => {
    expect(isSafeReturnTo('/login')).toBe(false);
    expect(isSafeReturnTo('/signup')).toBe(false);
    expect(isSafeReturnTo('/forgot-password')).toBe(false);
    expect(isSafeReturnTo('/reset-password')).toBe(false);
    expect(isSafeReturnTo('/verify-email')).toBe(false);
  });

  test('rejects locale-prefixed auth pages', () => {
    expect(isSafeReturnTo('/en/login')).toBe(false);
    expect(isSafeReturnTo('/is/signup')).toBe(false);
    expect(isSafeReturnTo('/en/forgot-password')).toBe(false);
    expect(isSafeReturnTo('/is/reset-password?token=abc')).toBe(false);
    expect(isSafeReturnTo('/en/verify-email?token=xyz')).toBe(false);
  });

  test('rejects auth-page case variants', () => {
    expect(isSafeReturnTo('/Login')).toBe(false);
    expect(isSafeReturnTo('/EN/SIGNUP')).toBe(false);
  });

  test('still accepts non-auth paths that share a prefix only outside the blocklist', () => {
    // sanity: routes that don't contain any auth substring still pass
    expect(isSafeReturnTo('/en/party')).toBe(true);
    expect(isSafeReturnTo('/projects/123')).toBe(true);
    expect(isSafeReturnTo('/is/contact')).toBe(true);
  });

  test('does not blanket-block paths whose segments merely contain an auth keyword', () => {
    // segment match — full segment must equal "login"/"signup"/etc, not contain it.
    expect(isSafeReturnTo('/en/projects/login-system')).toBe(true);
    expect(isSafeReturnTo('/is/news/signup-trends')).toBe(true);
    expect(isSafeReturnTo('/en/projects/forgot-password-flow-redesign')).toBe(true);
  });

  test('still blocks auth segments inside a query/hash-stripped path', () => {
    expect(isSafeReturnTo('/login?next=/foo')).toBe(false);
    expect(isSafeReturnTo('/en/signup?ref=banner')).toBe(false);
  });
});
