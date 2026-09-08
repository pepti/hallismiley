// Admin list pager.
//
// Replaces three hand-rolled implementations (AdminUsersView built DOM nodes,
// AdminLeadsView built an HTML string, AdminMonitoringView counted offsets) plus
// per-view `_page` state in three more. Two of those rendered into
// `.admin-pagination`, a class with NO CSS anywhere in the repo — so the Leads
// and Markaður pagers have been shipping as unstyled inline buttons.
//
// What the copies did not have, and this does: page-size choice, a
// "showing X–Y of N" line, aria-labels on the glyph-only buttons, an aria-live
// count so a page change is announced, and one delegated listener instead of a
// fresh set on every repaint.

import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';

// Mirrors the server's cap exactly. leadsController.js clamps `limit` to
// [1, 200]; offering 500 here would let the client ask for a page the server
// silently truncates, and the pager would then lie about how many pages exist.
export const PAGE_SIZES = [25, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Coerce anything to a page size the server will honour. */
export function clampPageSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(v), 1), MAX_PAGE_SIZE);
}

/** How many pages `total` rows fill. Always at least 1, so "1 / 1" is honest. */
export function pageCount(total, pageSize) {
  const size = clampPageSize(pageSize);
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.ceil(n / size));
}

/**
 * Which rows this page actually shows: { from, to }, 1-based and inclusive.
 *
 * Exported because the arithmetic is the part worth pinning, and inside
 * pagerHtml it is only reachable through t() — which returns the bare key when
 * no dictionary is loaded, i.e. in every unit test.
 */
export function showingRange(page, total, pageSize) {
  const size = clampPageSize(pageSize);
  const n = Math.max(0, Number(total) || 0);
  const pages = pageCount(n, size);
  const cur = Math.min(Math.max(Number(page) || 1, 1), pages);
  return { from: n === 0 ? 0 : (cur - 1) * size + 1, to: Math.min(cur * size, n) };
}

/**
 * The pager.
 *
 * Returns '' when there is nothing to page through AND no size picker is
 * wanted — an empty list must not grow a control bar.
 *
 * @param {{page:number, total:number, pageSize:number, showSizePicker?:boolean}} o
 */
export function pagerHtml({ page, total, pageSize, showSizePicker = false }) {
  const size = clampPageSize(pageSize);
  const pages = pageCount(total, size);
  const cur = Math.min(Math.max(Number(page) || 1, 1), pages);
  const n = Number(total) || 0;

  if (pages <= 1 && !showSizePicker) return '';

  const { from, to } = showingRange(cur, n, size);
  const showing = t('adminKit.showing', { from, to, total: n });
  const pageOf = t('adminKit.pageOf', { page: cur, pages });

  const picker = showSizePicker
    ? `<label class="admin-pagination__size">`
      + `<span>${escHtml(t('adminKit.perPage'))}</span>`
      + `<select class="form-input form-input--sm" data-page-size>`
      + PAGE_SIZES.map((s) => `<option value="${s}"${s === size ? ' selected' : ''}>${s}</option>`).join('')
      + '</select></label>'
    : '';

  // aria-live on the count: a page change replaces the rows silently otherwise,
  // and a screen-reader user gets no confirmation that anything happened.
  return '<div class="admin-pagination">'
    + `<span class="admin-pagination__info">${escHtml(showing)}</span>`
    + '<div class="admin-pagination__controls">'
    + `<button type="button" class="btn btn--sm btn--ghost" data-page="${cur - 1}"`
    + ` aria-label="${escHtml(t('adminKit.prevPage'))}"${cur <= 1 ? ' disabled' : ''}>←</button>`
    + `<span class="admin-pagination__count" aria-live="polite">${escHtml(pageOf)}</span>`
    + `<button type="button" class="btn btn--sm btn--ghost" data-page="${cur + 1}"`
    + ` aria-label="${escHtml(t('adminKit.nextPage'))}"${cur >= pages ? ' disabled' : ''}>→</button>`
    + '</div>'
    + picker
    + '</div>';
}

/**
 * One delegated listener on a container that OUTLIVES the repaint — the panel
 * the pager renders into, not the pager itself. Returns a detach().
 */
export function bindPager(hostEl, { onPage, onPageSize } = {}) {
  if (!hostEl) return () => {};

  const onClick = (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled || !hostEl.contains(btn)) return;
    const next = Number(btn.dataset.page);
    if (Number.isFinite(next) && next >= 1 && onPage) onPage(next);
  };
  const onChange = (e) => {
    const sel = e.target.closest('select[data-page-size]');
    if (!sel || !hostEl.contains(sel) || !onPageSize) return;
    onPageSize(clampPageSize(sel.value));
  };

  hostEl.addEventListener('click', onClick);
  hostEl.addEventListener('change', onChange);
  return () => {
    hostEl.removeEventListener('click', onClick);
    hostEl.removeEventListener('change', onChange);
  };
}
