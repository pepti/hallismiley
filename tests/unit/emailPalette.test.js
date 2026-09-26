'use strict';

/**
 * The transactional email palette (harvest 2 lane 2, 2026-09-26; ported from
 * icelandicstore #179): light, derived at boot from this product's first LIGHT
 * theme's tokens (server/utils/emailPalette.js), every text colour held to
 * WCAG AA 4.5:1 on each surface it is painted on.
 *
 * Pinned here:
 *  1. the maths and the token reader (var() chains, rgba composited);
 *  2. theme choice — a dark root/default is skipped, no light theme at all
 *     falls back to the neutral palette with a warning;
 *  3. the AA guard — an override or a theme that fails is replaced + warned;
 *  4. THIS instance: its resolved palette needs no guard, and EVERY colour in
 *     every rendered mail (all twelve senders) clears AA on the surfaces text
 *     sits on — measured from the real HTML, not from a list. A colour
 *     literal outside the palette fails the suite.
 *
 * The Resend client is replaced so nothing is sent.
 */
const fs = require('fs');
const path = require('path');

const sent = [];
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn(async (msg) => { sent.push(msg); return { data: { id: 'msg-1' }, error: null }; }) },
  })),
}));

const {
  ROLES, FALLBACK, TEXT_PAIRS, AA, resolveEmailPalette, loadEmailPalette, contrastRatio, composite, tokensFor,
} = require('../../server/utils/emailPalette');
const { identity } = require('../../server/config/identity');
const { renderAllEmails } = require('../lib/renderAllEmails');

const ROOT = path.join(__dirname, '../..');
const { role } = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine.json'), 'utf8'));
const testEngine = role === 'engine' ? test : test.skip;

const LIGHT_ROOT = `:root {
  --bg-base: #F0F0F0; --bg-surface: #FFFFFF;
  --ink: #111111; --text-primary: var(--ink); --text-secondary: #444444; --text-muted: #666666;
  --border: rgba(0, 0, 0, 0.5); --accent-ink: #1B4D3E; --gold: #1B4D3E; --on-accent: #FFFFFF;
  --font-sans: 'Fraunces', Arial, system-ui, sans-serif;
}`;
const THEME = (extra = {}) => ({ root: 'classic', default: 'classic', picker: ['classic'], dark: [], ...extra });

describe('email palette — colour maths and token reading', () => {
  test('contrast ratio matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#444444', '#0A0A0A')).toBeLessThan(AA);   // the old footer, on the old page
  });

  test('rgba composites onto the surface under it', () => {
    expect(composite('rgba(0, 0, 0, 0.5)', '#FFFFFF')).toBe('#808080');
    expect(composite('#123456', '#FFFFFF')).toBe('#123456');
  });

  test('tokensFor reads one selector, skipping comments and @media blocks', () => {
    const css = `/* :root { --x: #000; } */ :root { --a: #111; }
      @media (prefers-color-scheme: dark) { :root { --a: #222; } }
      html[data-theme="x"], .other { --a: #333; }`;
    expect(tokensFor(css, ':root')).toEqual({ '--a': '#111' });
    expect(tokensFor(css, 'html[data-theme="x"]')).toEqual({ '--a': '#333' });
  });

  test('var() chains resolve and the font drops banned faces', () => {
    const r = resolveEmailPalette({ identity: { theme: THEME() }, rootCss: LIGHT_ROOT });
    expect(r.palette.heading).toBe('#111111');
    expect(r.palette.border).toBe('#808080');
    expect(r.font).toBe("'Fraunces', 'Segoe UI', Helvetica, sans-serif");
    expect(r.font).not.toMatch(/Arial|system-ui/);
    expect(r.warnings).toEqual([]);
  });
});

describe('email palette — theme choice', () => {
  const themesCss = `html[data-theme="dusk"] { --bg-surface: #101010; --bg-base: #000000; }
                     html[data-theme="paper"] { --bg-surface: #FFFDF5; --text-primary: #202020; }`;
  const darkRoot = LIGHT_ROOT.replace('--bg-surface: #FFFFFF', '--bg-surface: #151515');

  test('a dark root is skipped for the first light picker theme', () => {
    const r = resolveEmailPalette({
      identity: { theme: { root: 'classic', default: 'dusk', picker: ['dusk', 'paper'], dark: ['dusk'] } },
      rootCss: darkRoot, themesCss,
    });
    expect(r.theme).toBe('paper');
    expect(r.palette.card).toBe('#FFFDF5');
    expect(r.palette.heading).toBe('#202020');
  });

  test('no light theme at all → the neutral fallback, with a warning', () => {
    const r = resolveEmailPalette({
      identity: { theme: { root: 'classic', default: 'dusk', picker: ['dusk'], dark: ['dusk'] } },
      rootCss: darkRoot, themesCss,
    });
    expect(r.theme).toBeNull();
    expect({ ...r.palette }).toEqual({ ...FALLBACK });
    expect(r.warnings).toEqual([expect.stringMatching(/no light theme/)]);
  });

  test('the neutral fallback clears AA on every pair', () => {
    for (const [fg, bg] of TEXT_PAIRS) expect(contrastRatio(FALLBACK[fg], FALLBACK[bg])).toBeGreaterThanOrEqual(AA);
  });
});

