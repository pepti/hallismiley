// The admin home's answer cache (server/services/adminHomeCache.js): the key
// carries everything that decides what a viewer may see, an answer with
// `errors` is never stored, and clearHomeCache() drops everything (a deleted
// or aged-out lead must not linger in a cached feed). DB-free.
const {
  cacheKey, cacheGet, cacheSet, clearHomeCache, cacheSize, CACHE_MS,
} = require('../../server/services/adminHomeCache');

afterEach(() => clearHomeCache());

describe('cacheKey', () => {
  const base = cacheKey({ id: 'u1' }, ['dashboard', 'orders'], ['books'], false);

  test('the same inputs give the same key, in any list order, and an id or a user object alike', () => {
    expect(cacheKey({ id: 'u1' }, ['orders', 'dashboard', 'orders'], ['books'], false)).toBe(base);
    expect(cacheKey('u1', ['dashboard', 'orders'], ['books'], false)).toBe(base);
  });

  test('a change in the views changes the key', () => {
    expect(cacheKey({ id: 'u1' }, ['dashboard', 'orders', 'ar'], ['books'], false)).not.toBe(base);
    expect(cacheKey({ id: 'u1' }, ['dashboard'], ['books'], false)).not.toBe(base);
    expect(cacheKey({ id: 'u1' }, ['*'], ['books'], false)).not.toBe(base);
  });

  test('the admin flag changes the key', () => {
    expect(cacheKey({ id: 'u1' }, ['dashboard', 'orders'], ['books'], true)).not.toBe(base);
  });

  test('the switched-off module list changes the key', () => {
    expect(cacheKey({ id: 'u1' }, ['dashboard', 'orders'], [], false)).not.toBe(base);
    expect(cacheKey({ id: 'u1' }, ['dashboard', 'orders'], ['books', 'shop'], false)).not.toBe(base);
  });

  test('two users with the same views get different keys', () => {
    expect(cacheKey({ id: 'u2' }, ['dashboard', 'orders'], ['books'], false)).not.toBe(base);
  });

  test('ids cannot collide through the separator', () => {
    expect(cacheKey('a,b', ['c'], [], false)).not.toBe(cacheKey('a', ['b', 'c'], [], false));
  });

  test('no user, no key', () => {
    expect(() => cacheKey(null, [], [], false)).toThrow();
    expect(() => cacheKey({}, [], [], false)).toThrow();
  });
});

describe('cacheSet / cacheGet', () => {
  test('stores a clean answer for the TTL', () => {
    const k = cacheKey('u1', ['dashboard'], [], true);
    expect(cacheSet(k, { todo: [] }, 60_000)).toBe(true);
    expect(cacheGet(k)).toEqual({ todo: [] });
  });

  test('never stores an answer that carries errors', () => {
    const k = cacheKey('u1', ['dashboard'], [], true);
    expect(cacheSet(k, { todo: [], errors: ['figures.vatNext'] }, 60_000)).toBe(false);
    expect(cacheGet(k)).toBeNull();
  });

  test('an expired entry is gone', () => {
    const k = cacheKey('u1', ['dashboard'], [], true);
    cacheSet(k, { todo: [] }, 1);
    const until = Date.now() + 5;
    while (Date.now() < until) { /* let the 1 ms TTL pass */ }
    expect(cacheGet(k)).toBeNull();
  });

  test('clearHomeCache drops everything', () => {
    cacheSet(cacheKey('u1', ['a'], [], false), { todo: [] }, 60_000);
    cacheSet(cacheKey('u2', ['a'], [], false), { todo: [] }, 60_000);
    expect(cacheSize()).toBe(2);
    clearHomeCache();
    expect(cacheSize()).toBe(0);
  });

  test('off under NODE_ENV=test by default (integration tests read what they wrote)', () => {
    expect(CACHE_MS).toBe(0);
    expect(cacheSet(cacheKey('u1', ['a'], [], false), { todo: [] })).toBe(false);
  });
});
