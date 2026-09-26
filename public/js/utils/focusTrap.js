// Keep keyboard focus inside a dialog while it is open (harvest2-lane7a, for
// the site announcement's modal — components/CutoverNotice.js). Tab from the
// last focusable element wraps to the first, Shift+Tab from the first to the
// last, and focus that escapes (a click on the page behind) is pulled back.
// release() removes the listeners and returns focus to where it was before
// the dialog opened. Pure DOM, no dependencies.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The elements Tab can reach inside `root`, in DOM order. */
export function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden]'));
}

/**
 * @param {HTMLElement} root  the dialog element
 * @param {{ initial?: HTMLElement }} [opts]  where focus starts (default: the first focusable)
 * @returns {() => void} release
 */
export function trapFocus(root, { initial } = {}) {
  const previous = document.activeElement;
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusableIn(root);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  };
  const onFocusIn = (e) => {
    if (!root.contains(e.target)) (focusableIn(root)[0] || root).focus();
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocusIn);
  (initial || focusableIn(root)[0] || root).focus();
  return function release() {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocusIn);
    if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
  };
}
