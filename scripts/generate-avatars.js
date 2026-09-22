#!/usr/bin/env node
/**
 * Generates the 40 profile avatars in public/assets/avatars/ as brand smileys.
 *
 * The set replaces the inherited HalliProjects fantasy avatars (ghosts, dragons,
 * navy backgrounds) with faces drawn from the Orange Smiley emblem vocabulary:
 * the same plate silhouettes, the same orange ramp, and the ten vertical-eye
 * treatments explored for the header mark (Halli, 2026-08-10).
 *
 * 40 = 4 face shapes x 10 eye styles, with the colorway and the mouth rotating
 * on their own cycles so no two neighbours in the picker grid look alike. It is
 * fully deterministic: same input, same 40 files.
 *
 * Filenames are load-bearing — ALLOWED_AVATARS in server/middleware/validate.js
 * is the generated list avatar-01.svg .. avatar-40.svg. Adding or renaming files
 * here means changing TOTAL_AVATARS in ProfileView.js and SignupView.js too.
 *
 * Uploaded user avatars (user-*.png) live in the same directory and are never
 * touched — this script only ever writes avatar-NN.svg.
 *
 *   node scripts/generate-avatars.js [--check]
 *
 * --check writes nothing and exits non-zero if any file is missing or stale,
 * which is what CI wants.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'avatars');
const COUNT   = 40;

/* ── Palette ──────────────────────────────────────────────────────────────
   Ash token values, hardcoded: these are static files served to <img>, so
   they cannot read CSS custom properties. Keep in sync with the --gold ramp
   in public/css/variables.css if the brand is re-hued. */
const COLORWAYS = [
  // Orange face on near-black, features knocked out dark
  { bg: '#141210', face: '#E8853D', stroke: 'none',    feat: '#1C1916', grad: ['#2A2622', '#141210'] },
  // The emblem itself: dark plate, orange rim and features
  { bg: '#1C1916', face: '#232019', stroke: '#E8853D', feat: '#E8853D', grad: ['#F3B577', '#B45309'] },
  // Inverted: orange field, charcoal face, light features
  { bg: '#E8853D', face: '#1C1916', stroke: 'none',    feat: '#F3B577', grad: ['#F3B577', '#B45309'] },
  // Warm ivory face, burnt-orange features — the quiet one in the set
  { bg: '#1C1916', face: '#D6CDC2', stroke: 'none',    feat: '#B45309', grad: ['#D97706', '#B45309'] },
];

/* ── Face shapes ───────────────────────────────────────────────────────────
   All centred on (100,100) in a 200x200 viewBox and sized so the features
   below sit comfortably inside every one of them. */
const SHAPES = [
  () => '<circle cx="100" cy="100" r="66"/>',
  // The 4.1 emblem plate, scaled 6.25x off the 32-unit header mark
  () => '<path d="M100 8 181 50v100L100 192 19 150V50z"/>',
  () => '<rect x="34" y="34" width="132" height="132" rx="30"/>',
  () => '<path d="M62 34h76l28 28v76l-28 28H62l-28-28V62z"/>',
];

/* ── Eyes ──────────────────────────────────────────────────────────────────
   The ten vertical treatments from the emblem exploration sheet, scaled to
   the 200 grid. Each returns markup already carrying its own paint. */
