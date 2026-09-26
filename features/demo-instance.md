---
id: demo-instance
name: {is: "Sýnikerfi", en: "Demo instance"}
domain: 20
owner: engine
status: live
flag: null
paths:
  - server/config/demoInstance.js
  - server/services/demoReset.js
  - server/routes/adminDemoRoutes.js
  - server/demo/seed.js
  - public/js/components/DemoBanner.js
  - tests/integration/demoInstance.test.js
  - tests/integration/demoReset.test.js
  - tests/fixtures/demoResetRun.js
  - server/demo/testStackData.js
  - server/services/testStackSeeder.js
  - server/scripts/seed-test-stack.js
  - tests/unit/testStackSeeder.test.js
  - tests/integration/testStackSeeder.test.js
migrations: []
since: 2026-09-26
origin: null
history: [demo-instance-2026-09-26, harvest2-lane9-2026-09-26]
---

An instance of a product that holds sample data only and throws it away every night and on request (R2b, D-020 — demo.rekstrarkerfi.is). `DEMO_INSTANCE=true` turns it on, only on a demo environment (`APP_ENV=demo`, `DEMO_DATABASE_NAME` = the connected database; checked at boot). While on: email, payments, MCP and IndexNow are off whatever the env holds; `robots.txt` disallows everything and responses carry `X-Robots-Tag: noindex, nofollow`; every page shows a slim banner (`<html data-demo-instance>` from ssrMeta); an admin sees last/next reset and "reset now" on `/admin/general` (`/api/v1/admin/demo`).

The reset rebuilds instead of deleting (the books are append-only): a JSON snapshot of the kept accounts in `demo_keep`, `DROP SCHEMA public`, the whole migration chain, a one-statement-per-table restore in one transaction, the product's seed (`server/demo/seed.js`, product-owned — the engine's stub seeds nothing), then the snapshot is dropped, the upload folders emptied and the process exits for a clean container. An interrupted reset is recovered at the next boot. Nightly at `DEMO_RESET_HOUR_UTC` (default 2, before the self-update window).

**Rules**
- The flag is refused (boot exits) unless `APP_ENV=demo` and `DEMO_DATABASE_NAME` equals the connected database, whose name carries "demo"; a `*_test` database only with `allowTestDatabase` (the reset test's child process, on a database it creates).
- Kept = users holding a role in `DEMO_KEEP_ROLES` (default `admin`) whose login has not expired; their memberships and recovery codes; live sessions only of logins that never expire; every role. Everything else is sample data, uploads included.
- Never set old tables aside as a renamed schema: migrations query `information_schema` without a schema name.
- `server/demo/seed.js` is product-owned: a product lists it among its product paths so a sync never overwrites its seed.
- Not the TEST chrome's per-browser "demo mode" (`services/themePrefs.js`), which is cosmetic.
- A TEST stack is not a demo instance. Its invented sample rows live in `server/demo/testStackData.js` (product-owned, empty in the engine) and `services/testStackSeeder.js` applies them after `migrate()` at every boot only where `APP_ENV` is exactly `test`, the instance is not a demo instance and the database host/name carries no `prod`/`production`/`live` word; each dataset is idempotent, keyed by natural keys, labelled and non-destructive, and runs in its own transaction; the seeder never throws. `npm run seed:test-stack` forces past the gate for a local database only, behind `targetGuard.js` ([harvest2-lane9](../docs/history.d/2026-09-26-harvest2-lane9-ops.md#harvest2-lane9-2026-09-26); ice #183).
- Full rules: [../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).
