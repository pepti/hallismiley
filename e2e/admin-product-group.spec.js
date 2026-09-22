// The admin sidebar's Vörustýring (product) group — governing the product, as
// distinct from running this site (Halli, 2026-09-01).
//
// Which release this instance is on, how it is behaving and who may reach it
// over MCP are one job; they used to sit in Settings next to the user list,
// which is a different one. This spec pins the grouping, and — more usefully —
// pins that the move did not disturb what the ids mean: the routes still
// resolve. RBAC is keyed on ids the regroup never touched, which the unit test
// tests/unit/admin-views-parity.test.js guards from the other side.
//
// Selectors follow view mode, not edit mode: a section is a group whose toggle
// carries its key, and a line is an anchor carrying its route.
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.use({ viewport: { width: 1280, height: 900 } });

const group = key => `.admin-sidebar__group:has([data-section-toggle="${key}"])`;

const PRODUCT_LINES = [
  ['updates',    '/admin/updates'],
  ['monitoring', '/admin/monitoring'],
  ['mcp',        '/admin/mcp'],
];

test.describe('admin nav — product governance group', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/updates');
    await page.waitForLoadState('networkidle');
  });

  test('updates, monitoring and MCP live together, and not in Settings', async ({ page }) => {
    const product = page.locator(group('product'));
    await expect(product).toBeVisible();
    await expect(product.locator('a.admin-sidebar__item')).toHaveCount(3);

    const settings = page.locator(group('settings'));
    for (const [, route] of PRODUCT_LINES) {
      await expect(product.locator(`a[data-route="${route}"]`)).toHaveCount(1);
      await expect(settings.locator(`a[data-route="${route}"]`)).toHaveCount(0);
    }
    // Settings keeps the screens about this deployment's people and config.
    await expect(settings.locator('a.admin-sidebar__item')).toHaveCount(3);
  });

  test('every line in the group still reaches its screen', async ({ page }) => {
    for (const [, route] of PRODUCT_LINES) {
      await page.locator(`${group('product')} a[data-route="${route}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.locator('.admin-sidebar')).toBeVisible();
    }
  });
});
