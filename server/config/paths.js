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

const path = require('path');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(__dirname, '..', '..', 'public', 'assets');

module.exports = {
  UPLOAD_ROOT,
  newsUploadDir(articleId)  { return path.join(UPLOAD_ROOT, 'news',     String(articleId)); },
  projectUploadDir(projectId) { return path.join(UPLOAD_ROOT, 'projects', String(projectId)); },
  partyUploadDir() { return path.join(UPLOAD_ROOT, 'party'); },
  userAvatarDir() { return path.join(UPLOAD_ROOT, 'avatars'); },
};
