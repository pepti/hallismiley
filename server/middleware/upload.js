// File upload middleware using multer (disk storage).
// Destination directories live under UPLOAD_ROOT (see server/config/paths.js)
// so production can redirect writes to the mounted Azure Files share.
// Enforces MIME-type allowlist and per-type size limits.

const multer = require('multer');
const fs     = require('fs');
const { t }  = require('../i18n');
const logger = require('../logger');
const { newsUploadDir, projectUploadDir, productUploadDir, backgroundUploadDir, userAvatarDir } = require('../config/paths');

const MAX_IMAGE_SIZE  = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE  = 50 * 1024 * 1024; // 50 MB
const MAX_AVATAR_SIZE =  5 * 1024 * 1024; //  5 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_MIME_TYPES  = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

// What multer 2 reports when the client's socket goes away mid-body.
const CLIENT_GONE_MESSAGES = new Set(['Request aborted', 'Request closed']);

// Derive the stored file extension from the server-validated MIME type rather
// than from the client-supplied original filename.  This prevents an attacker
// from sending Content-Type: image/jpeg with filename="evil.svg" and having
// the file stored as .svg (which express.static would serve as image/svg+xml,
// enabling stored XSS).  The stored extension now always matches the MIME type
// the server accepted, so browsers receive the correct Content-Type on retrieval.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'video/mp4':  '.mp4',
  'video/webm': '.webm',
  // quicktime is accepted only by the party album upload (iPhones record .mov);
  // it is deliberately NOT in ALLOWED_VIDEO_TYPES, so project/news/product
  // uploads still reject it — this map is only consulted after a fileFilter
  // has accepted the MIME type.
  'video/quicktime': '.mov',
};

/**
 * The `destination` callback every disk-storage upload shares: create the
 * target directory on demand, then hand it to multer. Ported from
 * icelandicstore #150 (harvest 2, 2026-09-26).
 *
 * The try/catch is load-bearing. multer invokes destination() synchronously
 * from inside its busboy stream handler, so a throw here reaches neither
 * Express nor uploadSingle's callback — it is an UNCAUGHT exception, and
 * server.js turns that into process.exit(1) in production. The directory lives
 * on the mounted Azure Files share, so a full or read-only mount
 * (ENOSPC/EACCES) would take the container down mid-request and crash-loop on
 * retry. Passing the error to `cb` makes it an ordinary upload failure, which
 * uploadSingle forwards to the central error middleware as a logged 500.
 *
 * `destDir` is a path, or `(req, file) => path` for a directory computed per
 * upload (the books documents' year-month bucket). `mkdir` is injectable for
 * the unit test.
 */
function ensureDestination(destDir, { mkdir = fs.mkdirSync } = {}) {
  return (req, file, cb) => {
    try {
      const dir = typeof destDir === 'function' ? destDir(req, file) : destDir;
      mkdir(dir, { recursive: true });
      return cb(null, dir);
    } catch (err) {
      return cb(err);
    }
  };
}

// The random stored name every per-id upload uses: timestamp + suffix + the
// extension of the SERVER-validated MIME type.
function randomFilename(req, file, cb) {
  const ext  = MIME_TO_EXT[file.mimetype] || '.bin';
  cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
}

function typeFilter(allowed, message) {
  return (req, file, cb) => {
    if (allowed.includes(file.mimetype)) return cb(null, true);
    const err = new Error(message);
    err.code = 'INVALID_TYPE';
    return cb(err);
  };
}

/**
 * Returns a configured multer upload instance whose destination directory is
 * `public/assets/projects/<projectId>/`.  The directory is created on demand.
 *
 * Caller is responsible for calling `.single('file')` on the returned instance.
 */
function createProjectUpload(projectId) {
  return multer({
    storage: multer.diskStorage({ destination: ensureDestination(projectUploadDir(projectId)), filename: randomFilename }),
    fileFilter: typeFilter(ALLOWED_MIME_TYPES, 'Only images (jpg, png, webp) and videos (mp4, webm) are allowed'),
    limits: { fileSize: MAX_VIDEO_SIZE },
  });
}

