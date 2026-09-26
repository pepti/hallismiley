'use strict';

// Token pairs that must clear WCAG contrast on EVERY theme in the product's
// picker (invariant 15). Ported from icelandicstore #313 (219d33e) and #324
// (8e977ae), harvest 2 lane 4a, and re-pointed at the pairs the ENGINE's CSS
// uses: the three text tokens on the four reading surfaces, --accent-ink,
// .btn--primary's label on every fill it can take, and the 3:1 non-text pairs
// (focus rings, the borders that mark a control's state, the drop zone's
// refusal outline). Change a token and this measures it on every theme, before
// anyone flips the picker.
//
// First run (2026-09-26) found two real failures, both fixed here rather than
// by lowering a threshold:
//   · Glóð --text-muted #9A8B78 was 4.24:1 on --bg-hover → re-hued #A3927E;
//   · Bjart .btn--primary:hover filled with --gold-light (#9C7149, white label
//     4.31:1) → the hover fill is --accent-hover, the contract token for it
//     (themes.css). #9C7149 itself is pinned by CLAUDE.md's palette rule.
// And one that needs a design decision (docs/history.d/2026-09-26-harvest2-
// lane4a-uikit.md): the RESTING input border, --border-dim, is 1.2–2.9:1 —
// see the test.todo at the end.
const fs = require('fs');
const path = require('path');
const { THEMES, ROOT_THEME, THEME_BLOCK_IDS, contrast, colour, gradientStops,
        tokensFor, resolve, parseColor, over } = require('../themeTokens');

const AA = 4.5;       // body-size text
const NON_TEXT = 3;   // WCAG 1.4.11 — a control's boundary / focus ring

const each = (name, fn) => test.each(THEMES.map((th) => [th]))(`%s: ${name}`, fn);

const SURFACES = ['bg-base', 'bg-surface', 'bg-elevated', 'bg-hover'];

// Every colour value in the rules of public/css/<file> whose selector names
// `.cls` (minus selectors matching `exclude`), comments stripped.
function ruleColours(file, cls, exclude = /^$/) {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(new RegExp(`([^{}]*\\.${cls}\\b[^{}]*)\\{([^{}]*)\\}`, 'g'))]
    .filter(([, sel]) => !exclude.test(sel));
  // Every border shorthand that can carry a colour; the lookahead keeps out the
  // border properties that cannot hold one (`border-radius: var(--radius-sm)`).
  const COLOUR_PROP = /(?:^|;)\s*(background|color|outline(?:-color)?|box-shadow|border(?!-(?:radius|width|style|image|spacing|collapse))(?:-[a-z]+)*)\s*:\s*([^;]+)/g;
  const colours = rules.flatMap(([, , body]) => [...body.matchAll(COLOUR_PROP)].map((m) => m[2].trim()));
  return { rules, colours };
}

// The rules may colour only with the measured tokens: no literal, and no var()
// fallback (an undefined token silently becomes its fallback).
function expectOnlyTokens(colours, allowed) {
  for (const v of colours) {
    expect(v).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
    for (const [, name, fallback] of v.matchAll(/var\(--([\w-]+)(\s*,[^)]*)?\)/g)) {
      expect(allowed).toContain(name);
      expect(fallback).toBeUndefined();
    }
  }
}

