// Admin list state in the URL.
//
// No admin view touched URLSearchParams before this: sort, filter, search and
// page all lived in view fields, so a reload dropped them, the Back button
// stepped past the whole list, and an admin could not send a colleague "the
// leads I'm looking at". LedgerLink's document list invented this first
// (_syncUrl there); this is that idea, shared.
//
// ⚠ replaceState, NEVER pushState. The search box is debounced, so a pushState
// per settled keystroke would bury the page the user actually came from under a
// dozen history entries — and every Playwright spec that calls page.goBack()
// would start failing.
//
// Page SIZE is deliberately NOT in the URL: it is a per-viewer habit, not part
// of what a shared link should mean. It lives in localStorage instead, so a
// link opened by someone else honours their own choice.

import { clampPageSize, DEFAULT_PAGE_SIZE } from '../components/adminPager.js';
import { readPref, writePref } from './localPref.js';

export { clampPageSize };

/** localStorage key for a view's remembered page size. */
export function pageSizeKey(viewId) {
  return `admin.${viewId}.pageSize`;
}

/** The remembered page size for a view, clamped to what the server accepts. */
export function readPageSize(viewId, fallback = DEFAULT_PAGE_SIZE) {
  return clampPageSize(readPref(pageSizeKey(viewId), fallback));
}

/** Remember a page size for a view. */
export function writePageSize(viewId, size) {
  return writePref(pageSizeKey(viewId), clampPageSize(size));
}

/**
 * Read list state out of a query string, falling back to `defaults` per key.
 *
 * Values are coerced to the TYPE of the matching default, so a view declares
 * `{ page: 1, q: '', status: 'new' }` and gets numbers and strings back rather
 * than everything as a string.
 */
export function readListState(defaults = {}, search = (typeof window !== 'undefined' ? window.location.search : '')) {
  const params = new URLSearchParams(search || '');
  const out = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    if (typeof fallback === 'number') {
      const n = Number(raw);
      // A junk ?page=banana falls back rather than requesting NaN from the API.
      out[key] = Number.isFinite(n) ? n : fallback;
    } else if (typeof fallback === 'boolean') {
      out[key] = raw === '1' || raw === 'true';
    } else {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Write list state into the address bar, omitting anything still at its
 * default so a pristine list has a clean URL.
 */
export function syncListState(basePath, state = {}, defaults = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    const fallback = defaults[key];
    if (value === undefined || value === null || value === '') continue;
    if (value === fallback) continue;
    params.set(key, typeof value === 'boolean' ? '1' : String(value));
  }
  const qs = params.toString();
  const url = qs ? `${basePath}?${qs}` : basePath;
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // A sandboxed or file:// context refuses history writes. The list still
    // works; it just is not linkable.
  }
  return url;
}
