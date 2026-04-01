const { test, expect } = require('@playwright/test');

test.describe('Contact form', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Scroll contact section into view by clicking the nav link
    await page.locator('[data-scroll="contact"]').click();
    await page.waitForSelector('#contact-form', { timeout: 8_000 });
  });

  test('contact form is visible on homepage', async ({ page }) => {
    await expect(page.locator('#contact-form')).toBeVisible();
  });

  test('contact form has name, email and message fields', async ({ page }) => {
    await expect(page.locator('#contact-name')).toBeVisible();
    await expect(page.locator('#contact-email')).toBeVisible();
    await expect(page.locator('#contact-message')).toBeVisible();
  });

  test('submit with all fields empty shows validation error', async ({ page }) => {
    await page.locator('#contact-submit').click();
    await expect(page.locator('#contact-status')).toContainText(/fill in all/i);
  });

  test('submit with only name filled shows validation error', async ({ page }) => {
    await page.fill('#contact-name', 'Test User');
    await page.locator('#contact-submit').click();
    await expect(page.locator('#contact-status')).toContainText(/fill in all/i);
  });

  test('submit with valid data shows success message', async ({ page }) => {
    await page.fill('#contact-name', 'E2E Tester');
    await page.fill('#contact-email', 'e2e@test.com');
    await page.fill('#contact-message', 'This is an automated E2E test message from Playwright.');
    await page.locator('#contact-submit').click();

    await expect(page.locator('#contact-status')).toContainText(/sent|touch/i, { timeout: 10_000 });
    await expect(page.locator('#contact-status')).not.toHaveClass(/error/);
  });

  test('form resets after successful submission', async ({ page }) => {
    await page.fill('#contact-name', 'E2E Tester');
    await page.fill('#contact-email', 'e2e@test.com');
    await page.fill('#contact-message', 'Test message for reset check.');
    await page.locator('#contact-submit').click();

    await expect(page.locator('#contact-status')).toContainText(/sent|touch/i, { timeout: 10_000 });

    // Fields should be cleared after success
    await expect(page.locator('#contact-name')).toHaveValue('');
    await expect(page.locator('#contact-message')).toHaveValue('');
  });

});
