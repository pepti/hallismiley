// Canonical admin "view" ids — the unit of per-role access control. These MUST
// stay 1:1 with the client sidebar ADMIN_NAV item ids
// (public/js/components/AdminSidebar.js); tests/unit/admin-views-parity.test.js
// asserts the two lists match. The admin role implicitly has all views (the
// resolver returns ['*']).
const ALL = '*';

// Every admin sidebar nav item id (the canSeeView visibility contract).
// Note: ids must be lowercase letters only — tests/unit/admin-views-parity.test.js
// extracts them from AdminSidebar.js with /id:\s*'([a-z]+)'/, so a hyphen or digit
// would silently drop the item from the parity check.
const ADMIN_VIEW_IDS = [
  'dashboard', 'products', 'orders', 'collections', 'bins', 'customers', 'discounts', 'sales',
  'analytics', 'background', 'feedback', 'general', 'users', 'roles',
  // Bókhald. Split per area so a bookkeeper or accountant can be granted exactly
  // what they need. Holding one of these grants READ access only: issuing invoices,
  // recording payments and crediting are hard admin-only (adminBookkeepingRoutes.js).
  //
  // Ids are added as their screens land, never ahead of them — an id here forces a
  // matching sidebar item (parity test), and a sidebar item with no route is a dead
  // link.
  //
  // Note 'expenses' and 'ar' carry supplier and customer detail respectively —
  // granting them is granting sight of that (an accepted decision, see
  // docs/BOOKKEEPING-SYSTEM.md).
  'books', 'invoices', 'expenses', 'ar', 'vat', 'bank', 'ledger', 'payroll', 'pos',
  'updates',
  'monitoring',
];

// Views an admin may grant to a custom role (the checkboxes in the role editor +
// the set the roles API validates against). Excludes 'roles' — managing roles is
// a hard admin-only meta-permission; granting it would allow privilege escalation.
const GRANTABLE_VIEW_IDS = ADMIN_VIEW_IDS.filter(id => id !== 'roles');

module.exports = { ALL, ADMIN_VIEW_IDS, GRANTABLE_VIEW_IDS };
