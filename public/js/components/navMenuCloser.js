// One document-level closer for every account menu the nav ever mounts,
// installed once.
//
// Ported from icelandicstore #379 (components/navChrome.js — only the generic
// closer; the /workshop kiosk header it was extracted for is ice's own). The
// nav used to add a `document` click listener on EVERY auth render: the top
// bar and the drawer, on each authchange, userchange and locale switch. A tab
// left open all day stacked one listener per re-render, each holding a
// detached dropdown (and its button) alive. One module-level listener closes
// whatever menus are open at click time instead.

/** Close every open account menu, except `except` (the one being toggled). */
export function closeMenus(except = null) {
  document.querySelectorAll('.lol-nav__dropdown.open').forEach(menu => {
    if (menu === except) return;
    menu.classList.remove('open');
    menu.parentElement?.querySelector('.lol-nav__user-btn')?.setAttribute('aria-expanded', 'false');
  });
}

let closerInstalled = false;

/** Install the document closer. Idempotent: the first call installs, the rest no-op. */
export function installMenuCloser() {
  if (closerInstalled) return;
  closerInstalled = true;
  document.addEventListener('click', () => closeMenus());
}

/** Test-only: forget the installed closer (a fresh fake document per test). */
export function _resetMenuCloserForTests() {
  closerInstalled = false;
}
