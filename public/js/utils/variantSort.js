// Ported from icelandicstore #381 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26) — the file as ice ships it. Engine user: components/VariantGrid.js
// (the editor grid); its .vsort-th styles live in public/css/admin-products.css.
//
// Clickable column-header sorting for a list of variant lines — the mechanics
// only; the ordering of colour and size values lives in ./variantArrange.js.
//
// Owner request 2026-09-20: "rather than the new button, I want to click on
// Color, size and fjöldi to arrange them". So the toggle #352 shipped is gone
// and each table's own headers do the work, accumulating like the /shop
// quick-order headers: click colour, then size → colour first, size within it,
// with the click order shown as 1 / 2.
//
// DISPLAY ONLY. Nothing here writes to the server, and no list changes its
// default order — an untouched table is still in the API's SKU order.
import { t } from '../i18n/i18n.js';
import { axisKey } from './variantAxis.js';
import { axisKind, compareAxisValues, compareVariants } from './variantArrange.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// An axis column is `attr:<axis>`, the axis name folded the way variantAxis
// folds it — "Color" and "color" are one column, not two. `variant` is the
// quick view's single column, carrying every axis at once.
export const AXIS_FIELD = (axis) => `attr:${axisKey(axis)}`;
export const VARIANT_FIELD = 'variant';
const NUMERIC_FIELDS = ['stock', 'price_isk', 'qty', 'units'];

// Display name for an axis column. The grids store axis names however the
// catalogue spelled them ("Color" from Shopify, lowercased by the admin form),
// and rendered raw they read "color" / "size" in both languages.
export function axisLabel(axis) {
  const kind = axisKind(axis);
  if (kind === 'color') return t('variants.axisColor');
  if (kind === 'size') return t('variants.axisSize');
  const s = String(axis == null ? '' : axis);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let _collator = null;
let _collatorLoc = null;
function collator() {
  // `typeof` guard: this module is also loaded by the unit suite, which runs in
  // Jest's 'node' environment and has no window.
  const isIS = typeof window !== 'undefined' && window.__locale === 'is';
  const loc = isIS ? 'is-IS' : 'en-GB';     // mirrors utils/format.js
  // Keyed by locale, not built once: the nav language switch does not reload
  // the page, and a cached en-GB collator would keep ordering Icelandic text.
  if (!_collator || _collatorLoc !== loc) {
    _collator = new Intl.Collator(loc, { numeric: true, sensitivity: 'base' });
    _collatorLoc = loc;
  }
  return _collator;
}

// Default field reader: a saved variant row ({ attributes, sku, bin, stock, … }).
// Callers whose rows are shaped differently — the new-product preview holds
// typed-but-unsaved values in a separate map — pass their own `read`.
// NOT named `valueOf`: every object inherits that from Object.prototype, so a
// destructuring default would never fire and the comparator would silently
// compare "[object Object]" against itself.
function defaultRead(row, field) {
  if (!row) return '';
  if (field.startsWith('attr:')) {
    // The API can hand attributes back as a JSON STRING; Object.keys() on one
    // would yield '0','1','2'… and every read would quietly return ''.
    let attrs = row.attributes;
    if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch { attrs = null; } }
    if (!attrs || typeof attrs !== 'object') return '';
    const want = axisKey(field.slice(5));
    const hit = Object.keys(attrs).find(k => axisKey(k) === want);
    return hit === undefined ? '' : attrs[hit];
  }
  return row[field];
}

