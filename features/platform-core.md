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
  - server/scripts/bootstrap.js
  - server/scripts/setup-admin.js
  - server/scripts/seed.js
  - server/scripts/cleanup-duplicates.js
  - server/scripts/capture-site-screenshots.js
  - tests/unit/schema-integrity.test.js
  - tests/unit/migrationSet.test.js
  - tests/unit/migrationIdempotent.test.js
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
migrations: [001_initial_schema, 043_strip_stale_railway_references]
since: 2026-08-09
origin: null
history: [build-status, base-sync, harvest-2, go-live, harvest-ice-f-2026-09-24]
---

The Express 5 app and boot sequence, the pg pool, the migration runner and the engine migration list (`schema.js`; product migrations are composed in by `migrationSet.js` from `product-migrations/<product>.js`), the central error middleware, the bootstrap/seed scripts, and CI. Everything here is cross-cutting by definition — a file with an obvious owner belongs in that feature instead.

**Rules**
- CommonJS server, vanilla-JS SPA, one auth system, consistent error envelope, pino only (invariants 1–6).
- Never edit an applied migration; append. Express 5 catch-alls keep the braces. Node major pinned in THREE places.
- The migration runner is transactional and locked; a release's migrations are backward-compatible with the previous release (invariant 14).
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
