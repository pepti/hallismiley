// Persistence seam for the admin-nav edit mode. The sidebar UI only ever touches
// these functions, so the storage backend can change without touching the renderer.
//
// Source of truth is the admin's DB row (per-account, cross-device). To keep
// renderAdminShell() synchronous we front the DB with a write-through localStorage
// cache: reads are sync (cache), writes update the cache immediately and PATCH the
// DB in the background (debounced), and a one-time hydrate on first admin mount
// pulls the server value into the cache — re-rendering if it differs (e.g. another
// device changed it). Versioned + quota-safe, following ChangeRequestWidget.
import { fetchNavConfig, saveNavConfig } from '../services/adminNav.js';

const NAV_KEY = 'halli.admin.nav.v1';

// ── localStorage cache ────────────────────────────────────────────────────────

/** Synchronous read of the cached layout snapshot, or null when absent/invalid. */
export function loadNavLayout() {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.sections)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(layout) {
  try {
    if (layout == null) localStorage.removeItem(NAV_KEY);
    else localStorage.setItem(NAV_KEY, JSON.stringify({ v: 1, ...layout }));
  } catch {
    /* quota / disabled — the in-memory working copy still drives this session */
  }
}

// ── Debounced DB write-through ────────────────────────────────────────────────
// A burst of rename keystrokes / drags coalesces into one PATCH (also keeps us
// clear of the write rate limiter in production).
const DIRTY_KEY = 'halli.admin.nav.dirty';
let _saveTimer = null;
let _pending = null;     // last layout (or null) waiting to be PATCHed
let _hasPending = false;

// A localStorage "dirty" flag marks that the cache holds a change the DB hasn't
// confirmed yet. It survives a reload, so if a debounced PATCH is lost (e.g. the
// admin reloads inside the debounce window) the next load re-pushes the cache
// instead of clobbering it with the stale server value. Cleared once a PATCH lands.
function setDirty(on) {
  try { if (on) localStorage.setItem(DIRTY_KEY, '1'); else localStorage.removeItem(DIRTY_KEY); }
  catch { /* ignore */ }
}
function isDirty() {
  try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch { return false; }
}

function scheduleFlush() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSave, 400);
}
function flushSave() {
  _saveTimer = null;
  if (!_hasPending) return;
  saveNavConfig(_pending)
    .then(() => { _hasPending = false; setDirty(false); })
    .catch(() => { /* stay dirty — retry on next change or next page load */ });
}

/** Persist a layout: cache + dirty flag immediately (sync), PATCH the DB shortly
 *  after (debounced so a burst of edits coalesces into one request). */
export function saveNavLayout(layout) {
  writeCache(layout);
  setDirty(true);
  _pending = layout;
  _hasPending = true;
  scheduleFlush();
}

/** Reset to default: clear the cache and the DB row. */
export function clearNavLayout() {
  writeCache(null);
  setDirty(true);
  _pending = null;
  _hasPending = true;
  scheduleFlush();
}

// ── One-time hydrate from the DB on first admin-shell mount ───────────────────
let _hydrated = false;
let _rerender = null;

/** renderAdminShell registers its current nav re-render hook each render, so a
 *  late-arriving hydrate updates whatever shell is currently mounted. */
export function setNavRerender(fn) { _rerender = fn; }

/** Sync with the DB once per page load. If the cache is dirty (a prior change
 *  never confirmed), push it to the server rather than pulling — so an unsynced
 *  edit is healed, not lost. Otherwise pull the server layout into the cache
 *  (cross-device sync), re-rendering via the registered hook when it changed. */
export function hydrateNavLayout() {
  if (_hydrated) return;
  _hydrated = true;
  if (isDirty()) {
    saveNavConfig(loadNavLayout()).then(() => setDirty(false)).catch(() => {});
    return;
  }
  fetchNavConfig()
    .then((server) => {
      if (isDirty()) return; // a change happened while the GET was in flight
      const before = localStorage.getItem(NAV_KEY);
      writeCache(server);
      const after = localStorage.getItem(NAV_KEY);
      if (before !== after && typeof _rerender === 'function') _rerender();
    })
    .catch(() => { /* offline / not admin — keep the cached layout */ });
}
