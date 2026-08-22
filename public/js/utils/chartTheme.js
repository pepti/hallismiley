// Chart.js palette, resolved from the live design tokens.
//
// A <canvas> paints pixels. Unlike every CSS surface in the app it does NOT
// react to the html[data-theme] flip, so chart colours must be READ at draw
// time and the charts rebuilt when the theme changes — never frozen in module
// constants. AdminAnalyticsView carried a hardcoded GOLD/TEAL/AXIS/GRID block
// that was frozen at one theme's values and wrong on the other five. Ported
// from icelandicstore #196; see .claude/rules/stack-invariants.md.
const PALETTE_TOKENS = [
  '--gold', '--teal', '--success', '--warning', '--error',
  '--nav-tint-violet', '--nav-tint-teal', '--nav-tint-brown',
];

/** Resolve at draw time, never at module scope. */
export function chartTokens() {
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  const accent = read('--gold', '#C8AA6E');
  return {
    accent,
    info:    read('--teal', '#0BC4E3'),
    success: read('--success', '#4caf78'),
    warning: read('--warning', '#E8A33D'),
    error:   read('--error', '#e05c5c'),
    axis:    read('--text-secondary', '#A9B4C0'),
    grid:    read('--border-dim', 'rgba(120, 90, 40, 0.3)'),
    font:    "'Barlow', 'Barlow Condensed', sans-serif",
    fill: (c, pct = 15) => `color-mix(in srgb, ${c} ${pct}%, transparent)`,
    palette: PALETTE_TOKENS.map((n, i) => read(n, i === 0 ? accent : '#888888')),
  };
}
