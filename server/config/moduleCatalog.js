'use strict';

// ── Module catalogue: what each switchable module OWNS (R4, 2026-09-24) ──────
//
// The engine ships every module; an instance decides which of them it HAS.
// This file is the engine's list of the switchable ones and, for each, every
// surface that belongs to it — so "is the shop on here?" is answered by one
// flag (`modules.shop.enabled` in config/client.json) instead of by hand in
// router.js, NavBar.js, ssrMeta.js, sitemapRoutes.js and the admin sidebar
// (ENHANCEMENTS #5; roadmap R4 in company/REKSTRARKERFI-PLAN.md §7).
//
// Pure data, no requires: server/config/clientConfig.js builds its
// `modules.<id>.enabled` schema leaves and the presets from it, and
// server/config/modules.js turns it into the runtime gate.
//
// OFF means absent, not forbidden (the self-update rule): every API prefix
// and upload prefix answers 404 with the error envelope BEFORE auth, every
// page route renders the SPA's not-found view with a real 404 status and
// noindex, the routes leave nav/sitemap, and the admin views leave the
// sidebar and the role editor's grantable list. Nothing is deleted — tables,
// rows and code stay, so switching a module back on restores it as it was.
//
// Not the same as `identity.surface.hiddenRoutes`: a HIDDEN route still works
// at its URL (Halli's "hidden but functional" rule for this instance's
// portfolio surfaces); a DISABLED module does not exist on the instance.
//
// Fields, per module:
//   tiers       the Rekstrarkerfið bundles (ORANGE-SMILEY-PLAN §1) that
//               include it; `preset: "<tier>"` switches on exactly these.
//   routes      bare SPA routes (locale-stripped), prefix-matched on a '/'
//               boundary — '/shop' covers '/shop/<slug>'. Public AND admin.
//   api         request-path prefixes of its API mounts (same matching).
//   assets      its upload mounts under /assets.
//   adminViews  its ids in server/auth/adminViews.js.
//   features    the registry ids (features/*.md) whose `flag` is this
//               module's switch — tests/unit/moduleCatalog.test.js holds the
//               two in step, and tests/lib/featureGate.js skips their suites
//               where the module is off.
//
// Longest prefix wins, so a module may own a sub-path of another's mount:
// the till (`pos`) lives under the bookkeeping API and screens.
//
// Always on, never listed (the core every tier is built on): the public site
// pages, auth + users + roles, site content, leads (the contact form's inbox),
// change requests, analytics, monitoring + the staff audit log, general
// settings, the MCP connector (its own MCP_ENABLED switch) and self-update
// (its own `modules.selfUpdate.enabled`).

const MODULES = Object.freeze({
  // Netverslun: catalogue, cart + Stripe checkout, orders, discounts, bins,
  // the sales report and the shop-customer CRM.
  shop: {
    tiers: ['verslun', 'rekstur'],
    routes: ['/shop', '/cart', '/checkout', '/orders',
      '/admin/shop', '/admin/bins', '/admin/discounts', '/admin/sales', '/admin/customers'],
    api: ['/api/v1/shop', '/api/v1/admin/shop', '/api/v1/admin/bins', '/api/v1/admin/discounts',
      '/api/v1/admin/customers', '/api/v1/admin/customer-notes'],
    assets: ['/assets/products'],
    adminViews: ['products', 'orders', 'collections', 'bins', 'discounts', 'sales', 'customers'],
    features: ['shop-catalog', 'cart-checkout', 'orders', 'discounts', 'customers-crm'],
  },
  // Sölukassi: the till. Its API and screen sit under the bookkeeping ones.
  pos: {
    tiers: ['verslun', 'rekstur'],
    routes: ['/admin/books/pos'],
    api: ['/api/v1/admin/bookkeeping/pos'],
    assets: [],
    adminViews: ['pos'],
    features: ['pos'],
  },
  // Bókhald: ledger, invoices, expenses, AR, VSK, bank, payroll, intake,
  // replay, settings, Peppol.
  books: {
    tiers: ['rekstur'],
    routes: ['/admin/books'],
    api: ['/api/v1/admin/bookkeeping'],
    assets: [],
    adminViews: ['books', 'invoices', 'expenses', 'ar', 'vat', 'bank', 'ledger', 'payroll'],
    features: ['bookkeeping-core', 'invoices', 'vsk', 'payroll', 'books-intake', 'books-replay',
      'books-settings', 'peppol-outbound'],
  },
  // Fréttir: the news list and articles. In every tier (Halli, 2026-09-24:
  // "news yes").
  news: {
    tiers: ['vefur', 'verslun', 'rekstur'],
    routes: ['/news'],
    api: ['/api/v1/news'],
    assets: ['/assets/news'],
    adminViews: [],
    features: ['news'],
  },
  // Verkefni: the projects / case-study gallery and its board. In no tier
  // for now (Halli, 2026-09-24) — an instance switches it on itself.
  projects: {
    tiers: [],
    routes: ['/verkefni', '/projects', '/admin/projects'],
    api: ['/api/v1/projects'],
    assets: ['/assets/projects'],
    adminViews: [],
    features: ['projects'],
  },
  // The birthday-party pages (hallismiley's).
  party: {
    tiers: [],
    routes: ['/party'],
    api: ['/api/v1/party'],
    assets: ['/assets/party'],
    adminViews: [],
    features: ['party'],
  },
  // The personal bio page (hallismiley's).
  bio: {
    tiers: [],
    routes: ['/halli', '/about'],
    api: ['/api/v1/content/halli_bio'],
    assets: [],
    adminViews: [],
    features: ['bio'],
  },
  // Orange Smiley's own sales operation (D-002/D-020): the handbook, the
  // Markaður prospect list, customer accounts, commission and the published
  // seller area. A customer instance has no use for any of it.
  salesOps: {
    tiers: [],
    routes: ['/solusvaedi', '/admin/handbok', '/admin/markadur', '/admin/accounts', '/admin/commission'],
    api: ['/api/v1/admin/handbok', '/api/v1/admin/markadur', '/api/v1/admin/accounts',
      '/api/v1/admin/commission', '/api/v1/seller', '/api/v1/seller-publish'],
    assets: [],
    adminViews: ['handbok', 'markadur', 'accounts', 'commission', 'allaccounts'],
    features: ['sales-handbook', 'markadur', 'market-import', 'customer-accounts', 'commission',
      'seller-publication'],
  },
});

const MODULE_IDS = Object.freeze(Object.keys(MODULES));

// The tiers (ORANGE-SMILEY-PLAN §1): Vefur = the core + news; Verslun = Vefur
// + the shop and the till; Rekstur = Verslun + bókhald (news in Vefur: Halli,
// 2026-09-24). `all` is every module —
// the engine default, so an instance that names no preset behaves exactly as
// it did before R4. A preset only sets the modules the file and the env do
// NOT set explicitly (clientConfig.js resolveConfig).
const TIERS = Object.freeze(['vefur', 'verslun', 'rekstur']);
const PRESETS = Object.freeze(['all', ...TIERS]);

/** Is `id` switched on by `preset` (absent an explicit setting)? */
function presetIncludes(preset, id) {
  if (preset === 'all') return true;
  const m = MODULES[id];
  return !!m && m.tiers.includes(preset);
}

module.exports = { MODULES, MODULE_IDS, TIERS, PRESETS, presetIncludes };
