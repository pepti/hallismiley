'use strict';

// Harvested from icelandicstore #410 (harvest-ice-b-2026-09-24); its first
// engine run found 21 references to 8 undefined tokens (admin-leads, news,
// party), fixed with tokens in the same change.
//
// Tree-wide guard for the failure that ice PR #409's review found: a rule asking
// for a token that IS NOT DEFINED ANYWHERE, so the literal fallback always
// wins. `background: var(--surface, #fff)` never once read a theme token — it
// painted white on all six themes, under `color: var(--text-primary)`, which is
// near-white on the five dark ones. That is failure shape 1 of stack-invariant
// §13 ("light literal + token text"), and it is invisible in review because the
// line *looks* tokenised.
//
// The no-fallback spelling is just as bad and even quieter: `var(--bg-dim)`
// with nothing behind it makes the whole declaration invalid, so the element
// silently loses its background (or its padding, for `var(--space-3)`).
//
// So: every var(--x) in public/css must name a token something defines.
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '../../public/css');
const files = fs.readdirSync(CSS).filter((f) => f.endsWith('.css'));

// Custom properties set from JS as an inline style, per element — they are
// deliberately undefined in the stylesheet and always carry a fallback or are
// written by the view that uses them. Anything NOT on this list must resolve.
const JS_INJECTED = new Set([
  '--swatch',        // ThemeSwitcher.js / ProfileView.js — a theme's swatch fill
  '--role-accent',   // AdminRolesView.js — per-role accent
  '--hb-image-scale', // HalliView.js — the bio images' scale slider
  '--focal',         // scenes/SceneStage.js — a scene image's focal point
]);

const declared = new Set();
const used = [];
for (const file of files) {
  const src = fs.readFileSync(path.join(CSS, file), 'utf8');
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
  src.split(/\r?\n/).forEach((line, i) => {
    if (line.trim().startsWith('*') || line.trim().startsWith('/*')) return;
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)/g)) used.push({ file, line: i + 1, token: m[1] });
  });
}

describe('every CSS token a rule asks for is defined', () => {
  test('the token files parsed', () => {
    expect(files).toEqual(expect.arrayContaining(['variables.css', 'themes.css']));
    expect(declared.has('--bg-surface')).toBe(true);
    expect(used.length).toBeGreaterThan(500);
  });

  test('no var(--token) names a token nothing defines', () => {
    const orphans = used
      .filter((u) => !declared.has(u.token) && !JS_INJECTED.has(u.token))
      .map((u) => `${u.file}:${u.line}  ${u.token}`);
    expect(orphans).toEqual([]);
  });

  // The specific shape the reviewer caught: an undefined token whose fallback
  // is a hardcoded colour. Even where it happens to look right on classic, the
  // fallback is frozen and cannot follow the theme.
  test('no undefined token falls back to a literal colour', () => {
    const frozen = [];
    for (const file of files) {
      fs.readFileSync(path.join(CSS, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\s*\)/g)) {
          if (!declared.has(m[1]) && !JS_INJECTED.has(m[1])) frozen.push(`${file}:${i + 1}  var(${m[1]}, ${m[2]})`);
        }
      });
    }
    expect(frozen).toEqual([]);
  });
});
