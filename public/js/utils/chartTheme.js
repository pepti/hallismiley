// Chart.js palette, resolved from the live design tokens.
//
// A <canvas> paints pixels. Unlike every CSS surface in the app it does NOT
// react to the html[data-theme] flip, so chart colours must be READ at draw
// time and the charts rebuilt when the theme changes — never frozen in module
// constants. AdminAnalyticsView carried its own hardcoded GOLD/TEAL/AXIS/GRID
// block that had drifted to the original LoL palette (#C8AA6E) and matched no
// current theme at all. Ported from icelandicstore #196; see the theme-switch
// rule in .claude/rules/stack-invariants.md.

// Doughnut/segment palette, in order. Drawn from the admin nav tints so the
// charts share the admin's colour vocabulary on every theme.
const PALETTE_TOKENS = [
  '--gold', '--accent-blue', '--success', '--warning', '--error',
  '--nav-tint-violet', '--nav-tint-teal', '--nav-tint-brown',
];

/**
 * Resolve the chart palette against whichever theme is currently applied.
 * Call this inside the chart-building function, not at module scope.
 */
export function chartTokens() {
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  const accent = read('--gold', '#7B5533');
  return {
    accent,
    info:    read('--accent-blue', '#2A1F17'),
    success: read('--success', '#1c7c54'),
    warning: read('--warning', '#8A5300'),
    error:   read('--error', '#b3261e'),
    axis:    read('--text-secondary', 'rgba(18, 18, 18, 0.75)'),
    grid:    read('--border-dim', 'rgba(18, 18, 18, 0.10)'),
    font:    "'Barlow', 'Barlow Condensed', sans-serif",
    // Series fills are the same hue at low alpha. color-mix keeps them in the
    // token's own colour space instead of hardcoding a parallel rgba().
    fill: (c, pct = 15) => `color-mix(in srgb, ${c} ${pct}%, transparent)`,
    palette: PALETTE_TOKENS.map((n, i) => read(n, i === 0 ? accent : '#888888')),
  };
}
