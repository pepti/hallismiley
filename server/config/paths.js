// Centralised filesystem paths for user-uploaded media.
//
// In local development the committed tree under `public/assets/` is used
// directly, so existing dev data and seeded content keep working without any
// env config.  In production (Azure App Service) an Azure Files share is
// mounted at `/app/uploads`; setting UPLOAD_ROOT to that path redirects every
// write and every upload-served read to the share, making uploads survive
// container redeploys.
//
// Subdirectories inside UPLOAD_ROOT mirror the URL structure so the serving
// code is a single `express.static('/assets/news', …)` per feature:
//   UPLOAD_ROOT/news/<articleId>/   ← news article media
//   UPLOAD_ROOT/party/              ← party photos
//   UPLOAD_ROOT/projects/<id>/      ← project media
//   UPLOAD_ROOT/content/            ← admin-uploaded images for site_content rows

const path = require('path');

// In production the dev fallback is a silent data-loss trap: uploads would land
// on the container's ephemeral disk and vanish on the next redeploy, with no
// error to notice. Fail the boot instead — prod sets this to the Azure Files
// mount (/app/uploads, docs/DEPLOYMENT.md), so an unset value means the mount
// configuration was lost.
if (process.env.NODE_ENV === 'production' && !process.env.UPLOAD_ROOT) {
  throw new Error(
    'UPLOAD_ROOT must be set when NODE_ENV=production — it points at the mounted '
    + 'Azure Files share (/app/uploads). Without it uploads write to ephemeral '
    + 'container storage and are lost on redeploy.'
  );
}

const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(__dirname, '..', '..', 'public', 'assets');

// Bookkeeping documents (fylgiskjöl — receipts and supplier invoices) live under
// their OWN root, deliberately outside UPLOAD_ROOT.
//
// In development UPLOAD_ROOT is public/assets, and app.js serves the whole public/
// tree with a catch-all express.static — so anything placed there is fetchable by
// URL with no authentication. That is acceptable for product photos and fine for
// the deliberately-public party album; it is not acceptable for a supplier invoice
// carrying business terms and kennitölur. These files are only ever served by an
// authenticated streaming route, never by express.static.
const BOOKS_UPLOAD_ROOT = process.env.BOOKS_UPLOAD_ROOT
  ? path.resolve(process.env.BOOKS_UPLOAD_ROOT)
  : path.join(__dirname, '..', '..', 'private-uploads', 'books');

// Every per-id upload dir interpolates a row id that ultimately came from a
// route param. Ids are TEXT (uuid by default) or SERIAL ints, so they cannot be
// range-checked, but they are always ONE path segment: anything carrying a
// separator or a `..` is a traversal attempt (`/products/..%2F..%2Fevil/images`
// decodes to a single param) and must never reach path.join, which would
// happily resolve it outside UPLOAD_ROOT.
//
// This is an allowlist, not a denylist, because a denylist is wrong on win32
// (dev): CreateDirectoryW strips a trailing space or dot, so `products/abc.`
// silently becomes `products/abc` and `products/ ` becomes `products/` itself —
// a write one level up. Reserved device names (CON, NUL, COM1…) are rejected
// for the same reason: they are not directories on Windows and would surface as
// an opaque 500. uuids, integers and slug-shaped test ids all satisfy it.
//
// Throwing rather than sanitising keeps the failure loud, and rejecting a
// non-string/number outright matters most: String(undefined) is 'undefined',
// which passes every character check and would quietly funnel unrelated rows
// into one shared UPLOAD_ROOT/<kind>/undefined/ directory — the exact orphan
// growth this guard exists to prevent.
const SAFE_SEGMENT  = /^[A-Za-z0-9._-]+$/;
const WIN_RESERVED  = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function segment(value, label) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Missing or non-scalar ${label} for an upload path: ${Object.prototype.toString.call(value)}`);
  }
  const s = String(value);
  if (!SAFE_SEGMENT.test(s) || s.includes('..') || s.endsWith('.') || WIN_RESERVED.test(s)) {
    throw new Error(`Unsafe ${label} for an upload path: ${JSON.stringify(s)}`);
  }
  return s;
}

module.exports = {
  UPLOAD_ROOT,
  BOOKS_UPLOAD_ROOT,
  // Sharded by year-month so a seven-year archive does not end up as one
  // directory with tens of thousands of entries. The bucket is always
  // server-generated (`YYYY-MM`, or 'demo' in the seed script) — segment() is
  // defence-in-depth here, not a route-param guard.
  booksDocumentDir(yearMonth) { return path.join(BOOKS_UPLOAD_ROOT, segment(yearMonth, 'books bucket')); },
  newsUploadDir(articleId)  { return path.join(UPLOAD_ROOT, 'news',     segment(articleId, 'article id')); },
  projectUploadDir(projectId) { return path.join(UPLOAD_ROOT, 'projects', segment(projectId, 'project id')); },
  partyUploadDir() { return path.join(UPLOAD_ROOT, 'party'); },
  userAvatarDir() { return path.join(UPLOAD_ROOT, 'avatars'); },
  productUploadDir(productId) { return path.join(UPLOAD_ROOT, 'products', segment(productId, 'product id')); },
  contentUploadDir() { return path.join(UPLOAD_ROOT, 'content'); },
  backgroundUploadDir() { return path.join(UPLOAD_ROOT, 'backgrounds'); },
  changeRequestUploadDir() { return path.join(UPLOAD_ROOT, 'change-requests'); },
};