// A figure that is missing, blank or not a number is UNKNOWN, not zero: an
// empty stock cell sorts to the end of an ascending column rather than beside a
// genuine 0. `Number(null)` and `Number('')` are both 0, so they are caught here
// before the conversion.
function num(raw) {
  if (raw === null || raw === undefined || raw === '') return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Comparator over the clicked columns, in click order.
 *
 * `axes` is the product's variant_axes, needed by the quick view's combined
 * column. A blank or non-numeric figure sorts last in ascending order rather
 * than counting as zero — an empty stock cell is "unknown", not "none".
 */
export function variantComparator(sortCols, { axes = [], read = defaultRead } = {}) {
  const cols = Array.isArray(sortCols) ? sortCols : [];
  const byAxes = compareVariants(axes);
  return (a, b) => {
    for (const { field, dir } of cols) {
      let cmp;
      if (field === VARIANT_FIELD) {
        cmp = byAxes(a, b);
      } else if (field.startsWith('attr:')) {
        const axis = field.slice(5);
        cmp = compareAxisValues(axis, read(a, field), read(b, field));
      } else if (NUMERIC_FIELDS.includes(field)) {
        const av = num(read(a, field));
        const bv = num(read(b, field));
        cmp = av === bv ? 0 : av - bv;     // ∞ − ∞ is NaN, which would corrupt the sort
      } else {
        cmp = collator().compare(
          String(read(a, field) ?? ''), String(read(b, field) ?? '')
        );
      }
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;   // equal on every clicked column → stable sort keeps API order
  };
}

/**
 * One sortable header cell. Same shape as the /shop quick-order headers
 * (`ShopView._qoTh`): the precedence badge appears only once more than one
 * column is active, and the arrow — not colour alone — carries the direction.
 */
export function sortThHtml({ field, label, cols, extraClass = '' }) {
  const list = Array.isArray(cols) ? cols : [];
  const idx = list.findIndex(c => c.field === field);
  const active = idx !== -1;
  const dir = active ? list[idx].dir : null;
  const aria = !active ? 'none' : (dir === 'asc' ? 'ascending' : 'descending');
  const cls = ['vsort-th', extraClass, active ? 'vsort-th--sorted' : ''].filter(Boolean).join(' ');
  const badge = active && list.length > 1
    ? `<span class="vsort-th__order" aria-hidden="true">${idx + 1}</span>` : '';
  const arrow = active
    ? `<span class="vsort-th__arrow" aria-hidden="true">${dir === 'desc' ? '▼' : '▲'}</span>` : '';
  // The cell stays a columnheader and carries aria-sort; the control inside it
  // is a real button. `role="button"` ON the th — which is what the /shop
  // headers do — overrides columnheader and makes aria-sort inert.
  return `<th class="${cls}" scope="col" aria-sort="${aria}">`
    + `<button type="button" class="vsort-th__btn" data-sortcol="${_esc(field)}"`
    + ` aria-label="${_esc(t('shop.sortByCol', { col: label }))}">`
    + `<span class="vsort-th__label">${_esc(label)}</span>${badge}${arrow}</button></th>`;
}

/**
 * Keep only the columns a table actually renders.
 *
 * The remembered arrangement is one list for every product, but the axis
 * columns are not: open a colour+size product, sort by colour, then open a
 * size-only one and that `attr:color` would be a GHOST key — ordering rows
 * from a column with no header to show it, numbering the badge on the column
 * you can see "2" with no "1" anywhere, and impossible to clear from that page.
 */
export function filterSortCols(cols, fields) {
  const allowed = new Set(fields);
  return (Array.isArray(cols) ? cols : []).filter(c => allowed.has(c.field));
}

// not-present → append asc (lowest precedence); asc → desc; desc → remove.
// Lifted from ShopView._nextSortCols, which now imports this one.
export function nextSortCols(current, field) {
  const cols = Array.isArray(current) ? current : [];
  const idx = cols.findIndex(c => c.field === field);
  if (idx === -1) return [...cols, { field, dir: 'asc' }];
  if (cols[idx].dir === 'asc') {
    const next = cols.slice();
    next[idx] = { field, dir: 'desc' };
    return next;
  }
  return cols.filter(c => c.field !== field);
}

// Wire every sortable header under `root`. `onPick(field)` is handed the column
// that was activated; the caller computes the next state and repaints. No
// keydown handler: a <button> already answers Enter and Space.
export function bindSortHeaders(root, onPick) {
  if (!root) return;
  root.querySelectorAll('[data-sortcol]').forEach((btn) => {
    btn.addEventListener('click', () => { if (btn.dataset.sortcol) onPick(btn.dataset.sortcol); });
  });
}

// Put focus back on the column just activated. Every caller repaints by
// replacing innerHTML, which drops focus to <body> — so a keyboard user could
// not cycle a column asc → desc → off without tabbing back across the table.
export function refocusSortHeader(root, field) {
  if (!root || !field) return;
  const btn = root.querySelector(`[data-sortcol="${CSS.escape(field)}"]`);
  if (btn && document.activeElement === document.body) btn.focus();
}

// ── the remembered arrangement ───────────────────────────────────────────────
// Per browser, per table. The editor grid and the product-list quick view keep
// separate keys on purpose: they do not have the same columns, so a colour+size
// sort means nothing to a table whose only variant column is "Afbrigði".
// /shop is not stored here at all — its sort already rides the URL (`colsort=`).
export const SORT_KEYS = { grid: 'variantSort.grid', quickview: 'variantSort.quickview' };

export function readSortCols(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate rather than trust: a half-written or older value must not throw
    // on the next paint.
    return parsed
      .filter(c => c && typeof c.field === 'string' && (c.dir === 'asc' || c.dir === 'desc'))
      .map(c => ({ field: c.field, dir: c.dir }));
  } catch { return []; }
}

export function writeSortCols(key, cols) {
  try {
    if (Array.isArray(cols) && cols.length) window.localStorage.setItem(key, JSON.stringify(cols));
    else window.localStorage.removeItem(key);
  } catch { /* the arrangement simply does not persist */ }
}
