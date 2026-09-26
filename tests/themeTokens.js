'use strict';

// Theme token reader + WCAG contrast, for the token-contrast unit test
// (tests/unit/themeTokenContrast.test.js). Ported from icelandicstore #313
// (219d33e) and #324 (8e977ae), harvest 2 lane 4a; the theme SET is read from
// the identity seam instead of a literal list.
//
// No browser: this reads the token files the way the cascade does — :root from
// variables.css, then the `html[data-theme="x"]` block of themes.css for every
// theme but the root one — resolves var() references, composites translucent
// inks over the surface, and computes WCAG 2.x contrast. A token edit that
// breaks a theme fails in the tests, before anyone flips the picker.
const fs = require('fs');
const path = require('path');
const { identity } = require('../server/config/identity');

const CSS = path.join(__dirname, '../public/css');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Custom properties only — `--x: a, b` values (gradients) keep their commas.
function blocks(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(strip(css)))) {
    const decls = {};
    const dre = /--([\w-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = dre.exec(m[2]))) decls[d[1]] = d[2].trim().replace(/\s+/g, ' ');
    out.push({ selector: m[1].trim(), decls });
  }
  return out;
}

const rootBlocks = blocks(fs.readFileSync(path.join(CSS, 'variables.css'), 'utf8')).filter(b => b.selector === ':root');
const themeBlocks = blocks(fs.readFileSync(path.join(CSS, 'themes.css'), 'utf8'));

// The product's theme set (identity.theme): `root` owns :root (no data-theme
// attribute), every other picker id is an html[data-theme] block.
const ROOT_THEME = identity.theme.root;
const THEMES = identity.theme.picker.slice();
const THEME_BLOCK_IDS = [...new Set(themeBlocks
  .map(b => (b.selector.match(/^html\[data-theme="([\w-]+)"\]$/) || [])[1]).filter(Boolean))];

function tokensFor(theme) {
  const t = {};
  for (const b of rootBlocks) Object.assign(t, b.decls);
  if (theme === ROOT_THEME) return t;
  for (const b of themeBlocks) {
    if (b.selector === 'html[data-theme]' || b.selector === `html[data-theme="${theme}"]`) Object.assign(t, b.decls);
  }
  return t;
}

function resolve(tokens, name, depth = 0) {
  const v = tokens[name];
  if (v === undefined) throw new Error(`--${name} is not defined`);
  const ref = v.match(/^var\(--([\w-]+)(?:\s*,[^)]*)?\)$/);
  if (!ref) return v;
  if (depth > 8) throw new Error(`var() loop at --${name}`);
  return resolve(tokens, ref[1], depth + 1);
}

function parseColor(v) {
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`not a colour: ${v}`);
}

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
});
const lum = ({ r, g, b }) => {
  const ch = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// A token's colour on a theme, composited over `onToken` when it is translucent.
function colour(theme, token, onToken) {
  const t = tokensFor(theme);
  const c = parseColor(resolve(t, token));
  return onToken ? over(c, parseColor(resolve(t, onToken))) : c;
}

// Every colour stop of a gradient token (e.g. --accent-gradient), or null when
// the theme does not define it.
function gradientStops(theme, token) {
  const v = tokensFor(theme)[token];
  if (!v) return null;
  return (v.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi) || []).map(parseColor);
}

module.exports = {
  THEMES, ROOT_THEME, THEME_BLOCK_IDS,
  tokensFor, resolve, parseColor, over, contrast, colour, gradientStops,
};
