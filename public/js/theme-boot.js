// Pre-paint theme application. Loaded as a render-blocking classic script in
// <head> (index.html) so the saved theme is on <html> before first paint —
// no flash of the default theme on reload. Mirrors the THEMES list and the
// data-theme rule in services/themePrefs.js; keep the two in sync.
(function () {
  var THEMES = ['classic', 'glacier', 'moss', 'lava', 'aurora', 'black-sand'];
  try {
    var theme = localStorage.getItem('ws_theme');
    // classic is the :root default → no attribute. Anything else applies.
    if (THEMES.indexOf(theme) !== -1 && theme !== 'classic') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    /* storage blocked — fall back to the default theme */
  }
})();
