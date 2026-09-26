'use strict';
// TEST-STACK sample rows — PRODUCT-OWNED (harvest 2 lane 9, 2026-09-26;
// ported from icelandicstore #183, where it is server/config/demoData.js).
//
// Not the demo instance. A demo instance (server/demo/seed.js, R2b) is its own
// stack with its own database of sample data only, rebuilt every night. THIS
// file is for a product's TEST stack — the same image as production, often on a
// copy of production's data — that wants a few invented rows production must
// never get: the colour grid a demo needs, a sample record to click through.
//
// Why not a migration: promotion ships the whole image (build once, promote the
// digest), so there is no promote-time way to leave one change behind. A row a
// migration inserts reaches PRODUCTION the moment any later release is promoted.
// So the SCHEMA a demo needs still goes in a migration (a nullable column is
// harmless everywhere); the invented ROWS go here, and
// services/testStackSeeder.js applies them at boot only where APP_ENV is
// exactly `test` and the database is not a production one. Re-applied on every
// boot on purpose: a PROD→TEST clone replaces TEST's database and restarts the
// app, and the boot puts the rows back.
//
// Rules for every dataset (from ice #183):
//   1. IDEMPOTENT — it runs on every TEST boot: ON CONFLICT DO NOTHING /
//      WHERE NOT EXISTS, never a bare INSERT.
//   2. NATURAL KEYS — address rows by a slug, a SKU, a settings key; never by
//      id (TEST and PROD number the same row differently).
//   3. LABELLED — a marker (a `DEMO-` SKU prefix, a `demo.` key) so invented
//      rows can be told from real ones and removed in one query.
//   4. NON-DESTRUCTIVE — deactivate, never delete: a real row must survive.
//
// Shape: { name, description, statements: [sql, …] } — each dataset runs in
// its own transaction; a failing one is rolled back and logged, the others
// still apply, and the boot carries on.
//
// The engine ships none. A product lists this file among its product-owned
// paths (engine.json productPaths / .engine-paths) so a sync never overwrites it.
const datasets = [];

module.exports = { datasets };
