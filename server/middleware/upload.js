// File upload middleware using multer (disk storage).
// Creates a per-project upload directory under public/assets/projects/<projectId>/.
// Enforces MIME-type allowlist and per-type size limits.

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_MIME_TYPES  = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

/**
 * Returns a configured multer upload instance whose destination directory is
 * `public/assets/projects/<projectId>/`.  The directory is created on demand.
 *
 * Caller is responsible for calling `.single('file')` on the returned instance.
 */
function createProjectUpload(projectId) {
  const destDir = path.join(
    __dirname, '../../public/assets/projects', String(projectId)
  );

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
 * Returns a configured multer upload instance for news article media.
 * Destination: `public/assets/news/<articleId>/`.
 */
function createNewsUpload(articleId) {
  const destDir = path.join(
    __dirname, '../../public/assets/news', String(articleId)
  );

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

module.exports = { createProjectUpload, createNewsUpload, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE };
