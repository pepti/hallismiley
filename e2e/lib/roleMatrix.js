// The role × route matrix, generated from the derived route list
// (e2e/lib/routes.js) for one role. Each e2e/roles/<role>.spec.js is a thin
// caller, so the four roles cannot drift apart. Ported from icelandicstore #62
// (e2e/roles/*), generalised: ice hand-listed each role's pages; here the
// routes come from the router itself.
//
// Per role:
//   • click-through — the links a person would click: the public nav + footer
//     on the home page, and for a staff role every admin sidebar line (which
//     must be exactly the views the role holds);
//   • every public route renders its own view, with no console error and no
//     5xx (the visitor and the plain account — the public site's audiences);
//   • every admin route either opens (the role holds its view: the shell, no
//     error banner) or is refused (the SPA leaves it, no shell, the view's code
//     never loads) — decided from the role's view list in the DATABASE;
//   • at 375px no page scrolls sideways (each public page, and every admin
//     page for the admin, measured after its desktop check in the same load).
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { PUBLIC_ROUTES, ADMIN_ROUTES, skipReason, mayOpen } = require('./routes');
const smoke = require('./routeSmoke');
const { ROLES, roleViews, signedInAs } = require('./roleSession');
const { clientConfig } = require('../../server/config/clientConfig');
const { disabledAdminViews } = require('../../server/config/modules');

