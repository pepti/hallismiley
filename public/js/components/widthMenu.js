// The small width popover shared by the two width icons: the page width on the
// sidebar's Breyta row (PageWidthControl.js) and the right-hand column width on
// the detail pages' top card (AsideWidthControl.js). Only the mechanics live
// here — what the rows say and what a click does stay with each control.
//
// A `role="menu"` of `menuitem*` buttons, parented to `parent` (absolutely
// positioned inside it by the caller's `place`). Closed by an outside
// pointerdown, Escape (focus back on the icon) or Tab; arrow keys / Home / End
// move between rows. The document listeners self-heal if an SPA navigation
// detaches `parent` while the menu is open.

export function createWidthMenu({ btn, parent, render, place, className = 'admin-sidebar__width-pop' }) {
  const pop = document.createElement('div');
  pop.className = className;
  pop.setAttribute('role', 'menu');
  pop.hidden = true;
  parent.appendChild(pop);

  const items = () => [...pop.querySelectorAll('[role^="menuitem"]')];

  function close(refocus) {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointerDown);
    document.removeEventListener('keydown', onDocKeydown);
    if (refocus) btn.focus();
  }

  function open() {
    render(pop);
    pop.hidden = false;
    place(pop);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeydown);
    (pop.querySelector('[aria-checked="true"]') || items()[0])?.focus();
  }

  function onDocPointerDown(e) {
    if (!parent.isConnected) { close(false); return; }
    if (pop.contains(e.target) || btn.contains(e.target)) return;
    close(false);
  }

  function onDocKeydown(e) {
    if (!parent.isConnected) { close(false); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
  }

  btn.addEventListener('click', () => (pop.hidden ? open() : close(true)));

  // Focus leaving the menu by any route (Tab, Shift+Tab, a script) closes it;
  // back onto the icon is the icon's own toggle.
  pop.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && (pop.contains(to) || to === btn)) return;
    if (to) close(false);
  });

  pop.addEventListener('keydown', (e) => {
    // Tab would carry focus into the page and leave the menu floating.
    if (e.key === 'Tab') { close(false); return; }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const all = items();
    const i = all.indexOf(document.activeElement);
    e.preventDefault();
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? all.length - 1
        : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  });

  return { pop, close, rerender: () => render(pop) };
}
