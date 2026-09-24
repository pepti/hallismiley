// Right-hand column width on the admin detail pages (harvested from
// icelandicstore #413, 2026-09-24). Halli, 2026-09-23: the column of small
// information cards on the right gets three widths — Mjór 240 / Miðlungs 320 /
// Breiður 440 — from a small icon in the top-right corner of its top card.
//
// Works like the page width (PageWidthControl.js), one level down: per page
// (the same page keys), "Nota á allar síður" for every page that has the
// column, the page's own default marked "· sjálfgefinn", a dot on the icon
// while the page is off its default. Saved on the account
// (services/pageWidth.js → users.aside_widths, migration 111). The column
// slides to its new width when Mjúk hreyfing is on.
//
// Engine adaptation: ice's pages share one `.customer-detail` grid; the
// engine's detail pages each have their own, so the three selectors are
// options (ice's class names are the defaults, which keeps an ice call site
// working unchanged). The grid gets `aside-grid` + `aside-grid--<width>`
// (admin-shell.css), which set `--aside-w`; a page's own grid CSS reads it.

import { t } from '../i18n/i18n.js';
import { getUser } from '../services/auth.js';
import {
  ASIDE_WIDTHS, getAsideWidth, inheritedAsideWidth, hasAllPagesAsideWidth,
  saveAsideWidth, saveAllPagesAsideWidth, pageWidthKey,
} from '../services/pageWidth.js';
import { escHtml } from '../utils/escHtml.js';
import { showToast } from './Toast.js';
import { createWidthMenu } from './widthMenu.js';

// A panel with its right-hand column marked off.
const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M10 2.75v10.5M11.75 6h.75M11.75 8h.75M11.75 10h.75"/></svg>';

// The column in px — keep in step with the --aside-w values in admin-shell.css.
const HINT = { narrow: '240', medium: '320', wide: '440' };

const widthLabel = (w) => t('admin.asideWidth.' + w);

function applyAsideWidth(grid, width) {
  grid.classList.add('aside-grid');
  for (const w of ASIDE_WIDTHS) grid.classList.toggle(`aside-grid--${w}`, w === width);
}