describe('theme token contrast', () => {
  test('every picker theme but the root one has a token block in themes.css', () => {
    expect(THEMES).toContain(ROOT_THEME);
    for (const th of THEMES.filter((x) => x !== ROOT_THEME)) expect(THEME_BLOCK_IDS).toContain(th);
  });

  describe('text on the reading surfaces (≥ 4.5:1)', () => {
    for (const ink of ['text-primary', 'text-secondary', 'text-muted']) {
      each(`--${ink} on base, surface, elevated and hover`, (theme) => {
        for (const s of SURFACES) {
          expect(contrast(colour(theme, ink, s), colour(theme, s))).toBeGreaterThanOrEqual(AA);
        }
      });
    }

    each('--accent-ink (accent-coloured text, the combobox match) on every surface', (theme) => {
      for (const s of SURFACES) {
        expect(contrast(colour(theme, 'accent-ink', s), colour(theme, s))).toBeGreaterThanOrEqual(AA);
      }
    });
  });

  describe('primary button (.btn--primary)', () => {
    each('--on-accent on --gold and on every stop of --accent-gradient', (theme) => {
      const ink = colour(theme, 'on-accent');
      expect(contrast(ink, colour(theme, 'gold'))).toBeGreaterThanOrEqual(AA);
      // Every channel moves one way between two stops, so the stops bound the ratio.
      for (const stop of gradientStops(theme, 'accent-gradient') || []) {
        expect(contrast(ink, stop)).toBeGreaterThanOrEqual(AA);
      }
    });

    each('--on-accent on the hover fill, --accent-hover', (theme) => {
      expect(contrast(colour(theme, 'on-accent'), colour(theme, 'accent-hover'))).toBeGreaterThanOrEqual(AA);
    });

    test('the hover fill IS --accent-hover (themes.css, loaded last, overrides components.css)', () => {
      const { rules, colours } = ruleColours('themes.css', 'btn--primary');
      const hover = rules.filter(([sel]) => /:hover/.test(sel));
      expect(hover.length).toBeGreaterThanOrEqual(1);
      expect(hover.some(([, , body]) => /background:\s*var\(--accent-hover\)/.test(body))).toBe(true);
      expect(colours.join(' ')).not.toMatch(/--gold-light/);
    });
  });

  describe('non-text (≥ 3:1): focus rings and the borders that mark a state', () => {
    // --text-primary: the select/radio/checkbox and table-wrap focus rings;
    // --gold: the focused .form-input border, .btn--outline, chip focus rings;
    // --accent-ink: the pressed .admin-chip border.
    for (const token of ['text-primary', 'gold', 'accent-ink']) {
      each(`--${token} against every surface`, (theme) => {
        for (const s of SURFACES) {
          expect(contrast(colour(theme, token), colour(theme, s))).toBeGreaterThanOrEqual(NON_TEXT);
        }
      });
    }

    each('the drop zone refusal: --error outline on the --error-dim wash, text on it ≥ 4.5', (theme) => {
      const t = tokensFor(theme);
      for (const s of ['bg-surface', 'bg-elevated']) {
        const wash = over(parseColor(resolve(t, 'error-dim')), parseColor(resolve(t, s)));
        expect(contrast(colour(theme, 'error'), wash)).toBeGreaterThanOrEqual(NON_TEXT);
        expect(contrast(over(parseColor(resolve(t, 'text-primary')), wash), wash)).toBeGreaterThanOrEqual(AA);
      }
    });

    // Needs Halli: the resting .form-input border is --border-dim, a hairline
    // (Bjart 1.24, Glóð 1.51, Miðnætti 2.80 : 1 on --bg-surface). Lifting it to
    // 3:1 re-hues every hairline on the site, which is a design decision, not a
    // contrast fix — recorded in the lane 4a fragment and PLAN.md.
    test.todo('the resting .form-input border (--border-dim) ≥ 3:1 on --bg-surface — awaiting a design decision');
  });

  describe('the rules these pairs stand for colour only with the measured tokens', () => {
    test('Combobox (admin-kit.css)', () => {
      for (const cls of ['combobox__list', 'combobox__opt', 'combobox__meta']) {
        const { rules, colours } = ruleColours('admin-kit.css', cls);
        expect(rules.length).toBeGreaterThanOrEqual(1);
        expectOnlyTokens(colours, ['bg-elevated', 'border', 'shadow-modal', 'text-primary', 'bg-hover', 'text-secondary', 'accent-ink']);
      }
    });

    test('.form-input[readonly] (components.css) is --text-secondary on --bg-hover', () => {
      const css = fs.readFileSync(path.join(__dirname, '../../public/css/components.css'), 'utf8');
      const body = (css.match(/\.form-input\[readonly\]\s*\{([^}]*)\}/) || [])[1] || '';
      expect(body).toMatch(/background:\s*var\(--bg-hover\)/);
      expect(body).toMatch(/color:\s*var\(--text-secondary\)/);
    });

    test('the drop-zone refusal (admin-products.css)', () => {
      const { rules, colours } = ruleColours('admin-products.css', 'admin-shop__dropzone');
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expectOnlyTokens(colours, ['error', 'error-dim']);
    });
  });
});
