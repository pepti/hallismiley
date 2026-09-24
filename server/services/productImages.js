// Product image post-processing (sharp). Harvested from icelandicstore
// (ice@4694289 #240, #241, #242 — harvest-ice-d-2026-09-24); the press-room
// `.card.webp` derivative and the delivery-note print thumbnail are ice-only
// and not taken.
//
//  1. normaliseUpload() — runs on every product image the admin uploads.
//     Auto-orients from EXIF (phone photos arrive rotated), caps the long edge
//     at MAX_EDGE so a 12 MP camera shot stops being a 10 MB download in a
//     48 px box, strips metadata (GPS etc.) and re-encodes in the SAME format
//     the server already validated. Also proves the bytes decode: a file that
//     claims image/png but isn't one is rejected here rather than stored and
//     served as a broken <img>.
//
//  2. thumbnailHandler() — an on-demand `<original>.thumb.webp` next to every
//     product image, generated on first request and served by express.static
//     from then on. Lazy, so images stored before this existed get thumbnails
//     without a backfill; the URL is derived client-side
//     (public/js/utils/imageUrl.js) and stays null-safe for external URLs.
//
// Two Azure lessons from ice are part of the port:
//   • rewrite from a BUFFER, never a temp file renamed over the source: libvips
//     keeps a JPEG source open for sequential reading, and the Azure Files (SMB)
//     mount refuses to replace a file that still has an open handle (every JPEG
//     upload on ice TEST failed with EACCES … rename; PNG decodes eagerly, so
//     PNG passed and made it look like a codec problem);
//   • NO `mozjpeg` encoder option: the musl libvips on node:alpine rejects it.

const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const sharp  = require('sharp');
const logger = require('../logger');
const { UPLOAD_ROOT } = require('../config/paths');

const MAX_EDGE     = 2000; // px — long edge of a stored original
const THUMB_EDGE   = 192;  // px — 48 px list cell @4x, 96 px form tile @2x
const THUMB_SUFFIX = '.thumb.webp';
const PRODUCTS_ROOT = path.join(UPLOAD_ROOT, 'products');

// One path segment as multer writes them: no separators, no leading dot, no `..`.
const SEGMENT_RE  = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const SOURCE_EXT  = /\.(jpe?g|png|webp)$/i;

function safeSegment(s) {
  return typeof s === 'string' && SEGMENT_RE.test(s) && !s.includes('..');
}

// The stored original for one `<dir>/<file>` pair, or null when either segment
// is unsafe, the extension is not a source image, or the resolved path escaped
// the products root. Existence is the caller's check.
function resolveSource(dir, file) {
  if (!safeSegment(dir) || !safeSegment(file) || !SOURCE_EXT.test(file)) return null;
  // A derivative is never a SOURCE: it is a `.webp`, so without this
  // `a.jpg.thumb.webp.thumb.webp` would resolve, be written, and be a source in
  // turn — from an unauthenticated URL.
  if (/\.thumb\.webp$/i.test(file)) return null;
  const src = path.join(PRODUCTS_ROOT, dir, file);
  const rel = path.relative(PRODUCTS_ROOT, src);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return src;
}

function encoderFor(pipeline, mimetype) {
  switch (mimetype) {
    case 'image/jpeg': return pipeline.jpeg({ quality: 88 });   // no mozjpeg — see the header
    case 'image/png':  return pipeline.png({ compressionLevel: 8 });
    case 'image/webp': return pipeline.webp({ quality: 88 });
    default:           return pipeline;
  }
}

// `failOn: 'none'` tolerates libpng/libjpeg warnings and truncated files (a
// half-synced phone photo still shows) while a buffer that is not an image at
// all still throws ("unsupported image format").
function basePipeline(input) {
  return sharp(input, { failOn: 'none' })
    .rotate() // honour EXIF orientation, then drop the tag
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
}

