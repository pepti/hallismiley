// Trailing-edge debounce.
//
// Existed as ~10 hand-rolled copies across the admin views before this, at two
// different delays (250 ms in Leads/Accounts/Customers/Markaður, 300 ms in
// Monitoring/Users) with no shared default and no way to cancel — so a view that
// was destroyed mid-keystroke still fired its search a moment later, against a
// DOM that had already been torn down.
//
// 250 ms is the house default: fast enough to feel live, slow enough that a
// typed word is one request rather than five.

export function debounce(fn, ms = 250) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  // Call from a view's destroy() so a pending run cannot outlive the view.
  wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  // True while a call is queued — useful in tests and for "searching…" hints.
  wrapped.pending = () => timer !== null;
  return wrapped;
}
