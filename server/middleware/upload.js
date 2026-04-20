// File upload middleware using multer (disk storage).
// Destination directories live under UPLOAD_ROOT (see server/config/paths.js)
// so production can redirect writes to the mounted Azure Files share.
// Enforces MIME-type allowlist and per-type size limits.

const multer = require('multer');
const fs     = require('fs');
const { newsUploadDir, projectUploadDir, productUploadDir } = require('../config/paths');

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_MIME_TYPES  = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

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
};

/**
 * Returns a configured multer upload instance whose destination directory is
 * `public/assets/projects/<projectId>/`.  The directory is created on demand.
 *
 * Caller is responsible for calling `.single('file')` on the returned instance.
 */
function createProjectUpload(projectId) {
  const destDir = projectUploadDir(projectId);

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(destDir, { recursive: true });
      cb(null, destDir);
    },
    filename(req, file, cb) {
      // Extension is derived from the accepted MIME type, NOT from the
      // client-supplied originalname, to prevent extension spoofing.
      const ext  = MIME_TO_EXT[file.mimetype] || '.bin';
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
 * Returns a configured multer upload instance for news article media.
 * Destination: `public/assets/news/<articleId>/`.
 */
function createNewsUpload(articleId) {
  const destDir = newsUploadDir(articleId);

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(destDir, { recursive: true });
      cb(null, destDir);
    },
    filename(req, file, cb) {
      // Extension is derived from the accepted MIME type, NOT from the
      // client-supplied originalname, to prevent extension spoofing.
      const ext  = MIME_TO_EXT[file.mimetype] || '.bin';
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
 * Returns a configured multer upload instance for product images.
 * Images only (no videos). Destination: `UPLOAD_ROOT/products/<productId>/`.
 */
function createProductUpload(productId) {
  const destDir = productUploadDir(productId);

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(destDir, { recursive: true });
      cb(null, destDir);
    },
    filename(req, file, cb) {
      const ext  = MIME_TO_EXT[file.mimetype] || '.bin';
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
      cb(null, name);
    },
  });

  const fileFilter = (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('Only images (jpg, png, webp) are allowed for products');
      err.code = 'INVALID_TYPE';
      cb(err);
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_IMAGE_SIZE },
  });
}

module.exports = { createProjectUpload, createNewsUpload, createProductUpload, MIME_TO_EXT, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE };
