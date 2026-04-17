// File upload middleware using multer (disk storage).
// Destination directories live under UPLOAD_ROOT (see server/config/paths.js)
// so production can redirect writes to the mounted Azure Files share.
// Enforces:
//   1. A MIME-type allowlist in multer's fileFilter (fast reject before write).
//   2. A magic-byte check in verifyFileBytes() AFTER multer writes to disk,
//      because file.mimetype is client-supplied and can be trivially spoofed.
//      Callers mount verifyFileBytes as middleware immediately after multer.

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const { newsUploadDir, projectUploadDir } = require('../config/paths');

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_MIME_TYPES  = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

// Magic-byte signatures keyed by MIME. Each signature is `[ offset, bytes ]`.
// A MIME type is valid if ANY of its signatures matches at its offset.
const MAGIC_BYTE_SIGNATURES = {
  'image/jpeg': [[0, [0xFF, 0xD8, 0xFF]]],
  'image/png':  [[0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]],
  'image/webp': [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]], // "RIFF" + "WEBP"
  'video/mp4':  [[4, [0x66, 0x74, 0x79, 0x70]]], // "ftyp" at offset 4
  'video/webm': [[0, [0x1A, 0x45, 0xDF, 0xA3]]], // EBML
};

function bytesMatch(buf, offset, expected) {
  if (buf.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (buf[offset + i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Reads the first 32 bytes of `filePath` and checks them against the known
 * magic-byte signatures for `declaredMime`. Returns true if the content
 * matches the declared MIME. For WebP we require BOTH RIFF header and WEBP
 * fourcc (covers lossy/lossless variants).
 */
async function contentMatchesMime(filePath, declaredMime) {
  const sigs = MAGIC_BYTE_SIGNATURES[declaredMime];
  if (!sigs) return false;

  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(32);
    await fh.read(buf, 0, 32, 0);
    // webp requires all listed signatures to match (RIFF + WEBP)
    if (declaredMime === 'image/webp') {
      return sigs.every(([offset, bytes]) => bytesMatch(buf, offset, bytes));
    }
    // others: any signature in the list is enough
    return sigs.some(([offset, bytes]) => bytesMatch(buf, offset, bytes));
  } finally {
    await fh.close();
  }
}

/**
 * Express middleware — run AFTER multer. Verifies that the uploaded file's
 * real content matches its declared MIME type via magic-byte inspection, and
 * unlinks + 415s if it doesn't.
 */
async function verifyFileBytes(req, res, next) {
  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) return next();

  for (const file of files) {
    try {
      const ok = await contentMatchesMime(file.path, file.mimetype);
      if (!ok) {
        // unlink the imposter before rejecting
        await fsp.unlink(file.path).catch(() => {});
        return res.status(415).json({
          error: 'File content does not match its declared type',
          code:  'MAGIC_BYTE_MISMATCH',
        });
      }
    } catch (err) {
      // Treat read failures as a reject — safer than passing through.
      await fsp.unlink(file.path).catch(() => {});
      return next(err);
    }
  }
  return next();
}

function makeUpload(destDir) {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(destDir, { recursive: true });
      cb(null, destDir);
    },
    filename(req, file, cb) {
      const ext  = path.extname(file.originalname).toLowerCase()
                   || (file.mimetype.startsWith('image/') ? '.jpg' : '.mp4');
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
      cb(null, name);
    },
  });

  const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error(
        'Only images (jpg, png, webp) and videos (mp4, webm) are allowed'
      );
      err.code = 'INVALID_TYPE';
      cb(err);
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_VIDEO_SIZE },
  });
}

/**
 * Returns a configured multer upload instance whose destination directory is
 * `public/assets/projects/<projectId>/`.  The directory is created on demand.
 *
 * Caller is responsible for calling `.single('file')` on the returned instance
 * AND mounting `verifyFileBytes` after multer to reject spoofed content.
 */
function createProjectUpload(projectId) {
  return makeUpload(projectUploadDir(projectId));
}

/**
 * Returns a configured multer upload instance for news article media.
 * Destination: `public/assets/news/<articleId>/`.
 */
function createNewsUpload(articleId) {
  return makeUpload(newsUploadDir(articleId));
}

module.exports = {
  createProjectUpload,
  createNewsUpload,
  verifyFileBytes,
  contentMatchesMime,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
};
