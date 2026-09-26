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
  - tests/unit/testDbSweep.test.js
  - tests/integration/testDbSweep.test.js
  - tests/unit/architectureIndex.test.js
  - tests/unit/featureRegistry.test.js
  - tests/unit/featureGate.test.js
  - tests/unit/historyFragments.test.js
  - e2e/global-setup.js
  - e2e/helpers.js
  - e2e/lib/dbUrl.js
  - e2e/lib/featureGate.js
  - e2e/lib/locale.js
  - scripts/drop-test-dbs.js
  - scripts/test-pg.js
  - scripts/features-index.js
  - scripts/merge-coverage.js
  - tests/unit/ciSkippedShim.test.js
  - tests/unit/workflowsParse.test.js
  - jest.config.js
  - jest.unit.config.js
  - playwright.config.js
  - babel.config.js
migrations: []
since: 2026-08-09
origin: null
history: [harvest-1, harvest-2, docs-restructure, identity-seam-2026-09-22, identity-seam-2-2026-09-23, harvest-ice-f-2026-09-24, harvest2-lane0-2026-09-26, test-db-hygiene-2026-09-26]
---

Jest tiers (unit without a DB; integration on real Postgres with one database per worker), Playwright e2e on an isolated per-branch DB, the shared helpers, and the read-the-docs parity tests: `architectureIndex.test.js` keeps `docs/ARCHITECTURE.md` honest and `featureRegistry.test.js` keeps this registry honest (`scripts/features-index.js` generates its derived files). Both resolve history slugs against one namespace, the frozen archive `docs/HISTORY.md` plus the per-branch fragments in `docs/history.d/` (`tests/lib/historyAnchors.js`); `historyFragments.test.js` checks each fragment's name and first lines. `docs/TESTING.md` also holds the deployed-environment walkthrough (quoted vs booked) run after a deploy. The **feature gate** (`tests/lib/featureGate.js`, `e2e/lib/featureGate.js`) derives from `features/local.json` and this registry which suites skip on a downstream: a spec maps to its feature through the registry's `paths`, and a feature that is `hidden`, `disabled` or `forked` there — or belongs to another product — skips with the note.

**Rules**
- Tests hit real Postgres — never mock `pg` (invariant 9); never add an `afterAll pool.end()`.
- Every source file under the coverage roots is claimed by exactly one feature; `features/README.md`, `.engine-paths` and `.gitattributes` are generated, never hand-edited.
- Never delete or hand-edit an engine spec in a downstream: a feature the product hides is recorded in `features/local.json` and the gate skips its suites (`gateSpec(test, __filename)` heads every engine e2e spec; `describeForSpec(__filename)` the jest suites that a product may not run). In the engine `local.json` is empty and nothing skips — `featureGate.test.js` pins it.
- A chunk's write-up is a new `docs/history.d/` fragment, never an append to the archive ([harvest2-lane0](../docs/history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)).
- Test databases: created on `TEST_PG_URL` (a throwaway server), named `<engine.json product>_…_test`, labelled at creation, swept by every run, dropped by pattern at teardown; `cleanTables()` DELETEs rather than TRUNCATEs ([test-db-hygiene](../docs/history.d/2026-09-26-feat-test-db-hygiene.md#test-db-hygiene-2026-09-26)).
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
