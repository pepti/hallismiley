// Admin → Monitoring: the "Latest updates" card (ice #209/#220) and the page's
// stylesheet, which the H4 harvest had left behind (the view rendered with no
// admin-monitoring.css until 2026-09-02).
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin } = require('./helpers');

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('admin monitoring — latest updates card', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/monitoring');
    await page.waitForLoadState('networkidle');
  });

  test('the card is the first section and shows either the dev sentence or a change list', async ({ page }) => {
    const first = page.locator('.mon-card').first();
    await expect(first.locator('.mon-card__title')).toHaveText(/Nýjustu uppfærslur/i);
    const host = page.locator('#mon-updates');
    // server/changes.json is a build artifact; a checkout without it says so,
    // a stamped checkout lists commits. Either way: not loading, not an error.
    await expect(host.locator('.mon-loading, .mon-updates')).toHaveCount(1, { timeout: 10_000 });
    await expect(host.locator('.mon-error')).toHaveCount(0);
    await expect(host).not.toContainText('form.loading');
  });

  test('the stylesheet is applied — cards are styled surfaces, not bare divs', async ({ page }) => {
    const styled = await page.locator('.mon-card').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.borderRadius !== '0px' && cs.borderTopWidth !== '0px';
    });
    expect(styled).toBe(true);
  });

  test('refresh reloads the card without breaking the rest of the page', async ({ page }) => {
    const reloaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/system/changes');
    await page.click('#mon-refresh');
    expect((await reloaded).status()).toBe(200);
    await expect(page.locator('#mon-updates .mon-error')).toHaveCount(0);
    // Five sections since 2026-09-07: updates, event log, session log, health,
    // and the staff audit log (migration 098).
    await expect(page.locator('.mon-card')).toHaveCount(5);
    await expect(page.locator('#mon-audit')).toBeVisible();
  });
});
