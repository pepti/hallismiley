// Fylgiskjöl — the supporting documents behind ledger entries.
//
// Three requirements shape this, all from bókhaldslög 145/1994 / Reglugerð 505/2013:
//
//   gr. 20  Seven-year retention. Files are never deleted by the application; the
//           DB trigger refuses it too.
//   gr. 14  Áreiðanleiki — the document must be demonstrably unaltered since it was
//           filed. That is what checksum_sha256 is for: it is evidence, not a
//           dedupe convenience, and it is what the archive export will verify.
//   gr. 8   Traceable to the entry it supports, with an identifiable person behind
//           it — hence created_by NOT NULL and the link from journal_entries.
//
// Storage is under BOOKS_UPLOAD_ROOT, deliberately outside the statically-served
// tree: a supplier invoice carries business terms and kennitölur and must only be
// reachable through an authenticated route.

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const logger = require('../../logger');
const audit = require('./auditLog');
const { BOOKS_UPLOAD_ROOT, booksDocumentDir } = require('../../config/paths');

// A receipt is a photo or a PDF. Nothing else is a document in this sense, and
// keeping the list this short keeps the archive readable in seven years.
const ALLOWED_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic', // iPhone camera default
};

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB — a scanned multi-page invoice

const KINDS = ['receipt', 'supplier_invoice', 'bank_statement', 'contract', 'other'];

class DocumentError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'DocumentError';
    this.status = status;
    if (code) this.code = code;
  }
}

/**
 * multer instance for a single document upload.
 *
 * The stored extension comes from the SERVER-VALIDATED MIME type, never from the
 * client's filename — the same rule as server/middleware/upload.js, for the same
 * reason: a file named evil.svg sent as image/png must not land on disk as .svg.
 * The original name is kept in the database column for display only.
 */
function createDocumentUpload() {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      // Shard by year-month so seven years of receipts is not one flat directory.
      const now = new Date();
      const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dir = booksDocumentDir(bucket);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = ALLOWED_MIME[file.mimetype] || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    fileFilter(req, file, cb) {
      if (Object.prototype.hasOwnProperty.call(ALLOWED_MIME, file.mimetype)) return cb(null, true);
      cb(new DocumentError(
        `Unsupported file type: ${file.mimetype}. Attach a PDF or a photo (JPEG, PNG, WebP, HEIC).`,
        400, 'BAD_MIME'
      ));
    },
  });
}

// SHA-256 of the file as stored. Streamed so a 15 MB scan does not sit in memory.
async function checksumFile(absPath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(absPath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

// Stored relative to BOOKS_UPLOAD_ROOT so the root can move (dev → Azure Files →
// an Icelandic archive) without rewriting every row.
function relativePath(absPath) {
  return path.relative(BOOKS_UPLOAD_ROOT, absPath).split(path.sep).join('/');
}

function absolutePath(relPath) {
  const abs = path.resolve(BOOKS_UPLOAD_ROOT, relPath);
  // Traversal guard: a stored value is only ever used if it still resolves inside
  // the document root. Cheap, and the consequence of getting it wrong is arbitrary
  // file reads through an authenticated endpoint.
  const root = path.resolve(BOOKS_UPLOAD_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new DocumentError('Document path is outside the document root', 500, 'BAD_PATH');
  }
  return abs;
}

/**
 * Register an uploaded file as a document.
 *
 * @param {object} client  pg client inside a transaction
 * @param {object} file    multer file object (already written to disk)
 */
async function register(client, file, { kind = 'receipt', note = '', createdBy, requestId = null }) {
  if (!createdBy) throw new DocumentError('register requires createdBy', 500);
  if (!file) throw new DocumentError('No file was uploaded', 400, 'NO_FILE');
  if (!KINDS.includes(kind)) throw new DocumentError(`Unknown document kind: ${kind}`, 400, 'BAD_KIND');

  const checksum = await checksumFile(file.path);

  // Warn about an identical file already on record — usually a double-upload of the
  // same receipt. Reported, not refused: the same PDF can legitimately support
  // entries in two periods.
  const { rows: existing } = await client.query(
    `SELECT d.id, d.original_name, d.created_at,
            (SELECT COUNT(*)::int FROM expenses e WHERE e.document_id = d.id) AS used_by_expenses
       FROM books_documents d WHERE d.checksum_sha256 = $1 LIMIT 3`,
    [checksum]
  );

  const { rows } = await client.query(
    `INSERT INTO books_documents
       (kind, original_name, file_path, mime_type, byte_size, checksum_sha256, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, kind, original_name, mime_type, byte_size, checksum_sha256, created_at`,
    [
      kind,
      String(file.originalname || 'document').slice(0, 255),
      relativePath(file.path),
      file.mimetype,
      file.size,
      checksum,
      String(note || '').slice(0, 500),
      createdBy,
    ]
  );
  const document = rows[0];

  await audit.record(client, {
    actorId: createdBy,
    action: 'document.uploaded',
    entityType: 'document',
    entityId: document.id,
    requestId,
    summary: { kind, byte_size: file.size, mime_type: file.mimetype, duplicate_of: existing.length || undefined },
  });

  logger.info({ documentId: document.id, kind, bytes: file.size }, 'books document registered');
  return {
    document: { ...document, byte_size: Number(document.byte_size) },
    duplicates: existing.map(e => ({
      id: e.id, original_name: e.original_name, used_by_expenses: e.used_by_expenses,
    })),
  };
}

/**
 * Read a document for streaming, verifying it has not been altered on disk.
 *
 * The checksum check is the gr. 14 reliability guarantee actually being used rather
 * than merely stored: if the bytes no longer match what was filed, the document is
 * not evidence any more and saying so loudly is better than serving it silently.
 */
async function open(client, documentId, { verify = true } = {}) {
  const { rows } = await client.query(
    `SELECT id, kind, original_name, file_path, mime_type, byte_size, checksum_sha256
       FROM books_documents WHERE id = $1`,
    [String(documentId)]
  );
  const doc = rows[0];
  if (!doc) throw new DocumentError('Document not found', 404, 'NOT_FOUND');

  const abs = absolutePath(doc.file_path);
  try {
    await fsp.access(abs, fs.constants.R_OK);
  } catch {
    throw new DocumentError(
      'The stored file for this document is missing from the archive',
      410, 'FILE_MISSING'
    );
  }

  if (verify) {
    const actual = await checksumFile(abs);
    if (actual !== doc.checksum_sha256) {
      logger.error({ documentId: doc.id }, 'books document checksum mismatch');
      throw new DocumentError(
        'This document no longer matches the checksum recorded when it was filed, '
        + 'so it cannot be relied on as evidence. Investigate before using it.',
        409, 'CHECKSUM_MISMATCH'
      );
    }
  }

  return { document: { ...doc, byte_size: Number(doc.byte_size) }, absolutePath: abs };
}

module.exports = {
  DocumentError,
  ALLOWED_MIME,
  MAX_DOCUMENT_BYTES,
  KINDS,
  createDocumentUpload,
  checksumFile,
  relativePath,
  absolutePath,
  register,
  open,
};
