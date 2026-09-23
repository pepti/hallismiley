const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);

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