/**
 * Rewrites the uploaded file in place, from a Buffer (see the header). Resolves
 * with the stored dimensions; rejects with `err.code = 'UNREADABLE_IMAGE'` when
 * sharp cannot decode it. If the format-specific encoder throws but the bytes DO
 * decode, the upload is still accepted with default encoder options, so a codec
 * quirk never turns a valid photo into a 400.
 */
async function normaliseUpload(absPath, mimetype) {
  try {
    const input = await fsp.readFile(absPath);
    let out;
    try {
      out = await encoderFor(basePipeline(input), mimetype).toBuffer({ resolveWithObject: true });
    } catch (encodeErr) {
      const meta = await sharp(input, { failOn: 'none' }).metadata(); // throws if undecodable
      logger.warn({ err: encodeErr.message, mimetype, format: meta.format },
        'productImages.normaliseUpload: encoder options rejected, retrying with defaults');
      out = await basePipeline(input).toBuffer({ resolveWithObject: true });
    }
    await fsp.writeFile(absPath, out.data);
    return { width: out.info.width, height: out.info.height, size: out.info.size };
  } catch (err) {
    // The client only sees a localised 400 — keep the real reason in the log so
    // an environment-specific failure (codec, mount) is diagnosable.
    logger.warn({ err: err.message, mimetype }, 'productImages.normaliseUpload failed');
    const wrapped = new Error(`Could not decode uploaded image: ${err.message}`);
    wrapped.code = 'UNREADABLE_IMAGE';
    wrapped.cause = err;
    throw wrapped;
  }
}

/** Absolute path of the thumbnail that belongs to a stored original. */
function thumbPathFor(absPath) {
  return `${absPath}${THUMB_SUFFIX}`;
}

// De-duplicate concurrent first requests for the same thumbnail (a list page
// fires dozens at once) so each source is decoded once.
const inflight = new Map();

function generateThumbnail(src, dest) {
  if (inflight.has(dest)) return inflight.get(dest);
  const job = (async () => {
    // Read the source into a Buffer (no libvips handle left open on the mount)
    // and write the finished thumbnail in one call — nothing is renamed.
    const input = await fsp.readFile(src);
    const out = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    await fsp.writeFile(dest, out);
  })();
  inflight.set(dest, job);
  return job.finally(() => inflight.delete(dest));
}

/**
 * Express handler mounted at `/assets/products`, AFTER the express.static for
 * the same prefix (which serves an already-generated thumbnail and falls
 * through when it is missing). Answers only `/<dir>/<file>.<ext>.thumb.webp`;
 * anything else — or a source that does not exist — is passed on untouched.
 */
function thumbnailHandler(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = /^\/([^/]+)\/([^/]+)\.thumb\.webp$/.exec(req.path);
  if (!m) return next();

  let dir, file;
  try {
    dir  = decodeURIComponent(m[1]);
    file = decodeURIComponent(m[2]);
  } catch {
    return next();
  }
  const src = resolveSource(dir, file);
  if (!src || !fs.existsSync(src)) return next();

  const dest = thumbPathFor(src);
  generateThumbnail(src, dest)
    .then(() => {
      // `root` + basename rather than the absolute path: send() applies its
      // dotfile rule to every segment of a bare path, so a checkout living
      // under a dot-directory (a `.claude/worktrees/` worktree) would answer 404.
      res.sendFile(path.basename(dest), {
        root: path.dirname(dest), maxAge: '365d', immutable: true, lastModified: true,
      }, (err) => {
        if (err) next(err);
      });
    })
    .catch((err) => {
      // A source sharp cannot decode is not a server fault worth a 500 — log it
      // and fall through like a missing file; the client falls back to the original.
      logger.warn({ err: err.message, dir, file }, 'productImages.thumbnail failed');
      next();
    });
}

module.exports = {
  normaliseUpload,
  thumbnailHandler,
  thumbPathFor,
  MAX_EDGE,
  THUMB_EDGE,
  THUMB_SUFFIX,
};
