// Magic-byte verification for uploaded images.
//
// Every upload surface accepts a file on its DECLARED MIME type (multer's
// fileFilter) and derives the stored extension from that type. That closes the
// evil.svg-as-image/png hole, but nothing checked that the BYTES were what the
// client claimed: a PNG declared as image/jpeg lands on disk as .jpg, is served
// as image/jpeg under nosniff, and a browser refuses to render it (ice hit
// this for real on PROD 2026-08-24 with Shopify-CDN files — ice #215 sniffs
// the bytes there; this is the same sniffer applied at upload time).
//
// Runs AFTER multer has written the file(s) to disk: multer's fileFilter sees
// only the headers, never the payload. On a mismatch every file of the
// request is unlinked and the caller gets the same 400 shape the multer
// wrappers use. Non-image uploads (video, PDF) pass through untouched.
'use strict';

const fs = require('fs/promises');
const { sniffImageFormat } = require('../utils/imageType');

// Declared (multer-accepted) MIME → the format the first bytes must sniff as.
// Anything not listed here (video/*, application/pdf, …) is not checked.
const DECLARED_FORMAT = {
  'image/jpeg': 'jpeg',
  'image/jpg':  'jpeg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

const LABEL = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', avif: 'AVIF', heic: 'HEIC' };

// multer shapes: .single() → req.file; .array() → req.files[]; .fields() →
// req.files = { field: [...] }.
function uploadedFiles(req) {
  const out = [];
  if (req.file) out.push(req.file);
  if (Array.isArray(req.files)) out.push(...req.files);
  else if (req.files && typeof req.files === 'object') {
    for (const list of Object.values(req.files)) out.push(...list);
  }
  return out;
}

// The sniffer wants 12 bytes; a shorter file is padded with zeros so a bare
// 8-byte PNG signature still identifies as PNG (the padding can never turn
// non-image bytes into a valid signature — every check reads from offset 0).
async function readHead(filePath, n = 12) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * Checks every disk-stored upload on the request whose declared type is an
 * image format we know the signature of. Resolves null when they all match;
 * otherwise resolves an error message — and by then every uploaded file of
 * the request has been removed from disk.
 * @param {import('express').Request} req
 * @returns {Promise<string|null>}
 */
async function verifyUploadedImages(req) {
  const files = uploadedFiles(req);
  for (const f of files) {
    const want = DECLARED_FORMAT[f.mimetype];
    if (!want || !f.path) continue; // not an image we check, or memory storage
    const got = sniffImageFormat(await readHead(f.path));
    if (got !== want) {
      await Promise.all(files.map(x => (x.path ? fs.unlink(x.path).catch(() => {}) : null)));
      return `Uploaded file is not a valid ${LABEL[want]} image`;
    }
  }
  return null;
}

/** Express middleware form — mount right after the multer wrapper. */
function verifyImageBytes(req, res, next) {
  verifyUploadedImages(req)
    .then((msg) => {
      if (msg) return res.status(400).json({ error: msg, code: 400 });
      next();
    })
    .catch(next);
}

module.exports = { verifyImageBytes, verifyUploadedImages, DECLARED_FORMAT };
