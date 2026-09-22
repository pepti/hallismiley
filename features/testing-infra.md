---
id: testing-infra
name: {is: "Prófunarumgjörð", en: "Testing infrastructure"}
domain: 20
owner: engine
status: live
flag: null
paths:
  - tests/env.js
  - tests/globalSetup.js
  - tests/globalTeardown.js
  - tests/helpers.js
  - tests/workerDb.js
  - tests/lib/**
  - tests/unit/workerDb.test.js
  - tests/unit/architectureIndex.test.js
  - tests/unit/featureRegistry.test.js
  - e2e/global-setup.js
  - e2e/helpers.js
  - e2e/lib/dbUrl.js
  - scripts/drop-test-dbs.js
  - scripts/features-index.js
  - jest.config.js
  - jest.unit.config.js
  - playwright.config.js
  - babel.config.js
migrations: []
since: 2026-08-09
origin: null
history: [harvest-1, harvest-2, docs-restructure]
---

Jest tiers (unit without a DB; integration on real Postgres with one database per worker), Playwright e2e on an isolated per-branch DB, the shared helpers, and the read-the-docs parity tests: `architectureIndex.test.js` keeps `docs/ARCHITECTURE.md` honest and `featureRegistry.test.js` keeps this registry honest (`scripts/features-index.js` generates its derived files).

**Rules**
- Tests hit real Postgres — never mock `pg` (invariant 9); never add an `afterAll pool.end()`.
- Every source file under the coverage roots is claimed by exactly one feature; `features/README.md`, `.engine-paths` and `.gitattributes` are generated, never hand-edited.
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
