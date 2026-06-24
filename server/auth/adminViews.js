// Canonical admin "view" ids — the unit of per-role access control. These MUST
// stay 1:1 with the client sidebar ADMIN_NAV item ids
// (public/js/components/AdminSidebar.js); tests/unit/admin-views-parity.test.js
// asserts the two lists match. The admin role implicitly has all views (the
// resolver returns ['*']).
const ALL = '*';

// Every admin sidebar nav item id (the canSeeView visibility contract).
const ADMIN_VIEW_IDS = [
  'dashboard', 'products', 'orders', 'collections', 'bins', 'customers', 'discounts', 'sales',
  'analytics', 'background', 'feedback', 'general', 'users', 'roles',
];

// Views an admin may grant to a custom role (the checkboxes in the role editor +
// the set the roles API validates against). Excludes 'roles' — managing roles is
// a hard admin-only meta-permission; granting it would allow privilege escalation.
const GRANTABLE_VIEW_IDS = ADMIN_VIEW_IDS.filter(id => id !== 'roles');

module.exports = { ALL, ADMIN_VIEW_IDS, GRANTABLE_VIEW_IDS };
