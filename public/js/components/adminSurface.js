// adminSurface — which admin screens this INSTANCE shows in its sidebar by
// default. The admin twin of server/config/publicSurface.js.
//
// Orange Smiley is a software company, not a shop, so the retail screens the
// base ships (products, collections, bins, orders, discounts, the sales report,
// the POS till, the home-background editor) are noise in its everyday nav.
// Halli's standing rule is hide, never delete (CLAUDE.md "Do NOT run
// /strip-base"; decided for the admin on 2026-09-07): every route below stays
// live at its URL, every id stays in ADMIN_VIEW_IDS and grantable in
// /admin/roles, and an admin can bring a line back in sidebar edit mode (the
// eye toggle writes `revealedItems` into the per-admin layout blob; Reset
// returns to this policy).
//
// Scope: the policy applies only to accounts that hold EVERY view ('*' — the
// admin role). A custom role's grant list already IS its nav, so a role that
// holds only `orders` still sees Pantanir; nothing here can make a granted
// screen unreachable.
//
// Every id must exist in server/auth/adminViews.js —
// tests/unit/admin-surface-parity.test.js checks that, so a typo cannot
// silently hide nothing. Ids that leave this set are pruned from saved
// `revealedItems` on the next reconcile.
export const HIDDEN_ADMIN_VIEWS = new Set([
  'products', 'collections', 'bins', 'orders', 'discounts', 'sales',
  'pos',
  'background',
]);
