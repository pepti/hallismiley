// One-shot script: recompress oversized baked images in public/assets/.
// These are committed (not user uploads), so we can rewrite them in place
// and the next deploy ships smaller bytes at the same URLs.
//
// What it does for any *.jpg / *.png larger than the threshold:
//   - resizes to max 1920px on the longest edge (keeps aspect ratio)
//   - re-encodes JPEG with mozjpeg at quality 82
//   - re-encodes PNG losslessly with effort 9 (best compression)
//   - skips files already smaller than the output would be
//
// Run once: node scripts/recompress-images.js
// Re-running is safe — it'll skip files that are already small.
'use strict';
const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

// Roots to scan. Anything else in public/ stays untouched (icons, sample
// avatars, og-image, etc.) so we don't accidentally degrade tiny UI assets.
const ROOTS = [
  path.join(__dirname, '..', 'public', 'assets', 'projects'),
  path.join(__dirname, '..', 'public', 'assets', 'party', 'venue'),
  path.join(__dirname, '..', 'public', 'assets'),  // top-level: waterfall-cover, og-image, etc.
];

// Skip files smaller than this; smaller images are already optimised (or
// thumbnails / icons we shouldn't be re-encoding).
const MIN_BYTES = 200 * 1024;
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 82;

function* walk(root, depth = 0) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Don't recurse into nested dirs from the public/assets top-level scan —
      // we'll cover those with the dedicated ROOTS entries above. But descend
      // freely into projects/* and party/venue/*.
      if (depth === 0 && root === path.join(__dirname, '..', 'public', 'assets')) continue;
      yield* walk(full, depth + 1);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

(async () => {
  let scanned = 0, skipped = 0, processed = 0, savedBytes = 0;

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const ext = path.extname(file).toLowerCase();
      if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') continue;
      scanned++;

      const stat = fs.statSync(file);
      if (stat.size < MIN_BYTES) { skipped++; continue; }

      // Read into memory first so sharp doesn't hold an OS file handle while
      // we try to overwrite the same path (Windows fails with EBUSY/UNKNOWN).
      const inputBuf = fs.readFileSync(file);
      const meta = await sharp(inputBuf).metadata();
      const needsResize = (meta.width || 0) > MAX_DIMENSION || (meta.height || 0) > MAX_DIMENSION;

      let pipeline = sharp(inputBuf).rotate(); // honour EXIF orientation
      if (needsResize) {
        pipeline = pipeline.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
      }
      if (ext === '.png') {
        pipeline = pipeline.png({ effort: 9, compressionLevel: 9 });
      } else {
        pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
      }

      const buf = await pipeline.toBuffer();
      if (buf.length >= stat.size) {
        // Re-encoding made it bigger (already optimal, or PNG with palette).
        // Leave the original alone.
        skipped++;
        continue;
      }

      fs.writeFileSync(file, buf);
      processed++;
      savedBytes += stat.size - buf.length;
      const rel = path.relative(path.join(__dirname, '..'), file);
      console.log(`  ${rel}  ${(stat.size / 1024).toFixed(0)}KB → ${(buf.length / 1024).toFixed(0)}KB`);
    }
  }

  console.log('');
  console.log(`Scanned ${scanned}, processed ${processed}, skipped ${skipped}.`);
  console.log(`Total saved: ${(savedBytes / (1024 * 1024)).toFixed(1)} MB`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