/**
 * Returns a configured multer upload instance for news article media.
 * Destination: `public/assets/news/<articleId>/`.
 */
function createNewsUpload(articleId) {
  return multer({
    storage: multer.diskStorage({ destination: ensureDestination(newsUploadDir(articleId)), filename: randomFilename }),
    fileFilter: typeFilter(ALLOWED_MIME_TYPES, 'Only images (jpg, png, webp) and videos (mp4, webm) are allowed'),
    limits: { fileSize: MAX_VIDEO_SIZE },
  });
}

/**
 * Returns a configured multer upload instance for product images.
 * Images only (no videos). Destination: `UPLOAD_ROOT/products/<productId>/`.
 * The route resolves the product first (adminShopRoutes `requireProduct`), so
 * a directory is only ever created for a product that exists.
 */
function createProductUpload(productId) {
  return multer({
    storage: multer.diskStorage({ destination: ensureDestination(productUploadDir(productId)), filename: randomFilename }),
    fileFilter: typeFilter(ALLOWED_IMAGE_TYPES, 'Only images (jpg, png, webp) are allowed for products'),
    limits: { fileSize: MAX_IMAGE_SIZE },
  });
}

/**
 * Returns a configured multer upload instance for home-background media
 * (images + videos). Destination: `UPLOAD_ROOT/backgrounds/`.
 */
function createBackgroundUpload() {
  return multer({
    storage: multer.diskStorage({ destination: ensureDestination(backgroundUploadDir()), filename: randomFilename }),
    fileFilter: typeFilter(ALLOWED_MIME_TYPES, 'Only images (jpg, png, webp) and videos (mp4, webm) are allowed'),
    limits: { fileSize: MAX_VIDEO_SIZE },
  });
}

/**
 * Returns a configured multer upload instance for a user's profile avatar.
 * Images only, 5 MB cap. Destination: `UPLOAD_ROOT/avatars/` (flat; the
 * filename embeds the user id). Requires an authenticated request — the
 * filename reads `req.user.id`. Moved here from userRoutes.js (icelandicstore
 * #142, harvest 2) so the avatar shares ensureDestination and uploadSingle.
 */
function createUserAvatarUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: ensureDestination(userAvatarDir()),
      filename(req, file, cb) {
        // Fully derived from the verified mimetype + a random suffix — no part
        // of the user-supplied originalname is used, so traversal is impossible.
        const ext  = MIME_TO_EXT[file.mimetype] || '.jpg';
        const rand = Math.random().toString(36).slice(2, 9);
        cb(null, `user-${req.user.id}-${Date.now()}-${rand}${ext}`);
      },
    }),
    fileFilter: typeFilter(ALLOWED_IMAGE_TYPES, 'Avatar must be a JPG, PNG, or WebP image'),
    limits: { fileSize: MAX_AVATAR_SIZE },
  });
}

// Map an accepted MIME type to the background_media.media_type enum.
function mediaTypeForMime(mime) {
  return ALLOWED_VIDEO_TYPES.includes(mime) ? 'video' : 'image';
}

const MAX_PRODUCT_IMPORT_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_PRODUCT_IMPORT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                          // .xls
  'text/csv',
  'application/csv',
  'text/plain',
  'application/pdf',
  'application/octet-stream', // mail-client fallback — gated by extension below
];

/**
 * In-memory multer for the products-import file (harvested from icelandicstore
 * #249 — harvest-ice-d-2026-09-24). Accepts the CSV the products page exports,
 * a supplier .xlsx and a PDF order or price list; 10 MB. Parsed immediately and
 * never persisted, so memoryStorage is the right fit. A loose octet-stream MIME
 * is accepted ONLY when the filename says xlsx/xls/csv/pdf — and the parser
 * identifies the container itself, so neither the name nor the MIME is
 * load-bearing. Caller uses `.single('file')`.
 */
