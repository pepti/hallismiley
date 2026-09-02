// Pre-paint theme application. Loaded as a render-blocking classic script in
// <head> (index.html) so the theme is on <html> before first paint — no flash
// of the wrong theme on reload. Mirrors THEMES, DEFAULT_THEME and ROOT_THEME
// in services/themePrefs.js; keep the two in sync.
//
// Two different ideas that used to be one:
//   ROOT    — the theme whose tokens ARE :root, so it carries no attribute.
//   DEFAULT — what a visitor gets with nothing stored. Glóð since 2026-09-02
//             (Halli); before that it coincided with ROOT, which is why the
//             old code treated "no attribute" and "default" as the same thing.
(function () {
  var THEMES  = ['ember', 'classic', 'midnight']; // 'light'/'mono' retired 2026-09-02
  var DEFAULT = 'ember';
  var ROOT    = 'classic';
  var theme = null;
  try {
    theme = localStorage.getItem('ws_theme');
  } catch (_e) {
    /* storage blocked — the visitor gets the default like everyone else */
  }
  if (THEMES.indexOf(theme) === -1) theme = DEFAULT;
  if (theme !== ROOT) document.documentElement.setAttribute('data-theme', theme);
})();
