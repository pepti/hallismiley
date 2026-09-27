'use strict';

// ── The transactional email palette, derived from the instance's theme ──────
//
// Ported from icelandicstore #179 (2026-08-19): every email moved off the
// inherited DARK shell (near-black page, #111 card, gold #c9a84c, a #444
// footer at 2.00:1 on #0d0d0d) onto the site's LIGHT palette, with a text ramp that clears
// WCAG AA on the surface it sits on. Ice spelled its palette out as literal
// hex; the engine cannot — every downstream has its own theme — so the values
// are READ from the instance's theme tokens at boot (harvest 2 lane 2,
// 2026-09-26):
//
//   1. the theme: the first LIGHT theme among identity.theme.root,
//      identity.theme.default and the picker ("light" = not listed in
//      identity.theme.dark AND a card surface that measures light). Email is
//      light-only by design — Apple Mail and Outlook auto-invert an undeclared
//      light mail, and a dark mail is unreadable in half the clients — so a
//      dark default theme (Glóð here) is skipped, not converted;
//   2. its tokens: the `:root` block of public/css/variables.css, with the
//      theme's `html[data-theme="<id>"]` block from themes.css on top when
//      the theme is not the root. Email clients do not resolve var(), so
//      every value is resolved here to a literal #RRGGBB (var() chains
//      followed, rgba() composited onto the surface under it);
//   3. identity.email.palette overrides, role by role (config/client.json);
//   4. the AA guard: every text colour is measured against every surface it
//      is painted on (TEXT_PAIRS). A pair under 4.5:1 is replaced by the next
//      candidate that passes (the role's darker neighbour, then the ink, then
//      black/white) and a warning is returned for the boot log — a product
//      whose theme or override would ship an unreadable mail gets a readable
//      one plus a log line, never a crash (clientConfig's rule of the road).
//
// A token that cannot be resolved (missing, a gradient, color-mix()) falls
// back to FALLBACK for that role only. tests/unit/emailPalette.test.js
// computes the contrast of every text colour the shell uses, for this
// instance's resolved palette and for FALLBACK.

const fs   = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '../../public/css');

// The palette roles, and what each one paints (emailService.js uses exactly
// these names; clientConfig validates identity.email.palette against them).
//   page      outer background + footer band
//   card      the message card and its header
//   panel     an inset box inside the card (when-and-where, provenance note)
//   border    hairlines (card edge, table rules)
//   heading   headings and the strongest values (totals, names)
//   text      body copy
//   muted     secondary lines, labels, the footer
//   accent    links and accent-coloured emphasis — the text-safe accent
//   button    the filled call-to-action
//   onButton  the label on `button`
const ROLES = Object.freeze(['page', 'card', 'panel', 'border', 'heading', 'text', 'muted', 'accent', 'button', 'onButton']);

// Neutral, not any product's brand: what a role gets when its token cannot be
// resolved. Measured: heading 17.40, text 10.86, muted 7.00, accent 17.40 on
// card #FFFFFF; muted 6.37 on page/panel #F4F4F4; onButton 17.40 on button.
const FALLBACK = Object.freeze({
  page:     '#F4F4F4',
  card:     '#FFFFFF',
  panel:    '#F4F4F4',
  border:   '#DDDDDD',
  heading:  '#1A1A1A',
  text:     '#3D3D3D',
  muted:    '#595959',
  accent:   '#1A1A1A',
  button:   '#1A1A1A',
  onButton: '#FFFFFF',
});

// Where each role comes from in the theme's tokens, in preference order.
// `border` is the ink hairline composited onto the card; `panel` reuses the
// page colour (an inset box reads as "the page showing through").
const TOKEN_SOURCES = Object.freeze({
  page:     ['--bg-base'],
  card:     ['--bg-surface', '--bg-elevated'],
  panel:    ['--bg-base'],
  border:   ['--border', '--border-dim'],
  heading:  ['--text-primary'],
  text:     ['--text-secondary'],
  muted:    ['--text-muted'],
  accent:   ['--accent-ink', '--gold-dark'],
  button:   ['--gold', '--accent-ink'],
  onButton: ['--on-accent'],
});

