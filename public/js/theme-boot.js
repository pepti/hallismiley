// Pre-paint theme application. Loaded as a render-blocking classic script in
// <head> (index.html) so the theme is on <html> before first paint — no flash
// of the wrong theme on reload. It runs before any module can, so it cannot
// import utils/identity.js: the theme trio arrives on the <html> element
// instead — data-theme-picker / data-default-theme / data-root-theme, written
// per request by server/middleware/ssrMeta.js from identity.theme (the
// product's config/client.json). The literals below are the engine defaults
// (Orange Smiley's set) for a shell that never passed through SSR; they are
// the same values services/themePrefs.js falls back to.
//
// Two different ideas that used to be one:
//   ROOT    — the theme whose tokens ARE :root, so it carries no attribute.
//   DEFAULT — what a visitor gets with nothing stored. Glóð since 2026-09-02
//             (Halli); before that it coincided with ROOT, which is why the
//             old code treated "no attribute" and "default" as the same thing.
(function () {
  var html    = document.documentElement;
  var picker  = html.getAttribute('data-theme-picker');
  var THEMES  = picker ? picker.split(/\s+/).filter(Boolean) : ['ember', 'classic', 'midnight'];
  var DEFAULT = html.getAttribute('data-default-theme') || 'ember';
  var ROOT    = html.getAttribute('data-root-theme') || 'classic';
  var theme = null;
  try {
    theme = localStorage.getItem('ws_theme');
  } catch (_e) {
    /* storage blocked — the visitor gets the default like everyone else */
  }
  if (THEMES.indexOf(theme) === -1) theme = DEFAULT;
  if (theme !== ROOT) html.setAttribute('data-theme', theme);
})();
