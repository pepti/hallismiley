// Text-contrast audit for invariant 15 ("measure composited contrast").
// Walks the rendered DOM of every business route under every theme and
// reports text that fails WCAG AA against the background it composites onto.
// Text over an image/gradient (hero scrims, scene chips) is listed separately:
// a scrim decides those, not a colour pair, so they want an eye, not a number.
// The walker only sees ANCESTOR backgrounds — a photo mounted as a sibling
// (the scene engine prepends .ice-scene) is invisible to it, so a light hero
// over a scene shows up as a false failure; check those by screenshot.
//
//   node scripts/audit-text-contrast.js         (dev server on :3001)
//
// 2026-09-02: found 28 failing rows on the light themes — the home skills /
// stats / contact sections and the project-card badges were still carrying
// the dark Ash theme's hardcoded text colours. See LESSONS.md.

// Walks the rendered DOM and reports text whose colour fails WCAG AA against
// the background it actually composites onto. Elements sitting on an image,
// video or gradient are reported separately: a scrim decides those, not a
// colour pair, so they need an eye rather than a number.
/* global document, getComputedStyle */ // AUDIT below runs inside page.evaluate
const { chromium } = require('playwright');

const PAGES = ['/is/', '/is/thjonusta', '/is/verkefni', '/is/um-okkur',
  '/is/hafa-samband', '/is/personuvernd', '/is/terms'];
const THEMES = ['classic', 'light', 'mono', 'ember', 'midnight'];
const BASE = 'http://localhost:3001';

const AUDIT = () => {
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const parse = s => {
    const m = (s || '').match(/[\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
  };
  const lum = c => 0.2126 * lin(c.r / 255) + 0.7152 * lin(c.g / 255) + 0.0722 * lin(c.b / 255);
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const out = [];
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    // Only elements with their own visible text.
    const own = [...el.childNodes]
      .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;

    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue;

    // Composite the background by walking ancestors. Stop and mark as
    // "media" if anything paints an image/gradient underneath.
    let bg = null, media = false, node = el;
    const layers = [];
    while (node && node !== document.documentElement.parentNode) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') { media = true; break; }
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
      node = node.parentElement;
    }
    if (!media) {
      bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    }

    const size = parseFloat(cs.fontSize);
    const weight = +cs.fontWeight || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;

    const rec = {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 46),
      text: own.slice(0, 42),
      color: cs.color, size, weight, need, media,
    };
    if (media) { rec.note = 'over image/gradient'; out.push(rec); continue; }
    const solid = over(fg, bg);
    const r = ratio(solid, bg);
    if (r < need) { rec.bg = `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`; rec.ratio = +r.toFixed(2); out.push(rec); }
  }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const fails = {}; const mediaSeen = new Set();

  for (const path of PAGES) {
    await pg.goto(BASE + path, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(500);
    for (const th of THEMES) {
      await pg.evaluate(t => document.documentElement.setAttribute('data-theme', t), th);
      await pg.waitForTimeout(140);
      const res = await pg.evaluate(AUDIT);
      for (const r of res) {
        if (r.media) { mediaSeen.add(`${r.tag}.${r.cls} :: ${r.color}`); continue; }
        const key = `${r.tag}.${r.cls}|${r.text}`;
        fails[key] = fails[key] || { ...r, themes: new Set(), pages: new Set() };
        fails[key].themes.add(th); fails[key].pages.add(path);
        if (r.ratio < (fails[key].ratio ?? 99)) { fails[key].ratio = r.ratio; fails[key].bg = r.bg; fails[key].worst = th; }
      }
    }
  }

  const rows = Object.values(fails).sort((a, b2) => a.ratio - b2.ratio);
  console.log('=== FAILS (solid backgrounds) ===');
  if (!rows.length) console.log('none');
  for (const r of rows) {
    console.log(
      `${String(r.ratio).padStart(5)} (need ${r.need})  ${r.color} on ${r.bg}\n` +
      `        <${r.tag} class="${r.cls}">  "${r.text}"\n` +
      `        worst: ${r.worst} | themes: ${[...r.themes].join(',')} | pages: ${[...r.pages].join(' ')}`);
  }
  console.log('\n=== text over image/gradient (judge by eye) ===');
  for (const m of [...mediaSeen].sort()) console.log('  ', m);
  await b.close();
})();
