'use strict';
// The DEMO INSTANCE's sample data — PRODUCT-OWNED (R2b, D-020).
//
// services/demoReset.js calls `seed({ db, logger })` after every reset, on a
// freshly migrated database where only the staff accounts survived, and on the
// first boot of a demo instance. The engine seeds nothing: this stub is the
// contract. A product that runs a demo instance replaces this file with its
// own story (rekstrarkerfid: Kaffibrennslan Glóð — products, orders,
// invoices, a VSK period, change requests), goes through the real services
// (the books refuse hand-written rows) and returns a summary for the log.
//
// A sync never overwrites a product's copy: list server/demo/seed.js among the
// product-owned paths (engine.json productPaths / .engine-paths).

// eslint-disable-next-line no-unused-vars
async function seed({ db, logger }) {
  return { seeded: false, reason: 'the engine ships no demo data' };
}

module.exports = { seed };
