// Per-user, per-page admin width — sidebar width icon → Síðubreidd (2026-09-22).
//
// Three widths, applied as classes on the admin shell (admin.css):
//   normal — the 1280px cap every admin page has always had;
//   wide   — 1920px (.admin-shell--wide);
//   full   — the whole screen (.admin-shell--full).
// A page's own default comes from renderAdminShell({ wide }). Every admin page
// defaults to `normal` (Halli, 2026-09-22 — the orders list was `wide` until
// then); wider is the user's choice, per page or for all pages at once.
//
// The choice lives on the ACCOUNT (users.page_widths, migration 125), not in
// localStorage: it rides on the session payload like users.theme, so it follows
// the login to another browser. Keyed per page by pageWidthKey(), so the orders
// list and an order's detail page are set separately even though both light the
// same sidebar entry.

import { SUPPORTED_LOCALES } from '../i18n/i18n.js';
import { getUser, isAuthenticated, updateCachedUser, getCSRFToken } from './auth.js';

// Keep in step with PAGE_WIDTHS in server/controllers/userController.js.
export const WIDTHS = ['normal', 'wide', 'full'];
const KEY_MAX = 120;

const KEY_RE = /^\/admin(\/[a-z0-9:-]+)*$/;

// The router's matched pattern for the page being rendered (router.js calls
// setPageRoute before view.render()). undefined = never set (unit tests, or a
// shell built outside the router), and pageWidthKey then reads the URL.
let _routePattern;
export function setPageRoute(pattern) {
  _routePattern = pattern;
  if (typeof pattern !== 'string' || !/^\/admin(\/|$)/.test(pattern)) _lastWidth = null;
}

// The page's key. From the router pattern when there is one:
// '/admin/shop/orders/:id' → itself, '/admin/accounts/company/:companyId' →
// lower-cased. A non-admin (or unmatched) route has no setting (null).
//
// Without a pattern, from the URL: '/is/admin/shop/orders/3f2c…' →
// '/admin/shop/orders/:id'. A segment that is not a plain lower-case slug
// (uuid, number, mixed case, encoded text) is an id; a uuid or all-digit
// segment is one even though it would pass as a slug.
//
// The result always satisfies the server's key pattern, or is null.
export function pageWidthKey(pathname, pattern = _routePattern) {
  if (pattern !== undefined) {
    const key = typeof pattern === 'string' ? pattern.toLowerCase() : '';
    return key.length <= KEY_MAX && KEY_RE.test(key) ? key : null;
  }
  const parts = String(pathname || '/').split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  if (parts[0] !== 'admin') return null;
  const key = '/' + parts.map((p, i) => {
    if (i === 0) return p;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return ':id';
    if (/^\d+$/.test(p)) return ':id';
    return /^[a-z0-9-]+$/.test(p) ? p : ':id';
  }).join('/');
  return key.length > KEY_MAX ? null : key;
}

// The all-admin-pages width (Síðubreidd → Nota á allar síður, 2026-09-22). Not a
// path, so no page key can equal it. Keep in step with PAGE_WIDTH_ALL_KEY in
// server/controllers/userController.js.
export const ALL_KEY = '*';

// The width a page falls back to when it has no choice of its own: the
// all-pages width if one is saved, else the page's own default.
export function inheritedWidth(pageDefault = 'normal') {
  const all = getUser()?.page_widths?.[ALL_KEY];
  return WIDTHS.includes(all) ? all : pageDefault;
}

export function hasAllPagesWidth() {
  return WIDTHS.includes(getUser()?.page_widths?.[ALL_KEY]);
}

// The saved width for `key`, else the all-pages width, else `fallback` (the
// page's own default).
export function getPageWidth(key, fallback = 'normal') {
  const saved = key ? getUser()?.page_widths?.[key] : null;
  return WIDTHS.includes(saved) ? saved : inheritedWidth(fallback);
}

function setWidthClasses(shell, width) {
  shell.classList.toggle('admin-shell--wide', width === 'wide');
  shell.classList.toggle('admin-shell--full', width === 'full');
}

// The width the last admin shell was put at — where the next page's shell
// starts its slide from. null off the admin (setPageRoute), so arriving from
// the storefront does not slide.
let _lastWidth = null;

export function applyPageWidth(shell, width) {
  if (!shell) return;
  setWidthClasses(shell, width);
  // Only the page on screen sets where the next one slides from — a save that
  // answers after the user has moved on must not.
  if (shell.isConnected) _lastWidth = width;
}

const reducedMotion = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mjúk hreyfing (sidebar width icon, Halli 2026-09-22): does the admin shell
// SLIDE to a new width instead of jumping? On unless the account turned it off
// (users.page_width_motion, migration 127). The CSS still honours
// prefers-reduced-motion either way.
export function getMotion() {
  return getUser()?.page_width_motion !== false;
}

export function applyMotion(shell) {
  shell?.classList.toggle('admin-shell--motion', getMotion());
}

// A freshly built shell (renderAdminShell). Every page builds a new element at
// its own width, so there is nothing to animate from — unless it starts at the
// previous page's width and moves to its own once the old width has painted.
export function enterPageWidth(shell, width) {
  if (!shell) return;
  const from = _lastWidth;
  applyMotion(shell);
  _lastWidth = width;           // a quick second navigation starts from here
  // (the CSS has no transition for reduced motion — skip the two-step draw too)
  if (!getMotion() || reducedMotion() || !from || from === width) { setWidthClasses(shell, width); return; }
  setWidthClasses(shell, from);
  let done = false;
  const go = () => { if (!done) { done = true; setWidthClasses(shell, width); } };
  if (typeof requestAnimationFrame !== 'function') { go(); return; }
  // Two frames: the router mounts the shell, then the start width paints.
  requestAnimationFrame(() => requestAnimationFrame(go));
  // A hidden tab runs no animation frames — never leave the page stuck on the
  // previous page's width because of that.
  setTimeout(go, 120);
}

