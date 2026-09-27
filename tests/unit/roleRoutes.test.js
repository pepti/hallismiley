// The role × route harness derives its route list from the router
// (e2e/lib/routes.js; harvest 2 lane 9). This pins the derivation at the unit
// tier, so a router change that the parse cannot read fails here in seconds
// rather than as a shrunken Playwright matrix.
const fs = require('fs');
const path = require('path');
const { ALL, PUBLIC_ROUTES, ADMIN_ROUTES, parseRouter, mayOpen } = require('../../e2e/lib/routes');

describe('e2e/lib/routes.js', () => {
  test('every router pattern is parsed, with the view it renders', () => {
    const listed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/js/routePatterns.json'), 'utf8')).patterns;
    // hallismiley re-apply (engine-sync 5, 2026-09-27; drop once the engine
    // takes it): a product's own routes (identity.routes) may be absent from
    // the JSON — the exemption tests/unit/routePatterns.test.js makes.
    const own = new Set(Object.keys(require('../../server/config/identity').productRoutes()));
    expect(ALL.map((r) => r.pattern).filter((p) => !own.has(p) || listed.includes(p))).toEqual(listed);
    for (const r of ALL) {
      expect({ pattern: r.pattern, view: r.view }).toEqual({ pattern: r.pattern, view: expect.stringMatching(/^\w+View$/) });
      if (r.view !== 'HomeView') {
        expect(fs.existsSync(path.join(__dirname, '../../public/js/views', `${r.view}.js`))).toBe(true);
      }
    }
  });

  test('every concrete admin route is guarded by a view id, the admin role or a session', () => {
    expect(ADMIN_ROUTES.length).toBeGreaterThan(20);
    for (const r of ADMIN_ROUTES) expect(['view', 'admin', 'signedIn']).toContain(r.guard.kind);
    expect(PUBLIC_ROUTES.some((r) => r.pattern.startsWith('/admin'))).toBe(false);
  });

  test('the guard parse reads each factory form', () => {
    const src = [
      'const ROUTES = [',
      "  { pattern: '/a', factory: async () => make('AView') },",
      "  { pattern: '/admin/x', factory: async () => (isAuthenticated() && canSeeView('leads')) ? make('XView') : new HomeView() },",
      "  { pattern: '/admin/y', factory: async () => (isAuthenticated() && isAdmin()) ? make('YView') : new HomeView() },",
      "  { pattern: '/admin', factory: async () => isAuthenticated() ? make('AdminView') : new HomeView() },",
      '];',
    ].join('\r\n');
    expect(parseRouter(src)).toEqual([
      { pattern: '/a', view: 'AView', guard: { kind: 'public' } },
      { pattern: '/admin/x', view: 'XView', guard: { kind: 'view', view: 'leads' } },
      { pattern: '/admin/y', view: 'YView', guard: { kind: 'admin' } },
      { pattern: '/admin', view: 'AdminView', guard: { kind: 'signedIn' } },
    ]);
  });

  test('mayOpen: admin opens all; a view holder only its views; admin-only never', () => {
    const leads = { pattern: '/admin/leads', guard: { kind: 'view', view: 'leads' } };
    const roles = { pattern: '/admin/roles', guard: { kind: 'admin' } };
    expect(mayOpen(roles, { views: ['*'], isAdmin: true })).toBe(true);
    expect(mayOpen(leads, { views: ['leads'], isAdmin: false })).toBe(true);
    expect(mayOpen(leads, { views: ['handbok'], isAdmin: false })).toBe(false);
    expect(mayOpen(roles, { views: ['leads'], isAdmin: false })).toBe(false);
  });
});
