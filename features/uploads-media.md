---
id: uploads-media
name: {is: "Skráaupphal", en: "Uploads and media"}
domain: 18
owner: engine
status: live
flag: null
paths:
  - server/middleware/upload.js
  - server/middleware/verifyImageBytes.js
  - server/middleware/sanitize.js
  - server/middleware/validate.js
  - server/utils/imageType.js
  - server/config/paths.js
  - server/services/uploadVolumeAlert.js
  - tests/integration/media.test.js
  - tests/integration/uploadImageBytes.test.js
  - tests/integration/uploadVolumeAlert.test.js
  - tests/unit/uploadPaths.test.js
  - tests/unit/uploadRoot.test.js
  - tests/unit/imageType.test.js
  - tests/unit/verifyImageBytes.test.js
  - tests/unit/sanitize.test.js
  - tests/unit/validate.test.js
migrations: []
since: 2026-08-09
origin: null
history: [base-sync, harvest-2, harvest-1]
---

Multer upload middleware with allowlisted paths under `UPLOAD_ROOT`, magic-byte verification behind every image upload, the request sanitiser and validator middleware, and the upload-volume alert (detect, never block).

**Rules**
- `verifyImageBytes` sniffs magic bytes behind EVERY image upload (mismatch → file unlinked, 400).
- Big uploads always complete: alert on volume, never rate-limit.
- `sanitizeBody` strips tags in linear time (`stripTags`); never a backtracking regex on request bodies ([history](../docs/HISTORY.md#ready-and-import-order-2026-09-23)).
- Full rules: [../docs/ARCHITECTURE.md#18-uploads-and-media](../docs/ARCHITECTURE.md#18-uploads-and-media).
