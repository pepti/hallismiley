// Guards the RBAC contract: the client sidebar ADMIN_NAV item ids must stay 1:1
// with the server's canonical ADMIN_VIEW_IDS. If they drift, a route could be
// gated on a view-id that no nav item / no role checkbox ever exposes (or vice
// versa). Parses AdminSidebar.js as text so this stays a dependency-free unit
// test (the client file is an ES module; the server module is CommonJS).
const fs = require('fs');
const path = require('path');
const { ADMIN_VIEW_IDS } = require('../../server/auth/adminViews');

test('client ADMIN_NAV item ids match server ADMIN_VIEW_IDS', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../public/js/components/AdminSidebar.js'), 'utf8'
  );
  const start = src.indexOf('export const ADMIN_NAV');
  const end   = src.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = src.slice(start, end);
  const ids = [...block.matchAll(/id:\s*'([a-z]+)'/g)].map(m => m[1]);
  expect(ids.length).toBe(ADMIN_VIEW_IDS.length);
  expect(new Set(ids)).toEqual(new Set(ADMIN_VIEW_IDS));
});