describe('email palette — the AA guard', () => {
  test('an override that passes is applied as given', () => {
    const r = resolveEmailPalette({ identity: { theme: THEME(), email: { palette: { accent: '#0B5D3B' } } }, rootCss: LIGHT_ROOT });
    expect(r.palette.accent).toBe('#0B5D3B');
    expect(r.warnings).toEqual([]);
  });

  test('a failing text colour is replaced by a passing one, and logged', () => {
    const r = resolveEmailPalette({ identity: { theme: THEME(), email: { palette: { muted: '#BBBBBB' } } }, rootCss: LIGHT_ROOT });
    expect(r.palette.muted).not.toBe('#BBBBBB');
    expect(r.warnings).toEqual([expect.stringMatching(/muted #BBBBBB fails AA/)]);
    for (const [fg, bg] of TEXT_PAIRS) expect(contrastRatio(r.palette[fg], r.palette[bg])).toBeGreaterThanOrEqual(AA);
  });

  test('a button its label cannot be read on takes a darker fill', () => {
    const r = resolveEmailPalette({ identity: { theme: THEME(), email: { palette: { button: '#9C7149' } } }, rootCss: LIGHT_ROOT });
    expect(contrastRatio(r.palette.onButton, r.palette.button)).toBeGreaterThanOrEqual(AA);
    expect(r.warnings).toEqual([expect.stringMatching(/button #9C7149/)]);
  });
});

describe('email palette — this instance', () => {
  const resolved = loadEmailPalette(identity);

  test('resolves from a light theme with no guard needed', () => {
    expect(resolved.theme).not.toBeNull();
    expect(resolved.warnings).toEqual([]);
    expect(Object.keys(resolved.palette).sort()).toEqual([...ROLES].sort());
  });

  test('every text pair clears WCAG AA', () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(resolved.palette[fg], resolved.palette[bg]);
      expect({ pair: `${fg} on ${bg}`, pass: ratio >= AA }).toEqual({ pair: `${fg} on ${bg}`, pass: true });
    }
  });

  // Bjart's documented values (public/css/variables.css header): the email
  // shell now carries them. Engine-only — a downstream's theme is its own.
  testEngine('the engine resolves from Bjart (classic) to its exact tokens', () => {
    expect(resolved.theme).toBe('classic');
    expect({ ...resolved.palette }).toEqual({
      page: '#F2EBE0', card: '#FDFAF4', panel: '#F2EBE0', border: '#D3CEC8',
      heading: '#2A1F17', text: '#574434', muted: '#6F5A46', accent: '#4F3722',
      button: '#7B5533', onButton: '#FFFFFF',
    });
  });
});

describe('email palette — the rendered mails', () => {
  const saved = process.env.RESEND_API_KEY;
  let mails;
  let P;
  beforeAll(async () => {
    let svc;
    jest.isolateModules(() => {
      process.env.RESEND_API_KEY = 're_test';
      svc = require('../../server/services/emailService');
    });
    P = loadEmailPalette(identity).palette;
    mails = await renderAllEmails(svc, sent);
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved;
  });

  const colours = (html, re) => [...html.matchAll(re)].map((m) => m[1].toUpperCase());

  test('twelve senders render through the shell', () => {
    expect(mails.map((m) => m.name)).toHaveLength(12);
    for (const { msg } of mails) expect(msg.html).toContain('<meta name="color-scheme" content="light"/>');
  });

  test('every colour literal in every mail is a palette value', () => {
    const allowed = new Set(Object.values(P));
    for (const { name, msg } of mails) {
      const used = colours(msg.html, /#([0-9a-f]{3}(?:[0-9a-f]{3})?)\b(?![^<]*-->)/gi).map((h) => `#${h}`);
      const stray = used.filter((c) => !allowed.has(c));
      expect({ name, stray }).toEqual({ name, stray: [] });
    }
  });

  test('every text colour clears AA on each light surface it can sit on', () => {
    const surfaces = [P.card, P.panel, P.page];
    for (const { name, msg } of mails) {
      for (const c of new Set(colours(msg.html, /(?<![-\w])color:\s*(#[0-9a-f]{6})/gi))) {
        // The button label sits on the button, and only there.
        const on = c === P.onButton ? [P.button] : surfaces;
        for (const bg of on) {
          const ratio = contrastRatio(c, bg);
          expect({ name, c, bg, pass: ratio >= AA }).toEqual({ name, c, bg, pass: true });
        }
      }
    }
  });

  test('no dark-shell colour survives in the mails or the translated copy', () => {
    const OLD = /#(0a0a0a|111111|0d0d0d|1a1a1a|c9a84c|e0e0e0)\b/i;
    for (const { msg } of mails) expect(msg.html).not.toMatch(OLD);
    for (const file of ['server/i18n/en.json', 'server/i18n/is.json']) {
      const table = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      const styled = Object.entries(table).filter(([k, v]) => k.startsWith('email.') && /#[0-9a-f]{3,6}\b/i.test(v));
      expect(styled).toEqual([]);
    }
  });
});