/** The admin sidebar's id → route map, read from AdminSidebar.js like admin-views-parity.test.js. */
function sidebarRoutes() {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/components/AdminSidebar.js'), 'utf8');
  const start = src.indexOf('export const ADMIN_NAV');
  const block = src.slice(start, src.indexOf('];', start));
  return new Map([...block.matchAll(/id:\s*'([a-z]+)',\s*route:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

/** What the sidebar must offer a holder of `views`: its grants, minus switched-off modules, minus the hidden-by-policy set for an all-views account. */
function expectedSidebar(views) {
  const all = views.includes('*');
  const off = new Set(disabledAdminViews());
  const hidden = new Set(all ? clientConfig.identity.surface.hiddenAdminViews : []);
  const out = [];
  for (const [id, route] of sidebarRoutes()) {
    if ((all || views.includes(id)) && !off.has(id) && !hidden.has(id)) out.push(route);
  }
  return out.sort();
}

/**
 * @param test   the spec's `test`
 * @param key    'anonymous' | 'user' | 'seller' | 'admin'
 */
function defineRoleMatrix(test, key) {
  test.describe(`role ${key}`, () => defineFor(test, key));
}

function defineFor(test, key) {
  const signedIn = key !== 'anonymous';
  if (signedIn) test.use(signedInAs(key));
  const roleName = signedIn ? ROLES[key].role : null;
  let views = [];

  test.beforeAll(async () => {
    if (!signedIn) return;
    const v = await roleViews(roleName);
    test.skip(v === null, `role "${roleName}" does not exist on this product`);
    views = v || [];
  });

  const holder = () => ({ views, isAdmin: key === 'admin' });

  test.describe('click-through', () => {
    test('every public nav and footer link renders', async ({ page }) => {
      test.setTimeout(120_000);
      await smoke.openRoute(page, '/');
      const routes = [
        ...await smoke.linkRoutes(page, '.lol-nav'),
        ...await smoke.linkRoutes(page, '.lol-footer'),
      ].filter((r, i, a) => r !== '/' && !r.startsWith('/admin') && a.indexOf(r) === i);
      expect(routes.length, 'the home page offers no public links').toBeGreaterThan(0);
      for (const r of routes) {
        const w = smoke.watch(page);
        try {
          let link = page.locator(`.lol-nav a[data-route="${r}"], .lol-footer a[data-route="${r}"]`).filter({ visible: true }).first();
          if (!(await link.count())) {
            await smoke.openRoute(page, '/');
            link = page.locator(`.lol-nav a[data-route="${r}"], .lol-footer a[data-route="${r}"]`).filter({ visible: true }).first();
          }
          await link.click();
          await expect.poll(() => new URL(page.url()).pathname, { message: `clicking ${r}` }).toMatch(new RegExp(`${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
          await expect(page.locator('.not-found'), `${r} rendered the 404 view`).toHaveCount(0);
          await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
          smoke.assertClean(w, `${r} (clicked)`);
        } finally {
          w.stop();
        }
      }
    });

    if (key === 'admin' || key === 'seller') {
      test('the admin sidebar offers exactly the views the role holds, and each line opens', async ({ page }) => {
        test.setTimeout(180_000);
        await smoke.openRoute(page, '/admin');
        await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 15_000 });
        const offered = (await smoke.linkRoutes(page, '.admin-sidebar'))
          .filter((r) => r.startsWith('/admin'))
          .sort();
        expect(offered).toEqual(expectedSidebar(views));
        for (const r of offered) {
          const w = smoke.watch(page);
          try {
            await page.locator(`.admin-sidebar a[data-route="${r}"]`).filter({ visible: true }).first().click();
            await expect.poll(() => new URL(page.url()).pathname, { message: `clicking ${r}` }).toMatch(new RegExp(`${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
            await expect(page.locator('.admin-shell').first()).toBeVisible({ timeout: 15_000 });
            await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
            await expect(page.locator('.admin-error'), `error banner on ${r}`).toHaveCount(0);
            smoke.assertClean(w, `${r} (clicked)`);
          } finally {
            w.stop();
          }
        }
      });
    }
  });

  // The public sweep runs for the two audiences of the public site — a
  // visitor and a signed-in account (nav, user menu, the signed-in pages). The
  // staff roles see the same pages; their share of the budget goes to the
  // admin matrix below, and they still click through the public nav above.
  if (key === 'anonymous' || key === 'user') test.describe('every public route', () => {
    for (const route of PUBLIC_ROUTES) {
      test(`${route.pattern} renders and fits 375px`, async ({ page }) => {
        const why = skipReason(route);
        test.skip(Boolean(why), why || '');
        const views$ = smoke.watchViews(page);
        const w = smoke.watch(page);
        try {
          await smoke.expectRendered(page, route, w, views$);
          await smoke.expectNoSideScroll(page, route.pattern);
        } finally {
          w.stop();
        }
      });
    }
  });

  test.describe('every admin route', () => {
    for (const route of ADMIN_ROUTES) {
      test(`${route.pattern} ${key === 'admin' ? 'opens' : 'opens only with its view'}`, async ({ page }) => {
        const why = skipReason(route);
        test.skip(Boolean(why), why || '');
        const views$ = smoke.watchViews(page);
        const w = smoke.watch(page);
        try {
          if (!signedIn) {
            await smoke.expectRefused(page, route, w, views$);
          } else if (route.pattern === '/admin' && key !== 'admin') {
            // AdminView forwards a role without `dashboard` to its first
            // sidebar line, or home when it holds no admin view at all.
            await smoke.openRoute(page, route.pattern);
            const first = expectedSidebar(views)[0];
            if (first) {
              await expect.poll(() => new URL(page.url()).pathname).toMatch(new RegExp(`/admin/.+$`));
              await expect(page.locator('.admin-shell').first()).toBeVisible({ timeout: 15_000 });
            } else {
              await expect.poll(() => new URL(page.url()).pathname).not.toMatch(/\/admin$/);
              await expect(page.locator('.admin-shell')).toHaveCount(0);
            }
            smoke.assertClean(w, route.pattern);
          } else if (mayOpen(route, holder())) {
            await smoke.expectAdminOpens(page, route, w, views$);
            if (key === 'admin') await smoke.expectNoSideScroll(page, route.pattern);
          } else {
            await smoke.expectRefused(page, route, w, views$);
          }
        } finally {
          w.stop();
        }
      });
    }
  });
}

module.exports = { defineRoleMatrix, expectedSidebar, sidebarRoutes };
