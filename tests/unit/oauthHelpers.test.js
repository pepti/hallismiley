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
const { generateUniqueUsername } = require('../../server/auth/oauthHelpers');

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