// Every (text colour, surface) pair the shell paints — the AA contract.
// Kept in step with emailService.js by tests/unit/emailPalette.test.js, which
// scans the rendered mails for any colour this list does not cover.
const TEXT_PAIRS = Object.freeze([
  ['heading', 'card'], ['text', 'card'], ['muted', 'card'], ['accent', 'card'],
  ['heading', 'panel'], ['text', 'panel'], ['muted', 'panel'], ['accent', 'panel'],
  ['muted', 'page'], ['accent', 'page'],
  ['onButton', 'button'],
]);

const AA = 4.5;

// The email font: the theme's body face first (a recipient who has it gets
// the brand voice), then the bare generic `sans-serif` — the design rules'
// tail for every stack; no named system face is added. Named defaults banned
// by the design rules are dropped even from here; the generic tail is
// re-added once.
const BANNED_FONTS = /^(inter|roboto|open sans|arial|system-ui|space grotesk|-apple-system|blinkmacsystemfont)$/i;
const MAIL_FONT_TAIL = ['sans-serif'];
const FALLBACK_FONT = MAIL_FONT_TAIL.join(', ');

// ── Colour maths ─────────────────────────────────────────────────────────────

function parseColor(value) {
  const v = String(value || '').trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const c = (x) => Math.max(0, Math.min(255, Math.round(parseFloat(x))));
    return { r: c(m[1]), g: c(m[2]), b: c(m[3]), a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** `fg` (possibly translucent) composited onto the opaque `bg`, as #RRGGBB. */
function composite(fg, bg) {
  const f = typeof fg === 'string' ? parseColor(fg) : fg;
  const b = typeof bg === 'string' ? parseColor(bg) : bg;
  if (!f || !b) return null;
  const a = f.a;
  return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
}

function luminance(color) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  const lin = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2.x contrast ratio of two opaque colours. */
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── CSS token reading ────────────────────────────────────────────────────────

function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// The declarations of every top-level rule whose selector list contains
// `selector` exactly (whitespace-insensitive), later rules winning.
function tokensFor(css, selector) {
  const src = stripComments(css);
  const want = selector.replace(/\s+/g, '');
  const out = {};
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const sel = src.slice(i, open).trim();
    // Find the matching close brace (nested @media blocks are skipped whole).
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (!sel.startsWith('@') && sel.split(',').some((s) => s.replace(/\s+/g, '') === want)) {
      const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
      let m;
      while ((m = re.exec(body))) out[m[1]] = m[2].trim();
    }
    i = j;
  }
  return out;
}

// Follow var(--x[, fallback]) to a literal, a few levels deep.
function resolveVar(tokens, value, depth = 0) {
  const v = String(value || '').trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (!m) return v;
  if (depth > 5) return null;
  const next = tokens[m[1]] !== undefined ? tokens[m[1]] : m[2];
  return next === undefined ? null : resolveVar(tokens, next, depth + 1);
}

function tokenColor(tokens, name) {
  const v = resolveVar(tokens, tokens[name]);
  return v ? parseColor(v) : null;
}

function mailFont(tokens) {
  const raw = resolveVar(tokens, tokens['--font-sans'] || tokens['--font-display'] || '') || '';
  const families = raw.split(',')
    .map((f) => f.trim().replace(/"/g, "'"))
    .filter((f) => f && /^[A-Za-z0-9 '-]+$/.test(f))
    .filter((f) => !/^(sans-serif|serif|monospace)$/i.test(f))
    .filter((f) => !BANNED_FONTS.test(f.replace(/'/g, '')));
  const tail = MAIL_FONT_TAIL.filter((t) => !families.includes(t));
  return families.length ? [...families, ...tail].join(', ') : FALLBACK_FONT;
}

// ── Resolution ───────────────────────────────────────────────────────────────

function isLightSurface(color) {
  return !!color && luminance(color) > 0.4;
}

/** The theme ids to try, in order: root, default, then the picker. */
function candidateThemes(themeCfg = {}) {
  const dark = new Set(themeCfg.dark || []);
  const order = [themeCfg.root, themeCfg.default, ...(themeCfg.picker || [])].filter(Boolean);
  return [...new Set(order)].filter((id) => !dark.has(id));
}

/**
 * Pure: derive the palette from CSS text + an identity record.
 * @param {object} opts
 * @param {object} opts.identity     the resolved identity (theme + email)
 * @param {string} opts.rootCss      public/css/variables.css
 * @param {string} opts.themesCss    public/css/themes.css
 * @returns {{ palette: object, font: string, theme: string|null, warnings: string[] }}
 */
function resolveEmailPalette({ identity = {}, rootCss = '', themesCss = '' } = {}) {
  const warnings = [];
  const themeCfg = identity.theme || {};
  const rootTokens = tokensFor(rootCss, ':root');

  let tokens = null;
  let theme = null;
  for (const id of candidateThemes(themeCfg)) {
    const t = id === themeCfg.root
      ? rootTokens
      : { ...rootTokens, ...tokensFor(themesCss, `html[data-theme="${id}"]`) };
    const card = tokenColor(t, '--bg-surface') || tokenColor(t, '--bg-elevated');
    if (card && card.a === 1 && isLightSurface(card)) { tokens = t; theme = id; break; }
  }
  if (!tokens) {
    warnings.push('email palette: no light theme among identity.theme root/default/picker — using the neutral fallback');
  }

  const palette = { ...FALLBACK };
  if (tokens) {
    // Surfaces first: translucent inks composite onto them.
    for (const role of ['card', 'page', 'panel']) {
      const c = TOKEN_SOURCES[role].map((n) => tokenColor(tokens, n)).find(Boolean);
      if (c) palette[role] = c.a === 1 ? toHex(c) : composite(c, palette.card);
    }
    for (const role of ROLES.filter((r) => !['card', 'page', 'panel'].includes(r))) {
      const c = TOKEN_SOURCES[role].map((n) => tokenColor(tokens, n)).find(Boolean);
      if (c) palette[role] = composite(c, role === 'onButton' ? palette.button : palette.card);
    }
  }

  // identity.email.palette overrides (validated as #hex by clientConfig).
  const overrides = (identity.email && identity.email.palette) || {};
  for (const [role, value] of Object.entries(overrides)) {
    if (!ROLES.includes(role)) continue;
    const c = parseColor(value);
    if (c) palette[role] = composite(c, palette.card);
  }

  enforceAA(palette, warnings);
  return { palette: Object.freeze(palette), font: tokens ? mailFont(tokens) : FALLBACK_FONT, theme, warnings };
}

// Replace any failing text colour by the first candidate that clears AA on
// every surface it is painted on. The button is the one surface that moves
// instead of its label (a label colour is a contract: --on-accent).
function enforceAA(palette, warnings) {
  const surfacesOf = (fg) => TEXT_PAIRS.filter(([f]) => f === fg).map(([, bg]) => bg);
  const passes = (fg, bgs) => bgs.every((bg) => contrastRatio(fg, palette[bg]) >= AA);
  const bw = (bgs) => (bgs.every((bg) => contrastRatio('#000000', palette[bg]) >= contrastRatio('#FFFFFF', palette[bg])) ? '#000000' : '#FFFFFF');

  // The button first: its label is fixed, so try darker fills.
  if (contrastRatio(palette.onButton, palette.button) < AA) {
    const was = palette.button;
    const fill = [palette.accent, palette.heading, FALLBACK.button].find((c) => contrastRatio(palette.onButton, c) >= AA);
    if (fill) palette.button = fill;
    else palette.onButton = bw(['button']);
    warnings.push(`email palette: button ${was} under ${palette.onButton} fails AA — using ${palette.button}`);
  }

  const ladder = { muted: ['text', 'heading'], text: ['heading'], accent: ['heading'], heading: [] };
  for (const role of ['heading', 'text', 'muted', 'accent']) {
    const bgs = surfacesOf(role);
    if (passes(palette[role], bgs)) continue;
    const was = palette[role];
    const pick = [...ladder[role].map((r) => palette[r]), FALLBACK[role]].find((c) => passes(c, bgs)) || bw(bgs);
    palette[role] = pick;
    warnings.push(`email palette: ${role} ${was} fails AA on ${bgs.join('/')} — using ${pick}`);
  }
}

/** Read the instance's CSS and resolve (boot time). */
function loadEmailPalette(identity, cssDir = CSS_DIR) {
  const read = (f) => { try { return fs.readFileSync(path.join(cssDir, f), 'utf8'); } catch { return ''; } };
  return resolveEmailPalette({ identity, rootCss: read('variables.css'), themesCss: read('themes.css') });
}

module.exports = {
  ROLES, FALLBACK, TEXT_PAIRS, AA,
  resolveEmailPalette, loadEmailPalette,
  contrastRatio, parseColor, composite, tokensFor,
};
