#!/usr/bin/env node
'use strict';
// build-iceland-scenes.js — generate the responsive photo renditions for the
// Iceland scene engine (public/js/scenes/).
//
//   node scripts/build-iceland-scenes.js [--only skogafoss]
//
// Reads originals from assets-src/iceland/ (gitignored — only the generated
// derivatives ship) plus SOURCES.json (author/license per photo, maintained by
// hand when a photo is added). Emits, per photo:
//   • AVIF + WebP + JPEG at widths 480/960/1600/2400 (upscales skipped; a
//     source that falls between two steps also ships at its own width, so a
//     1280px original tops out at 1280, not 960), content-hashed filenames →
//     public/assets/iceland/
//   • a 24px blurred JPEG placeholder (LQIP), inlined as a data URI
// and then writes the two manifests both consumers read:
//   • public/js/scenes/manifest.js     (ES module — SceneStage)
//   • server/config/sceneManifest.json (JSON — ssrMeta preload tags)
//   • public/assets/iceland/CREDITS.md (attribution per image — since
//     2026-09-22 the set is AI-generated for Orange Smiley ehf.; an entry with
//     licenseUrl/source still renders as a link, for any licensed photo)
//
// The hero LCP budget is enforced here, not reviewed into existence: if the
// largest AVIF at or under 1600w exceeds MAX_HERO_BYTES the build fails loudly so the fix (lower
// quality / different photo) happens at build time, never in production.
//
// Stale derivatives (hash changed after a re-edit) are deleted so the output
// directory always mirrors exactly one build.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const SRC_DIR = path.join(__dirname, '../assets-src/iceland');
const OUT_DIR = path.join(__dirname, '../public/assets/iceland');
const MANIFEST_JS = path.join(__dirname, '../public/js/scenes/manifest.js');
const MANIFEST_JSON = path.join(__dirname, '../server/config/sceneManifest.json');

const WIDTHS = [480, 960, 1600, 2400];
const MAX_HERO_BYTES = 250 * 1024; // hard LCP budget for the largest ≤1600w AVIF
const HERO_MAX_W = 1600;
const LQIP_WIDTH = 24;

// Focal points (CSS object-position) — where the subject sits, so band crops
// at odd aspect ratios keep the landmark in frame. Eyeballed per photo.
// The 2026-09-22 set (Halli's AI-generated stills, iceland-v2) replaced the
// Commons photos; their originals stay in assets-src as retired material.
const FOCAL = {
  'canyon-river': '55% 55%',
  'rhyolite-ridges': '50% 40%',
  'glacier-tongue': '50% 58%',
  'black-beach': '60% 55%',
  'cave-falls': '35% 50%',
  'basalt-canyon': '55% 50%',
  'moss-falls': '50% 45%',
  'snow-rapids': '45% 60%',
  'hot-spring': '40% 65%',
  'braided-sand': '50% 50%',
  'ice-lagoon': '65% 60%',
  'braided-moss': '50% 50%',
  'braided-valley': '55% 50%',
};

// Only photos assigned to a scene are processed; spares in assets-src wait.
const ACTIVE = Object.keys(FOCAL);

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i !== -1 ? process.argv[i + 1] : null;
})();

