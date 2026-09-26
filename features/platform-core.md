---
id: platform-core
name: {is: Kjarni, en: "Platform core"}
domain: 20
owner: engine
status: live
flag: null
paths:
  - server/app.js
  - server/server.js
  - server/config/database.js
  - server/config/appEnv.js
  - server/config/schema.js
  - server/config/migrationSet.js
  - server/scripts/migrate.js
  - server/migrations/**
  - server/middleware/errorHandler.js
  - server/middleware/versionedStatic.js
  - server/utils/staticCacheControl.js
  - public/js/services/buildGuard.js
  - public/js/utils/buildCheck.js
  - public/js/utils/assetBase.js
  - public/js/components/UpdateBanner.js
  - server/scripts/bootstrap.js
  - server/scripts/setup-admin.js
  - server/scripts/seed.js
  - server/scripts/cleanup-duplicates.js
  - server/scripts/capture-site-screenshots.js
  - tests/unit/schema-integrity.test.js
  - tests/unit/errorHandlerDeadlock.test.js
  - tests/unit/migrationSet.test.js
  - tests/unit/migrationIdempotent.test.js
  - tests/integration/buildHeader.test.js
  - tests/integration/versionedShell.test.js
  - tests/unit/versionedStatic.test.js
  - tests/unit/staticCacheControl.test.js
  - tests/unit/buildCheck.client.test.js
  - tests/unit/noAbsoluteJsUrls.test.js
  - e2e/build-reload.spec.js
  - tests/unit/database.test.js
  - tests/unit/appEnv.test.js
  - tests/integration/migrateRunner.test.js
  - Dockerfile
  - .github/workflows/ci.yml
  - .github/workflows/ci-skipped.yml
  - package.json
  - package-lock.json
  - eslint.config.js
  - nodemon.json
  - server/services/anthropicAuth.js
  - tests/unit/anthropicAuth.test.js
  - tests/unit/anthropicWifWiring.test.js
  - server/services/aiGate.js
  - tests/unit/aiGate.test.js
  - tests/unit/errorHandlerAiBusy.test.js
migrations: [001_initial_schema, 043_strip_stale_railway_references]
since: 2026-08-09
origin: null
history: [build-status, base-sync, harvest-2, go-live, harvest-ice-f-2026-09-24, harvest-ice-e-2026-09-24, harvest-ice-a-2026-09-24, harvest-ice-c-2026-09-24]
---

The Express 5 app and boot sequence, the pg pool, the migration runner and the engine migration list (`schema.js`; product migrations are composed in by `migrationSet.js` from `product-migrations/<product>.js`), the central error middleware, the bootstrap/seed scripts, and CI. Everything here is cross-cutting by definition — a file with an obvious owner belongs in that feature instead.

`services/anthropicAuth.js` (icelandicstore #326, 2026-09-24) is how every Claude call authenticates: workload identity federation over the App Service managed identity when its three settings are present, `ANTHROPIC_API_KEY` otherwise, nothing = Claude off; a boot self-check logs which mode is live.

**Rules**
- CommonJS server, vanilla-JS SPA, one auth system, consistent error envelope, pino only (invariants 1–6).
- Never edit an applied migration; append. Express 5 catch-alls keep the braces. Node major pinned in THREE places.
- The migration runner is transactional and locked; a release's migrations are backward-compatible with the previous release (invariant 14).
- A Claude client is built from `anthropicAuth.clientAuthOptions()`, never from `ANTHROPIC_API_KEY` directly; in workload-identity mode the key is never read.
- Every PAID Claude call takes an `aiGate` slot (`services/aiGate.js`, harvest2 from icelandicstore #218; `AI_MAX_CONCURRENT`, default 4): fan-out/background callers `withQueuedSlot`, request-path callers `withSlot`, whose `AiBusyError` the central error middleware answers 429 + `Retry-After` (`reason: AI_BUSY`). Resource protection, not a usage budget.
- The error middleware honours a typed error's `messageKey` / `retryAfterSeconds` / `reason` for a safe client status only; a 5xx never picks its message.
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
