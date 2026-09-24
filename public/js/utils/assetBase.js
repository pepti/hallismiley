// Where this release's /js/ tree lives: '/js/_<tag>/' when the shell pointed
// main.js at a release-stamped prefix (server/middleware/ssrMeta.js), '/js/'
// otherwise (a local checkout, a test page).
//
// Imports resolve against the importing module, so they follow the prefix on
// their own; this is for the things that are NOT imports — a fetch() of a
// locale file, a classic <script src> — which would otherwise ask for the
// unstamped /js/… URL and could pair another release's file with this code.
// (import.meta.url would say the same thing, but Jest's Babel transform runs
// these modules as CommonJS, where import.meta is a syntax error.)

let _base = null;

export function jsBase() {
  if (_base) return _base;
  let base = '/js/';
  try {
    const main = typeof document !== 'undefined'
      && document.querySelector('script[type="module"][src$="/main.js"]');
    if (main) base = new URL('.', main.src).pathname;
  } catch { /* no DOM, or an odd src — the unstamped tree still works */ }
  _base = base;
  return base;
}

/** jsUrl('i18n/is.json') → '/js/_<tag>/i18n/is.json' (or '/js/i18n/is.json'). */
export function jsUrl(rel) {
  return jsBase() + String(rel).replace(/^\.?\//, '');
}
