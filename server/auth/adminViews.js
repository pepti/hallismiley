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
  // Software updates. Granting this is granting SIGHT of the release channel and
  // the update history — the apply/rollback/settings routes are hard admin-only
  // on top (server/routes/systemRoutes.js), so an ops role can watch a fleet
  // without being able to restart anything.
  'updates',
  'monitoring',
  'mcp',
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
  // Handbók sölufólks (sales-staff handbook). Granting `handbok` grants READ
  // of PUBLISHED guides only — editing, drafts and delete are hard
  // admin/moderator on top (server/routes/salesGuidesRoutes.js), matching the
  // news/bookkeeping convention. The seeded `solufolk` role holds exactly
  // this view (migration 090).
  'handbok',
  // Leads inbox (migration 097). Granting `leads` grants SIGHT OF PII — the
  // name, email, phone and message of every enquiry — plus the workflow
  // writes (status / note / owner), which are the seller's own work product.
  // Delete (erasure) and CSV export (bulk PII) stay hard admin-only
  // (server/routes/leadsRoutes.js). Migration 097 appends this id to the
  // seeded `solufolk` role; an accepted decision, like `expenses`/`ar` above.
  'leads',
  // Markaður (migration 093 tables, ENHANCEMENTS #16). Granting `markadur`
  // grants READ of the prospect list — public-source company data, no
  // persons. The one write (shortlist → handed_to_sales / rejected) is
  // admin/moderator on top (server/routes/marketRoutes.js). NOT seeded onto
  // `solufolk`: Halli grants it by hand in /admin/roles when the team should
  // see the shortlist.
  'markadur',
  // Customer accounts (migration 098, ENHANCEMENTS #17/#18). `accounts` grants
  // the seller's OWN accounts (row-scoped in the model — server/auth/
  // accountScope.js); `commission` their own commission report. Holding
  // `accounts` also puts the account behind the 2FA challenge (mfaService).
  // Seeded roles: solumadur (handbok, leads, accounts, commission) and
  // verktaki (handbok, accounts, allaccounts).
  'accounts',
  'commission',
  // PERMISSION-ONLY id: no screen of its own. Widens `accounts` (and the
  // commission report) from "mine" to every account — the verktaki who
  // services any customer. Listed in PERMISSION_VIEW_IDS so the sidebar
  // parity test does not expect a nav item for it.
  'allaccounts',
];

// Grantable ids that gate a SCOPE rather than a screen. The role editor shows
// them under their own heading; the sidebar never renders them.
const PERMISSION_VIEW_IDS = ['allaccounts'];

// Views an admin may grant to a custom role (the checkboxes in the role editor +
// the set the roles API validates against). Excludes 'roles' — managing roles is
// a hard admin-only meta-permission; granting it would allow privilege escalation.
const GRANTABLE_VIEW_IDS = ADMIN_VIEW_IDS.filter(id => id !== 'roles');

module.exports = { ALL, ADMIN_VIEW_IDS, GRANTABLE_VIEW_IDS, PERMISSION_VIEW_IDS };
