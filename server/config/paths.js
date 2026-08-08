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

module.exports = {
  UPLOAD_ROOT,
  BOOKS_UPLOAD_ROOT,
  // Sharded by year-month so a seven-year archive does not end up as one
  // directory with tens of thousands of entries.
  booksDocumentDir(yearMonth) { return path.join(BOOKS_UPLOAD_ROOT, String(yearMonth)); },
  newsUploadDir(articleId)  { return path.join(UPLOAD_ROOT, 'news',     String(articleId)); },
  projectUploadDir(projectId) { return path.join(UPLOAD_ROOT, 'projects', String(projectId)); },
  partyUploadDir() { return path.join(UPLOAD_ROOT, 'party'); },
  userAvatarDir() { return path.join(UPLOAD_ROOT, 'avatars'); },
  productUploadDir(productId) { return path.join(UPLOAD_ROOT, 'products', String(productId)); },
  contentUploadDir() { return path.join(UPLOAD_ROOT, 'content'); },
  backgroundUploadDir() { return path.join(UPLOAD_ROOT, 'backgrounds'); },
  changeRequestUploadDir() { return path.join(UPLOAD_ROOT, 'change-requests'); },
};
