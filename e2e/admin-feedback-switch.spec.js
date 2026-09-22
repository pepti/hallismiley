// Admin → Feedback: the PROD on/off switch for the change-request widget
// (ice #206). The e2e server runs with NODE_ENV=test, so the page explains
// that this environment always has the widget on for admins and the switch
// governs the live site. Persisting the switch is what is under test here; the
// server gate itself is covered by tests/integration/changeRequests.test.js.
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.use({ viewport: { width: 1280, height: 900 } });

// Halli, 2026-09-22: the TEST chrome (badge, nav glow, feedback widget) is an
// admin's tool. A logged-out visitor on the test stack sees production.
test.describe('TEST chrome — admins only', () => {
  test('a logged-out visitor sees no TEST badge and no feedback widget', async ({ page }) => {
    await page.goto('/is/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toHaveClass(/is-test-env/);
    await expect(page.locator('.test-env-badge')).toHaveCount(0);
    await expect(page.locator('#cr-widget')).toHaveCount(0);
  });

  test('a signed-in admin gets the badge and the widget', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toHaveClass(/is-test-env/);
    await expect(page.locator('.lol-nav .test-env-badge')).toBeVisible();
    await expect(page.locator('#cr-fab')).toBeVisible();
  });
});

test.describe('admin feedback — change-request switch', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/feedback');
    await page.waitForLoadState('networkidle');
  });

  test('the switch renders for an admin with the non-production note, and persists', async ({ page }) => {
    const sec = page.locator('#cr-switch');
    await expect(sec).toBeVisible();
    await expect(page.locator('#cr-switch-help')).toContainText(/prófunarumhverfi/i);

    const input = page.locator('#cr-switch-input');
    const start = await input.isChecked();

    const saved = page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/v1/admin/change-requests/settings' && r.request().method() === 'PATCH');
    await input.click();
    expect((await saved).status()).toBe(200);
    await expect(input).toBeChecked({ checked: !start });

    // Reload — the value came back from the server, not from the DOM.
    await page.goto('/is/admin/feedback');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#cr-switch-input')).toBeChecked({ checked: !start });

    // Leave it as we found it so other specs see a known state.
    const restored = page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/v1/admin/change-requests/settings' && r.request().method() === 'PATCH');
    await page.locator('#cr-switch-input').click();
    expect((await restored).status()).toBe(200);
  });

  test('the widget relabels itself when the locale switches (localechange)', async ({ page }) => {
    // The widget is mounted for admins on the test stack.
    const fab = page.locator('#cr-fab-label');
    await expect(fab).toBeVisible();
    const isText = (await fab.textContent()).trim();
    await page.goto('/en/admin/feedback');
    await page.waitForLoadState('networkidle');
    const enText = (await page.locator('#cr-fab-label').textContent()).trim();
    expect(enText).not.toBe(isText);
  });
});
