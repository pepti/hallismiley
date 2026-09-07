// Guards the RBAC contract: the client sidebar ADMIN_NAV item ids must stay 1:1
// with the server's canonical ADMIN_VIEW_IDS. If they drift, a route could be
// gated on a view-id that no nav item / no role checkbox ever exposes (or vice
// versa). Parses AdminSidebar.js as text so this stays a dependency-free unit
// test (the client file is an ES module; the server module is CommonJS).
const fs = require('fs');
const path = require('path');
const { ADMIN_VIEW_IDS, PERMISSION_VIEW_IDS } = require('../../server/auth/adminViews');

test('client ADMIN_NAV item ids match server ADMIN_VIEW_IDS (minus permission-only ids)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../public/js/components/AdminSidebar.js'), 'utf8'
  );
  const start = src.indexOf('export const ADMIN_NAV');
  const end   = src.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = src.slice(start, end);
  const ids = [...block.matchAll(/id:\s*'([a-z]+)'/g)].map(m => m[1]);
  // Permission-only ids (e.g. `allaccounts`) gate a scope, not a screen: they
  // are grantable but have no sidebar line, so the nav must NOT carry them.
  const screenIds = ADMIN_VIEW_IDS.filter(id => !PERMISSION_VIEW_IDS.includes(id));
  expect(ids.length).toBe(screenIds.length);
  expect(new Set(ids)).toEqual(new Set(screenIds));
  for (const id of PERMISSION_VIEW_IDS) {
    expect(ADMIN_VIEW_IDS).toContain(id);
    expect(ids).not.toContain(id);
  }
});
