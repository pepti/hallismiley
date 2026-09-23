const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin } = require('./helpers');

// The inquiry form moved off the homepage onto the dedicated lead page
// (/hafa-samband) when the business IA landed. It is the same form component
// and the same POST /api/v1/contact endpoint, extended with the business
// qualifiers (company, phone, current platform).
test.describe('Lead form', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/is/hafa-samband');
    await page.waitForSelector('#contact-page-form', { timeout: 8_000 });
  });

  test('lead form is visible on the contact page', async ({ page }) => {
    await expect(page.locator('#contact-page-form')).toBeVisible();
  });

  test('lead form has name, email and message fields', async ({ page }) => {
    await expect(page.locator('#contact-page-name')).toBeVisible();
    await expect(page.locator('#contact-page-email')).toBeVisible();
    await expect(page.locator('#contact-page-message')).toBeVisible();
  });

  test('lead form has the business qualifier fields', async ({ page }) => {
    await expect(page.locator('#contact-page-company')).toBeVisible();
    await expect(page.locator('#contact-page-phone')).toBeVisible();
    await expect(page.locator('#contact-page-platform')).toBeVisible();
  });

  test('submit with all fields empty shows validation error', async ({ page }) => {
    await page.locator('#contact-page-submit').click();
    await expect(page.locator('#contact-page-status')).toHaveClass(/error/);
  });

  test('submit with only name filled shows validation error', async ({ page }) => {
    await page.fill('#contact-page-name', 'Test User');
    await page.locator('#contact-page-submit').click();
    await expect(page.locator('#contact-page-status')).toHaveClass(/error/);
  });

  test('submit with valid data shows success message', async ({ page }) => {
    await page.fill('#contact-page-name', 'E2E Tester');
    await page.fill('#contact-page-email', 'e2e@test.com');
    await page.fill('#contact-page-message', 'This is an automated E2E test message from Playwright.');
    await page.locator('#contact-page-submit').click();

    await expect(page.locator('#contact-page-status')).toHaveClass(/success/, { timeout: 10_000 });
  });

  test('a full business submission succeeds', async ({ page }) => {
    await page.fill('#contact-page-name', 'E2E Tester');
    await page.fill('#contact-page-company', 'Ísprjón ehf.');
    await page.fill('#contact-page-email', 'e2e@test.com');
    await page.fill('#contact-page-phone', '+354 555 1234');
    await page.selectOption('#contact-page-platform', 'shopify');
    await page.fill('#contact-page-message', 'We are on Shopify today and would like a demo of the platform.');
    await page.locator('#contact-page-submit').click();

    await expect(page.locator('#contact-page-status')).toHaveClass(/success/, { timeout: 10_000 });
  });

  test('form resets after successful submission', async ({ page }) => {
    await page.fill('#contact-page-name', 'E2E Tester');
    await page.fill('#contact-page-email', 'e2e@test.com');
    await page.fill('#contact-page-message', 'Test message for reset check.');
    await page.locator('#contact-page-submit').click();

    await expect(page.locator('#contact-page-status')).toHaveClass(/success/, { timeout: 10_000 });

    // Fields should be cleared after success
    await expect(page.locator('#contact-page-name')).toHaveValue('');
    await expect(page.locator('#contact-page-message')).toHaveValue('');
  });

});

// The page editor's Save/Cancel bar and the change-request launcher are both
// viewport-fixed in the bottom-right corner. Since the .view containing-block
// fix (identity-seam-2) both really are fixed to the viewport, and they sat on
// top of each other: the launcher (z 240) covered the bar's buttons (z 90).
// The bar now adds --cr-widget-clearance to its bottom offset while
// body.has-cr-widget is set (test-env.css / contact.css; rk-feed 2026-09-23).
// The e2e server runs NODE_ENV=test, so a signed-in admin always has the
// widget — the case this reproduces.
test.describe('Contact page editor with the change-request widget mounted', () => {
  test('the Save/Cancel bar sits clear of the launcher and its buttons take the click', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/hafa-samband');
    await expect(page.locator('#cr-widget')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/has-cr-widget/);

    await page.locator('[data-testid="edit-contact-page-btn"]').click();
    const bar    = page.locator('.contact-view__edit-controls');
    const save   = page.locator('[data-testid="edit-contact-page-save"]');
    const cancel = page.locator('[data-testid="edit-contact-page-cancel"]');
    await expect(bar).toBeVisible();

    // No overlap: the bar's box ends above the widget's box begins.
    const [barBox, fabBox] = await Promise.all([bar.boundingBox(), page.locator('#cr-widget').boundingBox()]);
    expect(barBox && fabBox).toBeTruthy();
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(fabBox.y);

    // The buttons receive pointer events: Playwright's click refuses to fire
    // when another element intercepts at the click point, so a plain click is
    // the assertion. Save first (a no-op save of unchanged content), then
    // Cancel closes the editor.
    await expect(save).toBeVisible();
    await save.click({ trial: true });
    await cancel.click();
    await expect(bar).toBeHidden();
    await expect(page.locator('[data-testid="edit-contact-page-btn"]')).toBeVisible();
  });
});
