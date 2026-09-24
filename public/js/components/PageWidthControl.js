// Page width — one small icon in the admin sidebar, on the "Breyta" row, on
// every admin page (renderAdminShell mounts it). A set-once preference, so it
// stays out of each page's own header (2026-09-22, Halli: "elegant and not a
// huge button"; it first shipped inside three Fleiri aðgerðir menus, #401).
//
// Clicking the icon opens a small popover with three widths — Venjuleg 1280 /
// Breið 1920 / Allur skjárinn — the page's own default marked "· sjálfgefin".
// Picking the default row clears the saved choice (the page follows its
// default again); any other row saves it. A pick applies to the shell at once
// and saves to the account (services/pageWidth.js). The icon carries a dot
// while the page is off its default, so the way back is discoverable.
//
// The popover mechanics (close on outside pointerdown / Escape / Tab, arrow
// keys) are shared with the right-column icon — components/widthMenu.js. It is
// parented to the aside (a scroll container, so it is positioned against the
// scrolled content).

import { t } from '../i18n/i18n.js';
import { getUser } from '../services/auth.js';
import {
  WIDTHS, applyPageWidth, getPageWidth, savePageWidth, saveAllPagesWidth,
  inheritedWidth, hasAllPagesWidth, getMotion, applyMotion, saveMotion,
} from '../services/pageWidth.js';
import { escHtml } from '../utils/escHtml.js';
import { showToast } from './Toast.js';
import { createWidthMenu } from './widthMenu.js';

// Two bars with arrows pushing outward: "width".
const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.75 3v10M14.25 3v10M4.75 8h6.5M7 5.75 4.75 8 7 10.25M9 5.75 11.25 8 9 10.25"/></svg>';

// Quiet trailing hints: Halli defined the widths by these numbers. The full
// screen needs none — the name says it. Matches the caps in admin.css.
const HINT = { normal: '1280', wide: '1920', full: '' };

export function pageWidthButtonHtml() {
  return `<button type="button" class="admin-sidebar__width-btn" data-testid="admin-page-width"
    aria-haspopup="menu" aria-expanded="false">${ICON}</button>`;
}

const widthLabel = (w) => t('admin.pageWidth.' + w);

