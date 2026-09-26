// A horizontal scrollbar for a wide table that stays on screen.
//
// An .admin-table-wrap scrolls sideways on its own, but its native scrollbar
// sits under the LAST row — below the fold on a 50-row list — so in a window
// that is not full screen the right-hand columns were effectively unreachable
// (change request on /admin/shop/orders, 2026-09). This adds a mirror bar right
// after the wrap with `position: sticky; bottom: 0`: it rides the bottom of the
// viewport while the table is in view and settles under the table at its end.
// The wrap's own bar is hidden (.has-sticky-hscroll) so the two never stack;
// trackpad and shift+wheel scrolling on the table itself keep working and move
// the mirror with them.
//
// attachStickyHScroll(wrap, { label }) → { refresh, detach }. Call refresh()
// whenever the wrap's content is re-rendered (a replaced <table> is not observed).
//
// Keyboard reach (WCAG 2.1.1; the pattern of icelandicstore #279, 39fe3d5): a
// region that scrolls sideways must be focusable, or a keyboard user cannot
// reach the columns a mouse user scrolls to. The mirror bar is aria-hidden, so
// it is the WRAP that takes tabindex="0", role="region" and an aria-label —
// only while it actually overflows (a focus stop that scrolls nothing is noise).
// Overflow is re-measured by a ResizeObserver, on window resize and on
// `visibilitychange`: a tab that is not painting delivers no ResizeObserver
// callbacks, but still computes layout, so a size change made while hidden is
// caught the moment the page is looked at again. Attributes the wrap carried
// before attach are its own and are never touched.

import { t } from '../i18n/i18n.js';

export function attachStickyHScroll(wrap, { label } = {}) {
  const bar = document.createElement('div');
  bar.className = 'hscroll-sticky';
  bar.setAttribute('aria-hidden', 'true'); // a mirror of the wrap's own scroll
  bar.hidden = true;
  const track = document.createElement('div');
  track.className = 'hscroll-sticky__track';
  bar.appendChild(track);
  wrap.after(bar);

  // Writing one side's scrollLeft queues a scroll event on THAT side, delivered
  // a frame later. By then a smooth or momentum scroll (shift+wheel animates in
  // Chrome) or a thumb drag has moved the originating side on, so answering the
  // echo would drag it back and the two would fight. Each write records the
  // value it landed on; the event reporting exactly that value is the echo.
  let echoWrap = null;
  let echoBar  = null;
  const write = (el, x) => {
    const before = el.scrollLeft;
    el.scrollLeft = x;
    // No change → no event will come, so nothing to swallow.
    if (el.scrollLeft === before) return;
    if (el === bar) echoBar = el.scrollLeft; else echoWrap = el.scrollLeft;
  };
  const onWrap = () => {
    const echo = echoWrap !== null && Math.abs(wrap.scrollLeft - echoWrap) < 1;
    echoWrap = null;
    if (!echo) write(bar, wrap.scrollLeft);
  };
  const onBar = () => {
    const echo = echoBar !== null && Math.abs(bar.scrollLeft - echoBar) < 1;
    echoBar = null;
    if (!echo) write(wrap, bar.scrollLeft);
  };
  wrap.addEventListener('scroll', onWrap, { passive: true });
  bar.addEventListener('scroll', onBar, { passive: true });

  // Only the attributes this module adds are ever removed again.
  const OWN = ['tabindex', 'role', 'aria-label'].filter((a) => !wrap.hasAttribute(a));
  const setFocusable = (on) => {
    for (const a of OWN) {
      if (!on) { wrap.removeAttribute(a); continue; }
      if (a === 'tabindex') wrap.setAttribute(a, '0');
      else if (a === 'role') wrap.setAttribute(a, 'region');
      else wrap.setAttribute(a, label || t('adminKit.scrollRegion'));
    }
  };

  const refresh = () => {
    const overflow = wrap.scrollWidth > wrap.clientWidth + 1;
    setFocusable(overflow);
    bar.hidden = !overflow;
    // The wrap's own scrollbar is hidden only while the mirror is actually
    // showing — if refresh never sees the overflow, the native bar stays.
    wrap.classList.toggle('has-sticky-hscroll', overflow);
    if (!overflow) return;
    // Layout width only, not colour — the bar's look comes from layout.css tokens.
    track.style.width = `${wrap.scrollWidth}px`;
    write(bar, wrap.scrollLeft);
  };

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  ro?.observe(wrap);
  window.addEventListener('resize', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();

  return {
    refresh,
    detach() {
      ro?.disconnect();
      window.removeEventListener('resize', refresh);
      document.removeEventListener('visibilitychange', refresh);
      wrap.removeEventListener('scroll', onWrap);
      bar.removeEventListener('scroll', onBar);
      wrap.classList.remove('has-sticky-hscroll');
      setFocusable(false);
      bar.remove();
    },
  };
}