// Wire the control onto `root`'s detail grid. Call after every render of the
// grid (it replaces any control a previous render left). No-op on a page
// without the grid or outside an admin page.
//   pageDefault — this page's own width ('medium' unless the page says so).
//   grid / aside / head — selectors: the two-column grid, its right-hand
//     column (a direct child), and the heading row of that column's FIRST card.
export function mountAsideWidthControl(root, {
  pageDefault = 'medium',
  grid: gridSel = '.customer-detail',
  aside: asideSel = '.customer-detail__aside',
  head: headSel = '.cd-card__head',
} = {}) {
  const grid = root?.querySelector(gridSel);
  const aside = grid?.querySelector(`:scope > ${asideSel}`);
  const head = aside?.firstElementChild?.querySelector(headSel);
  if (!head) return;
  const key = grid.closest('.admin-shell')?.dataset.widthKey
    || pageWidthKey(globalThis.location?.pathname);
  if (!key) return;

  const current = () => getAsideWidth(key, pageDefault);
  const inherited = () => inheritedAsideWidth(pageDefault);
  const isCustom = () => ASIDE_WIDTHS.includes(getUser()?.aside_widths?.[key]);

  applyAsideWidth(grid, current());
  // Only from here on does a width change slide: the width the page opened
  // at must not animate in from the CSS default.
  const ready = () => grid.classList.add('aside-grid--ready');
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(ready));
  else ready();

  aside.querySelector('.cd-aside-width')?.remove();
  aside.querySelector('.cd-aside-width-pop')?.remove();
  aside.classList.add('aside-grid__col');
  head.classList.add('aside-grid__head');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cd-aside-width';
  btn.dataset.testid = 'admin-aside-width';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = ICON;
  head.appendChild(btn);

  function syncButton() {
    const label = t('admin.asideWidth.button', { width: widthLabel(current()) });
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.classList.toggle('is-custom', isCustom());
  }

  // "All pages" already says exactly this: the all-pages width equals what is
  // shown and no page carries its own choice.
  function allPagesNoop() {
    const map = getUser()?.aside_widths || {};
    return hasAllPagesAsideWidth() && inherited() === current() && Object.keys(map).length === 1;
  }

  function render(pop) {
    const now = current();
    const markText = hasAllPagesAsideWidth() ? t('admin.asideWidth.allPagesMark') : t('admin.asideWidth.default');
    const item = (w) => {
      const mark = w === inherited()
        ? `<span class="admin-sidebar__width-mark"> · ${escHtml(markText)}</span>` : '';
      return `<button type="button" role="menuitemradio" data-aside-width="${w}" aria-checked="${now === w}" tabindex="-1">`
        + `<span class="admin-sidebar__width-tick" aria-hidden="true">✓</span>`
        + `<span class="admin-sidebar__width-name">${escHtml(widthLabel(w))}${mark}</span>`
        + `<span class="admin-sidebar__width-hint" aria-hidden="true">${HINT[w]}</span></button>`;
    };
    const noop = allPagesNoop();
    pop.setAttribute('aria-label', t('admin.asideWidth.title'));
    pop.innerHTML = `<div class="admin-sidebar__width-caption" aria-hidden="true">${escHtml(t('admin.asideWidth.title'))}</div>`
      + ASIDE_WIDTHS.map(item).join('')
      + `<div class="admin-sidebar__width-sep" role="separator"></div>`
      + `<button type="button" role="menuitem" data-aside-width-all="${noop ? 'clear' : 'set'}" tabindex="-1">`
      + `<span class="admin-sidebar__width-tick" aria-hidden="true"></span>`
      + `<span class="admin-sidebar__width-name">${escHtml(t(noop ? 'admin.asideWidth.clearAllPages' : 'admin.asideWidth.useOnAllPages'))}</span></button>`;
  }

  const { pop, close } = createWidthMenu({
    btn,
    parent: aside,
    className: 'cd-aside-width-pop',
    render,
    // Right-aligned under the icon. The column can be narrower than the menu,
    // so it may reach left over the main column — never off the screen.
    place(pop) {
      const r = btn.getBoundingClientRect();
      const a = aside.getBoundingClientRect();
      pop.style.top  = `${r.bottom - a.top + 4}px`;
      pop.style.left = `${Math.max(8 - a.left, r.right - a.left - pop.offsetWidth)}px`;
    },
  });

  pop.addEventListener('click', async (e) => {
    const all = e.target.closest('[data-aside-width-all]');
    if (all) {
      const clear = all.dataset.asideWidthAll === 'clear';
      const width = clear ? null : current();
      close(true);
      const saving = saveAllPagesAsideWidth(width);
      applyAsideWidth(grid, current());   // the cache is updated optimistically
      syncButton();
      const ok = await saving;
      applyAsideWidth(grid, current());
      if (!ok) showToast(t('admin.asideWidth.saveFailed'), 'error');
      else showToast(clear ? t('admin.asideWidth.allPagesCleared')
        : t('admin.asideWidth.allPagesSaved', { width: widthLabel(width).toLowerCase() }), 'success');
      syncButton();
      return;
    }
    const item = e.target.closest('[data-aside-width]');
    if (!item) return;
    const pick = item.dataset.asideWidth;
    applyAsideWidth(grid, pick);
    close(true);
    // The inherited width (the page default, or the all-pages width) is not
    // saved as a choice — it clears it, so the page follows it (and the dot goes).
    const saving = saveAsideWidth(key, pick === inherited() ? null : pick);
    syncButton();
    if (!(await saving)) {
      // Rolled back in the cache: put the column back too, so the width on
      // screen, the dot and the label all agree with what is saved.
      applyAsideWidth(grid, current());
      showToast(t('admin.asideWidth.saveFailed'), 'error');
    }
    syncButton();
  });

  syncButton();
}