// Wire the icon rendered by pageWidthButtonHtml() inside `aside`. No-op when
// the page has no width key (the icon is not rendered then).
export function mountPageWidthControl(shell, aside) {
  const btn = aside.querySelector('.admin-sidebar__width-btn');
  const key = shell.dataset.widthKey;
  if (!btn || !key) return;
  const pageDefault = shell.dataset.widthDefault || 'normal';

  const current = () => getPageWidth(key, pageDefault);
  // What this page shows with no choice of its own: the all-pages width when
  // one is saved ("Nota á allar síður"), else the page's own default.
  const inherited = () => inheritedWidth(pageDefault);
  const isCustom = () => WIDTHS.includes(getUser()?.page_widths?.[key]);

  function syncButton() {
    const label = t('admin.pageWidth.button', { width: widthLabel(current()) });
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.classList.toggle('is-custom', isCustom());
  }

  function render(pop) {
    const now = current();
    const item = (w) => {
      const markText = hasAllPagesWidth() ? t('admin.pageWidth.allPagesMark') : t('admin.pageWidth.default');
      const mark = w === inherited()
        ? `<span class="admin-sidebar__width-mark"> · ${escHtml(markText)}</span>` : '';
      return `<button type="button" role="menuitemradio" data-page-width="${w}" aria-checked="${now === w}" tabindex="-1">`
        + `<span class="admin-sidebar__width-tick" aria-hidden="true">✓</span>`
        + `<span class="admin-sidebar__width-name">${escHtml(widthLabel(w))}${mark}</span>`
        + `<span class="admin-sidebar__width-hint" aria-hidden="true">${HINT[w]}</span></button>`;
    };
    pop.setAttribute('aria-label', t('admin.pageWidth.title'));
    pop.innerHTML = `<div class="admin-sidebar__width-caption" aria-hidden="true">${escHtml(t('admin.pageWidth.title'))}</div>`
      + WIDTHS.map(item).join('')
      // Mjúk hreyfing: slide to a new width instead of jumping (Halli,
      // 2026-09-22). A checkbox row — clicking it flips the tick in place.
      + `<div class="admin-sidebar__width-sep" role="separator"></div>`
      + `<button type="button" role="menuitemcheckbox" data-page-width-motion aria-checked="${getMotion()}" tabindex="-1">`
      + `<span class="admin-sidebar__width-tick" aria-hidden="true">✓</span>`
      + `<span class="admin-sidebar__width-name">${escHtml(t('admin.pageWidth.motion'))}</span></button>`
      // Apply what is shown here to every admin page (Orri, 2026-09-22). When
      // that is already the case the row turns into its undo: every page back
      // on its own default.
      + `<div class="admin-sidebar__width-sep" role="separator"></div>`
      + `<button type="button" role="menuitem" data-page-width-all="${allPagesNoop() ? 'clear' : 'set'}" tabindex="-1">`
      + `<span class="admin-sidebar__width-tick" aria-hidden="true"></span>`
      + `<span class="admin-sidebar__width-name">${escHtml(t(allPagesNoop() ? 'admin.pageWidth.clearAllPages' : 'admin.pageWidth.useOnAllPages'))}</span></button>`;
  }

  // "All pages" already says exactly this: the all-pages width equals what is
  // shown and no page carries its own choice.
  function allPagesNoop() {
    const map = getUser()?.page_widths || {};
    return hasAllPagesWidth() && inherited() === current() && Object.keys(map).length === 1;
  }

  const { pop, close, rerender } = createWidthMenu({
    btn,
    parent: aside,
    render,
    place(pop) {
      const r = btn.getBoundingClientRect();
      const a = aside.getBoundingClientRect();
      // The icon is on the sidebar's first row, so there is rarely room above:
      // open below, and flip only when it would not fit below AND does above
      // (a negative top inside the scroll container would be unreachable).
      const below = r.bottom - a.top + 4;
      const above = r.top - a.top - pop.offsetHeight - 4;
      const fitsBelow = below + pop.offsetHeight <= aside.clientHeight - 4;
      const top = (!fitsBelow && above >= 0) ? above : below;
      pop.style.top  = `${top + aside.scrollTop}px`;
      // Right-aligned under the icon, kept inside the aside.
      pop.style.left = `${Math.max(4, Math.min(r.right - a.left - pop.offsetWidth, a.width - pop.offsetWidth - 4))}px`;
    },
  });

  pop.addEventListener('click', async (e) => {
    if (e.target.closest('[data-page-width-motion]')) {
      // Stays open: the tick flips where the pointer is.
      const saving = saveMotion(!getMotion());
      applyMotion(shell);
      rerender();
      pop.querySelector('[data-page-width-motion]')?.focus();
      if (!(await saving)) {
        applyMotion(shell);
        rerender();
        showToast(t('admin.pageWidth.saveFailed'), 'error');
      }
      return;
    }
    const all = e.target.closest('[data-page-width-all]');
    if (all) {
      const clear = all.dataset.pageWidthAll === 'clear';
      const width = clear ? null : current();
      close(true);
      const saving = saveAllPagesWidth(width);
      applyPageWidth(shell, current());   // the cache is updated optimistically
      syncButton();
      const ok = await saving;
      applyPageWidth(shell, current());
      if (!ok) showToast(t('admin.pageWidth.saveFailed'), 'error');
      else showToast(clear ? t('admin.pageWidth.allPagesCleared')
        : t('admin.pageWidth.allPagesSaved', { width: widthLabel(width) }), 'success');
      syncButton();
      return;
    }
    const item = e.target.closest('[data-page-width]');
    if (!item) return;
    const pick = item.dataset.pageWidth;
    applyPageWidth(shell, pick);
    close(true);
    // The inherited width (the page default, or the all-pages width) is not
    // saved as a choice — it clears it, so the page follows it (and the dot goes).
    const saving = savePageWidth(key, pick === inherited() ? null : pick);
    syncButton();                       // the cache is updated optimistically
    const ok = await saving;
    if (!ok) {
      // Rolled back in the cache: put the page back too, so the width on
      // screen, the dot and the label all agree with what is saved.
      applyPageWidth(shell, current());
      showToast(t('admin.pageWidth.saveFailed'), 'error');
    }
    syncButton();
  });

  syncButton();
}