// Writes are chained so the last pick wins: two overlapping PUTs could commit
// in either order and leave the account on a width the user already left.
let _chain = Promise.resolve();

function withWidth(map, key, width) {
  const next = { ...(map || {}) };
  if (width === null) delete next[key]; else next[key] = width;
  return next;
}

// Save `width` (null = back to the page default) for `key`. Resolves true on
// success, false on a failed write (never throws) — the width is already
// applied on screen either way.
//
// The cached user is updated FIRST (optimistically), so reopening the menu or
// coming back to the page while the PUT is in flight shows the new choice; a
// failed write puts this key back to what it was. The merge is skipped if a
// different login has taken over the tab meanwhile.
const PAGE = { field: 'page_widths', url: '/api/v1/users/me/page-width' };

export function savePageWidth(key, width) {
  return _saveKey(PAGE, key, width);
}

// "Nota á allar síður": `width` becomes every admin page's width. It REPLACES
// the whole map (the server does the same), so pages that had their own choice
// follow it too; a later per-page pick still overrides it. null clears only the
// all-pages width. Same promise contract as savePageWidth.
export function saveAllPagesWidth(width) {
  return _saveAll(PAGE, width);
}

function _saveKey(cfg, key, width) {
  if (!key || !isAuthenticated()) return Promise.resolve(false);
  const before = getUser()?.[cfg.field]?.[key];
  return _save(cfg, key, width,
    (map) => withWidth(map, key, width),
    (map) => withWidth(map, key, before ?? null));
}

function _saveAll(cfg, width) {
  if (!isAuthenticated()) return Promise.resolve(false);
  const before = getUser()?.[cfg.field] || {};
  return _save(cfg, ALL_KEY, width,
    (map) => (width === null ? withWidth(map, ALL_KEY, null) : { [ALL_KEY]: width }),
    () => before);
}

// ── Right-hand column of the admin detail pages ─────────────────────────────
// The order / customer / company / user pages share one grid (.customer-detail,
// admin-customers.css): the page's information cards on the left, a column of
// small cards on the right. Its width is picked from an icon on that column's
// top card (components/AsideWidthControl.js, Halli 2026-09-23) — per page, or
// for all of them at once — and saved on the account (users.aside_widths,
// migration 135) under the same page keys and the same '*' as the page width.
//
// Keep in step with ASIDE_WIDTHS in server/controllers/userController.js.
export const ASIDE_WIDTHS = ['narrow', 'medium', 'wide'];

const ASIDE = { field: 'aside_widths', url: '/api/v1/users/me/aside-width' };

export function hasAllPagesAsideWidth() {
  return ASIDE_WIDTHS.includes(getUser()?.aside_widths?.[ALL_KEY]);
}

// What a page shows with no choice of its own: the all-pages width if one is
// saved, else the page's own default.
export function inheritedAsideWidth(pageDefault = 'medium') {
  const all = getUser()?.aside_widths?.[ALL_KEY];
  return ASIDE_WIDTHS.includes(all) ? all : pageDefault;
}

export function getAsideWidth(key, fallback = 'medium') {
  const saved = key ? getUser()?.aside_widths?.[key] : null;
  return ASIDE_WIDTHS.includes(saved) ? saved : inheritedAsideWidth(fallback);
}

export function saveAsideWidth(key, width) {
  return _saveKey(ASIDE, key, width);
}

export function saveAllPagesAsideWidth(width) {
  return _saveAll(ASIDE, width);
}

// Turn the slide on or off for this account. Same contract as savePageWidth:
// the cache is updated first, a failed write puts it back, resolves true/false.
let _motionSeq = 0;
export function saveMotion(on) {
  if (!isAuthenticated()) return Promise.resolve(false);
  const owner = getUser()?.id;
  const before = getMotion();
  const seq = ++_motionSeq;
  updateCachedUser({ page_width_motion: on }, { silent: true });
  const run = _chain.then(async () => {
    try {
      const token = await getCSRFToken();
      const res = await fetch('/api/v1/users/me/page-width-motion', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
        body: JSON.stringify({ on }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return true;
    } catch {
      // Only the latest toggle rolls back: an older one failing must not undo a
      // newer choice that is still on its way (or already saved).
      if (seq === _motionSeq && getUser()?.id === owner) {
        updateCachedUser({ page_width_motion: before }, { silent: true });
        return false;
      }
      return seq !== _motionSeq;
    }
  });
  _chain = run.catch(() => {});
  return run;
}

function _save({ field, url }, key, width, optimistic, restore) {
  const owner = getUser()?.id;
  updateCachedUser({ [field]: optimistic(getUser()?.[field]) }, { silent: true });
  const rollback = () => {
    if (getUser()?.id !== owner) return;
    updateCachedUser({ [field]: restore(getUser()?.[field]) }, { silent: true });
  };
  const run = _chain.then(async () => {
    try {
      const token = await getCSRFToken();
      const res = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
        body: JSON.stringify({ path: key, width }),
      });
      if (!res.ok) { rollback(); return false; }
      const data = await res.json();
      // Silent: the router re-navigates on authchange, which would rebuild the
      // page the user is looking at just to show a width that is already applied.
      if (getUser()?.id === owner) updateCachedUser({ [field]: data[field] || {} }, { silent: true });
      return true;
    } catch {
      rollback();
      return false;
    }
  });
  _chain = run.catch(() => {});
  return run;
}
