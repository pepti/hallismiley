// Client-side navigation helper. Single entry point for programmatic route
// changes: uses the History API (pushState) + fires a synthetic event the
// Router listens on. Use this instead of assigning to window.location.hash.
//
//   import { navigate } from './navigate.js';
//   navigate('/en/projects');
//
// Same-page anchor clicks in the DOM are already intercepted globally by
// Router.init() — this helper is for imperative cases (successful form
// submissions, login redirects, etc).

/** Fire the synthetic SPA navigation event without triggering a full page reload. */
function _fireNavigate() {
  window.dispatchEvent(new Event('spa:navigate'));
}

/** Push a new history entry and re-render the SPA. Pass a full path
 *  including the locale prefix, e.g. '/en/projects' or '/is/shop/my-mug'. */
export function navigate(path) {
  // Absolute URLs or external protocols: full-page navigation (let the
  // browser handle it). Everything else is internal.
  if (/^[a-z]+:\/\//i.test(path)) {
    window.location.href = path;
    return;
  }
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (path === current) return;          // no-op
  history.pushState(null, '', path);
  _fireNavigate();
}

/** Replace the current history entry (doesn't add to back stack). */
export function navigateReplace(path) {
  history.replaceState(null, '', path);
  _fireNavigate();
}
