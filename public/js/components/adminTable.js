// Sortable admin table headers.
//
// Extracted from AdminUsersView, which was the only view carrying a complete
// set (_sortableTh + _cycleSort + _bindSort). Of ~35 admin tables, four emitted
// aria-sort at all, and each of those four had written it again from scratch.
//
// Two departures from the original, both deliberate:
//
//   1. The control is a real <button> inside the <th>, not a tabindex="0" on
//      the <th> itself. That is the WAI-ARIA sortable-table pattern: native
//      button semantics, a real focus ring, Enter and Space for free, and no
//      hand-rolled keydown branch. aria-sort stays on the <th>, where the
//      accessibility tree expects it.
//   2. bindSortable attaches ONE delegated listener to the <thead>, which
//      survives the innerHTML repaint the views do on every load.
//
// The CSS contract already existed — layout.css `.admin-table th.sortable` and
// `.admin-table__sort-arrow`, commented "reusable across admin tables" since
// before anything reused it. admin-kit.css only adds the button reset.

import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';

/**
 * A sortable header cell.
 *
 * @param {string} label  visible column label, already translated
 * @param {string} field  server-side sort key (must be in the server's whitelist)
 * @param {{field: string, dir: 'asc'|'desc'}} sort  the list's current sort
 * @param {{scope?: string}} [opts]
 * @returns {string} <th> markup
 */
export function sortableTh(label, field, sort, opts = {}) {
  const active = sort && sort.field === field;
  const dir = active ? sort.dir : null;
  // The arrow is always in the DOM (hidden by opacity until active) so column
  // widths do not jump as the user clicks around.
  const arrow = dir === 'desc' ? '▼' : '▲';
  const ariaSort = !active ? 'none' : (dir === 'asc' ? 'ascending' : 'descending');
  const cls = 'sortable' + (active ? ' is-active' : '');
  const scope = opts.scope ? ` scope="${escHtml(opts.scope)}"` : ' scope="col"';
  // The button's accessible name carries the intent, not just the label, so a
  // screen-reader user hears "Sort by Username" rather than a bare column name.
  const hint = t('adminKit.sortBy', { label });
  return `<th${scope} class="${cls}" aria-sort="${ariaSort}">`
    + `<button type="button" class="admin-table__sort-btn" data-sort-field="${escHtml(field)}"`
    + ` aria-label="${escHtml(hint)}">${escHtml(label)}`
    + `<span class="admin-table__sort-arrow" aria-hidden="true">${arrow}</span>`
    + '</button></th>';
}

/**
 * Click cycle: a new column starts ascending; the same column toggles.
 *
 * Two-state on purpose — no "clear" step. A list whose default column is Date
 * descending must be invertible to ascending, and a three-state cycle would
 * strand the user on an unsorted view they did not ask for.
 */
export function cycleSort(sort, field) {
  if (!sort || sort.field !== field) return { field, dir: 'asc' };
  return { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * One delegated listener on the <thead>. Returns a detach().
 *
 * Bind to the thead (or any element that outlives the repaint), never to the
 * buttons — the views rebuild their table body wholesale, and per-button
 * listeners would multiply on every load.
 */
export function bindSortable(theadEl, onSort) {
  if (!theadEl) return () => {};
  const handler = (e) => {
    const btn = e.target.closest('button[data-sort-field]');
    if (!btn || !theadEl.contains(btn)) return;
    onSort(btn.dataset.sortField);
  };
  theadEl.addEventListener('click', handler);
  return () => theadEl.removeEventListener('click', handler);
}
