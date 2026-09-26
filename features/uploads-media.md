---
id: uploads-media
name: {is: "Skráaupphal", en: "Uploads and media"}
domain: 18
owner: engine
status: live
flag: null
paths:
  - server/middleware/upload.js
  - server/services/productImages.js
  - server/middleware/verifyImageBytes.js
  - server/middleware/sanitize.js
  - server/middleware/validate.js
  - server/utils/imageType.js
  - server/config/paths.js
  - server/services/uploadVolumeAlert.js
  - tests/integration/media.test.js
  - tests/integration/productImages.test.js
  - tests/integration/uploadImageBytes.test.js
  - tests/integration/uploadVolumeAlert.test.js
  - tests/unit/uploadPaths.test.js
  - tests/unit/uploadRoot.test.js
  - tests/unit/imageType.test.js
  - tests/unit/verifyImageBytes.test.js
  - tests/unit/sanitize.test.js
  - tests/unit/validate.test.js
  - tests/unit/uploadSingle.test.js
  - tests/integration/uploadWrapper.test.js
migrations: []
since: 2026-08-09
origin: null
history: [base-sync, harvest-2, harvest-1, harvest-ice-d-2026-09-24, harvest2-lane1a-2026-09-26]
---

Multer upload middleware with allowlisted paths under `UPLOAD_ROOT`, magic-byte verification behind every image upload, the request sanitiser and validator middleware, and the upload-volume alert (detect, never block).

**Rules**
- `verifyImageBytes` sniffs magic bytes behind EVERY image upload (mismatch → file unlinked, 400).
- Big uploads always complete: alert on volume, never rate-limit.
- Every multer disk storage takes its `destination` from `ensureDestination()` (an mkdir failure goes to multer's callback — a throw there escapes busboy and exits the process), and every upload route wraps multer in `uploadSingle(builder, errorKeys)`: client rejections are translated `errors.upload.*` 4xx in the standard envelope, infrastructure faults go to the central error handler as 500, a client hang-up ends 499 logged at info (never a 5xx). A per-id upload resolves its row first (`requireProduct`) so nothing is written for an unknown id ([harvest2-lane1a](../docs/history.d/2026-09-26-harvest2-lane1a-security.md#harvest2-lane1a-2026-09-26); icelandicstore #141/#142/#150/#314).
- `sanitizeBody` strips tags in linear time (`stripTags`); never a backtracking regex on request bodies ([history](../docs/HISTORY.md#ready-and-import-order-2026-09-23)).
- Full rules: [../docs/ARCHITECTURE.md#18-uploads-and-media](../docs/ARCHITECTURE.md#18-uploads-and-media).
