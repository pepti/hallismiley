// The admin home's per-viewer answer cache (routes/adminHomeRoutes.js).
//
// The page prints "staðan kl. HH:MM", so an answer up to CACHE_MS old is
// honest, and a reload storm costs one computation. Pure and DB-free (the unit
// tier tests cacheKey), so it can be required anywhere — including the places
// that must DROP cached answers: a lead deleted/erased (leadsController) or
// aged out (leadsCleanup) must not linger in someone's cached feed, because
// the home carries enquirers' names.
//
// Rules:
//   • the key is the viewer AND everything that decides what they may see —
//     their resolved view list, the admin flag, the instance's switched-off
//     modules — so a role change can never be answered from a wider cache;
//   • an answer that carries `errors` is never stored (a failed source must
//     be retried on the next load, not frozen for the TTL);
//   • off under NODE_ENV=test, so every integration test reads the database
//     it just wrote.

const CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 45_000;
const CACHE_MAX = 500;
const cache = new Map(); // key → { exp, body }

/**
 * The cache key for one viewer. Order-insensitive in the view and module
 * lists; any difference in who, what they hold, admin or not, or which
 * modules are off gives a different key.
 */
function cacheKey(user, views, disabled, isAdmin) {
  const id = user && typeof user === 'object' ? user.id : user;
  if (id === undefined || id === null || id === '') throw new Error('cacheKey needs a user');
  const list = v => [...new Set((v || []).map(String))].sort().join(',');
  return JSON.stringify([String(id), isAdmin === true, list(views), list(disabled)]);
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { cache.delete(key); return null; }
  return hit.body;
}

function cacheSet(key, body, ttlMs = CACHE_MS) {
  if (!ttlMs || !body || (Array.isArray(body.errors) && body.errors.length)) return false;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // oldest first
  cache.set(key, { exp: Date.now() + ttlMs, body });
  return true;
}

/** Drop every cached answer (data a viewer must no longer see has gone). */
function clearHomeCache() { cache.clear(); }

function cacheSize() { return cache.size; }

module.exports = { cacheKey, cacheGet, cacheSet, clearHomeCache, cacheSize, CACHE_MS };