function hash8(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

async function buildOne(id) {
  const srcPath = path.join(SRC_DIR, id + '.jpg');
  if (!fs.existsSync(srcPath)) throw new Error(`missing source: ${srcPath}`);
  const img = sharp(srcPath, { failOn: 'error' }).rotate(); // respect EXIF
  const meta = await img.metadata();

  const entry = {
    width: meta.width,
    height: meta.height,
    focal: FOCAL[id],
    lqip: null,
    sources: { avif: [], webp: [], jpeg: [] },
  };

  // Every step the source covers, plus the source's own width when it falls
  // between steps — otherwise a 1280px original would top out at 960.
  const widths = WIDTHS.filter((w) => w <= meta.width);
  if (meta.width < WIDTHS[WIDTHS.length - 1] && !widths.includes(meta.width)) widths.push(meta.width);
  const budgetW = Math.max(...widths.filter((w) => w <= HERO_MAX_W));

  for (const w of widths) {
    const resized = sharp(srcPath).rotate().resize({ width: w });
    const outs = {
      avif: await resized.clone().avif({ quality: 50, effort: 5 }).toBuffer(),
      webp: await resized.clone().webp({ quality: 74 }).toBuffer(),
      jpeg: await resized.clone().jpeg({ quality: 78, progressive: true, mozjpeg: true }).toBuffer(),
    };
    if (w === budgetW && outs.avif.length > MAX_HERO_BYTES) {
      throw new Error(`${id}: ${w}w AVIF is ${(outs.avif.length / 1024).toFixed(0)}KB — over the ${MAX_HERO_BYTES / 1024}KB LCP budget. Lower the quality for this photo or pick another.`);
    }
    for (const [fmt, buf] of Object.entries(outs)) {
      const name = `${id}-${w}.${hash8(buf)}.${fmt === 'jpeg' ? 'jpg' : fmt}`;
      fs.writeFileSync(path.join(OUT_DIR, name), buf);
      entry.sources[fmt].push({ w, src: `/assets/iceland/${name}` });
    }
  }

  const lqipBuf = await sharp(srcPath).rotate().resize({ width: LQIP_WIDTH }).jpeg({ quality: 45 }).toBuffer();
  entry.lqip = `data:image/jpeg;base64,${lqipBuf.toString('base64')}`;
  return entry;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sources = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'SOURCES.json'), 'utf8'));

  const ids = ACTIVE.filter((id) => !only || id === only);
  // Full rebuild semantics: reprocessing everything keeps hashes/manifest in
  // one consistent state, so clear generated images first (not CREDITS.md).
  if (!only) {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (/\.(avif|webp|jpg)$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }

  const manifest = {};
  for (const id of ids) {
    process.stdout.write(`building ${id}… `);
    manifest[id] = await buildOne(id);
    const kb = (n) => (n / 1024).toFixed(0) + 'KB';
    const hero = manifest[id].sources.avif.filter((s) => s.w <= HERO_MAX_W).pop();
    console.log(`ok (${hero ? hero.w : '?'}w avif ${hero ? kb(fs.statSync(path.join(__dirname, '../public', hero.src)).size) : 'n/a'})`);
  }

  // ES-module manifest for the client scene engine.
  const banner = '// GENERATED by scripts/build-iceland-scenes.js — do not edit by hand.\n// Photo sources + licenses: public/assets/iceland/CREDITS.md\n';
  fs.mkdirSync(path.dirname(MANIFEST_JS), { recursive: true });
  fs.writeFileSync(MANIFEST_JS, `${banner}export const SCENE_IMAGES = ${JSON.stringify(manifest, null, 2)};\n`);

  // JSON twin for ssrMeta's preload tags (the server can't import ESM).
  fs.writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2) + '\n');

  // Attribution, one line per image.
  const lines = [
    '# Iceland scene images — sources & licenses',
    '',
    'The landscape scenes on this site are AI-generated images made for',
    'Orange Smiley ehf., resized and colour-graded per site theme. They show',
    'Icelandic landforms, not specific real places. The homepage hero video is',
    'AI-generated for Orange Smiley ehf. as well.',
    '',
  ];
  for (const id of ids) {
    const s = sources[id];
    if (!s) throw new Error(`SOURCES.json missing entry for ${id}`);
    const license = s.licenseUrl ? `[${s.license}](${s.licenseUrl})` : s.license;
    lines.push(`- **${id}** — “${s.title}” by ${s.author}, ${license}.${s.source ? ` Source: ${s.source}` : ''}`);
  }
  lines.push('', 'Generated by scripts/build-iceland-scenes.js.', '');
  fs.writeFileSync(path.join(OUT_DIR, 'CREDITS.md'), lines.join('\n'));

  const total = fs.readdirSync(OUT_DIR).filter((f) => /\.(avif|webp|jpg)$/.test(f))
    .reduce((n, f) => n + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`done — ${ids.length} scenes, ${(total / 1024 / 1024).toFixed(1)}MB of derivatives`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