function createProductImportUpload() {
  const fileFilter = (req, file, cb) => {
    const name   = String(file.originalname || '').toLowerCase();
    const extOk  = /\.(xlsx|xls|csv|txt|pdf)$/.test(name);
    const typeOk = ALLOWED_PRODUCT_IMPORT_TYPES.includes(file.mimetype);
    if ((typeOk && (file.mimetype !== 'application/octet-stream' || extOk)) || extOk) return cb(null, true);
    const err = new Error('Only CSV, Excel (xlsx) and PDF files can be imported');
    err.code = 'INVALID_TYPE';
    cb(err);
  };
  return multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: MAX_PRODUCT_IMPORT_SIZE, files: 1 } });
}

/**
 * Route middleware wrapping `createUpload(req).single('file')` — the ONE
 * wrapper every upload route uses (icelandicstore #141 + #142 + #314, harvest
 * 2, 2026-09-26; it replaced a hand-rolled copy per route that echoed raw
 * English multer text on an Icelandic-default site).
 *
 * `createUpload` — a builder returning a multer instance, called per request
 * with `req` (for uploads whose destination depends on the route, e.g. the
 * per-product image directory). Zero-arg builders ignore the argument.
 *
 * `errorKeys` — one i18n key for every rejection, or a map keyed by `err.code`
 * (`LIMIT_FILE_SIZE`, `INVALID_TYPE`, any other multer code); anything unmapped
 * falls back to the map's `default`, then to `errors.upload.failed`. The answer
 * is the standard error envelope `{ error, code }`, translated to req.locale.
 *
 * `opts.tooLargeStatus` — the status of a LIMIT_FILE_SIZE rejection (default
 * 400; the products import keeps its documented 413).
 *
 * Only client-caused rejections (multer's own errors, the fileFilter's
 * INVALID_TYPE) become 4xx. Anything else — EACCES/ENOSPC from the uploads
 * mount (ensureDestination hands those to multer), programmer errors — is a
 * server fault and goes to the central error middleware: logged with the
 * request id, answered 500.
 *
 * Except the client hanging up mid-upload (multer's "Request aborted" /
 * "Request closed"): nobody is left to answer, and a 5xx there would count a
 * closed tab against the SLO. That ends 499, logged at info.
 */
function uploadSingle(createUpload, errorKeys, { tooLargeStatus = 400 } = {}) {
  const keys = typeof errorKeys === 'string' ? { default: errorKeys } : (errorKeys || {});
  return (req, res, next) => {
    createUpload(req).single('file')(req, res, (err) => {
      if (!err) return next();
      const isMulter = err instanceof multer.MulterError;
      if (!isMulter && CLIENT_GONE_MESSAGES.has(err.message)) {
        logger.info({ requestId: req.requestId || null, url: req.originalUrl, reason: err.message }, 'upload: client aborted');
        res.statusCode = 499;
        if (!res.headersSent && !res.destroyed) res.end();
        return undefined;
      }
      if (!isMulter && err.code !== 'INVALID_TYPE') return next(err);
      // typeof guard: an unmapped code that collides with an Object.prototype
      // member ('constructor', …) must fall through, not return a function.
      const key = (typeof keys[err.code] === 'string' && keys[err.code])
        || keys.default || 'errors.upload.failed';
      const status = err.code === 'LIMIT_FILE_SIZE' ? tooLargeStatus : 400;
      return res.status(status).json({ error: t(req.locale, key), code: status });
    });
  };
}

module.exports = {
  ensureDestination,
  uploadSingle,
  createProjectUpload,
  createNewsUpload,
  createProductUpload,
  createBackgroundUpload,
  createUserAvatarUpload,
  createProductImportUpload,
  mediaTypeForMime,
  MIME_TO_EXT,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_AVATAR_SIZE,
  MAX_PRODUCT_IMPORT_SIZE,
};