const EYES = [
  // 1. Bar, rounded
  f => `<path d="M72 76v32M128 76v32" fill="none" stroke="${f.feat}" stroke-width="14" stroke-linecap="round"/>`,
  // 2. Slab, square caps
  f => `<rect x="65" y="74" width="14" height="34" fill="${f.feat}"/><rect x="121" y="74" width="14" height="34" fill="${f.feat}"/>`,
  // 3. Hairline, tall
  f => `<path d="M72 68v44M128 68v44" fill="none" stroke="${f.feat}" stroke-width="8" stroke-linecap="round"/>`,
  // 4. Tapered wedge
  f => `<path d="M64 72h16l-5 38h-6zM120 72h16l-5 38h-6z" fill="${f.feat}"/>`,
  // 5. Split segments
  f => `<path d="M72 74v11M72 97v11M128 74v11M128 97v11" fill="none" stroke="${f.feat}" stroke-width="14" stroke-linecap="round"/>`,
  // 6. Gradient bars — the header mark's own treatment
  () => '<rect x="65" y="73" width="14" height="35" rx="7" fill="url(#g)"/><rect x="121" y="73" width="14" height="35" rx="7" fill="url(#g)"/>',
  // 7. Asymmetric wink
  f => `<path d="M72 72v38M128 90v20" fill="none" stroke="${f.feat}" stroke-width="14" stroke-linecap="round"/>`,
  // 8. Splayed outward
  f => `<path d="M68 74 76 108M132 74 124 108" fill="none" stroke="${f.feat}" stroke-width="14" stroke-linecap="round"/>`,
  // 9. Serif ticks
  f => `<path d="M72 78v30M128 78v30" fill="none" stroke="${f.feat}" stroke-width="12" stroke-linecap="round"/>`
     + `<path d="M63 70h18M119 70h18" fill="none" stroke="${f.feat}" stroke-width="7" stroke-linecap="round"/>`,
  // 10. Cursor: one solid, one hollow
  f => `<rect x="65" y="73" width="14" height="35" fill="${f.feat}"/>`
     + `<rect x="122" y="75" width="11" height="31" fill="none" stroke="${f.feat}" stroke-width="5"/>`,
];

/* ── Mouths ────────────────────────────────────────────────────────────────
   Four curves on their own cycle, so shape+eyes+mouth rarely repeat together. */
const MOUTHS = [
  f => `<path d="M66 122c10 17 22 25 34 25s24-8 34-25" fill="none" stroke="${f.feat}" stroke-width="13" stroke-linecap="round"/>`,
  f => `<path d="M58 118c11 24 25 34 42 34s31-10 42-34" fill="none" stroke="${f.feat}" stroke-width="13" stroke-linecap="round"/>`,
  f => `<path d="M70 130c9 10 20 15 30 15s21-5 30-15" fill="none" stroke="${f.feat}" stroke-width="12" stroke-linecap="round"/>`,
  f => `<path d="M62 124h76a38 38 0 0 1-76 0z" fill="${f.feat}"/>`,
];

const pad = n => String(n).padStart(2, '0');

function buildAvatar(i) {
  const shapeIdx = Math.floor(i / 10);
  const eyeIdx   = i % 10;
  const cw       = COLORWAYS[(i + shapeIdx) % COLORWAYS.length];
  const mouthIdx = (i * 3) % MOUTHS.length;

  const needsGrad = eyeIdx === 5;
  const defs = needsGrad
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
      + `<stop offset="0" stop-color="${cw.grad[0]}"/><stop offset="1" stop-color="${cw.grad[1]}"/>`
      + `</linearGradient></defs>`
    : '';

  const faceAttrs = cw.stroke === 'none'
    ? `fill="${cw.face}"`
    : `fill="${cw.face}" stroke="${cw.stroke}" stroke-width="8"`;
  const face = SHAPES[shapeIdx]().replace('/>', ` ${faceAttrs}/>`);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">',
    `  <rect width="200" height="200" fill="${cw.bg}"/>`,
    defs ? `  ${defs}` : null,
    `  ${face}`,
    `  ${EYES[eyeIdx](cw)}`,
    `  ${MOUTHS[mouthIdx](cw)}`,
    '</svg>',
    '',
  ].filter(l => l !== null).join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const stale = [];

  for (let i = 0; i < COUNT; i++) {
    const file = path.join(OUT_DIR, `avatar-${pad(i + 1)}.svg`);
    const svg  = buildAvatar(i);

    if (check) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current !== svg) stale.push(path.basename(file));
      continue;
    }
    fs.writeFileSync(file, svg, 'utf8');
  }

  if (check) {
    if (stale.length) {
      process.stderr.write(`✗ ${stale.length} avatar(s) missing or stale: ${stale.join(', ')}\n`);
      process.stderr.write('  Run: node scripts/generate-avatars.js\n');
      process.exit(1);
    }
    process.stdout.write(`✓ all ${COUNT} avatars match the generator\n`);
    return;
  }
  process.stdout.write(`✓ wrote ${COUNT} avatars to public/assets/avatars/\n`);
}

main();
