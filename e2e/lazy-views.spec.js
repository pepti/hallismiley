// Views load when their route is visited (public/js/router.js VIEWS), not at
// boot: the router used to import every view at once, so a full page load
// pulled the whole app (158 modules, ~1.9 MB) before it could start. A page
// loads the shell plus its own view — and another view's code arrives only
// when someone goes there. Ported from icelandicstore #426
// (harvest-ice-e-2026-09-24).
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin } = require('./helpers');

function recordViews(page) {
  const views = new Set();
  page.on('request', (r) => {
    const m = new URL(r.url()).pathname.match(/\/views\/([\w-]+)\.js$/);
    if (m) views.add(m[1]);
  });
  return views;
}

test('a public page boots on the shell and its own view only', async ({ page }) => {
  const views = recordViews(page);
  await page.goto('/en/thjonusta');
  await expect(page.locator('#app')).not.toBeEmpty();
  expect(views.has('ThjonustaView')).toBe(true);
  expect(views.has('AdminView')).toBe(false);
  expect(views.has('AdminBooksView')).toBe(false);
  // The two fallbacks plus this page — far from the ~68 it used to be.
  expect(views.size).toBeLessThan(10);
});

test('an admin page loads its own view, and another view only when visited', async ({ page }) => {
  await loginAsAdmin(page);
  const views = recordViews(page);
  await page.goto('/en/admin/leads');
  await expect(page.locator('#leads-q')).toBeVisible();

  expect(views.has('AdminLeadsView')).toBe(true);
  expect(views.has('AdminAccountsView')).toBe(false);
  expect(views.has('AdminBooksView')).toBe(false);
  expect(views.size).toBeLessThan(10);

  const accountsModule = page.waitForRequest((r) => /\/views\/AdminAccountsView\.js$/.test(new URL(r.url()).pathname));
  await page.locator('.admin-sidebar a[data-route="/admin/accounts"]').first().click();
  await accountsModule;
  await expect(page).toHaveURL(/\/en\/admin\/accounts$/);
});
