const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.describe('Editable homepage', () => {

  test('Edit Page button NOT visible for logged-out users', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="edit-page-btn"]')).toHaveCount(0);
  });

  test('Edit Page button IS visible for admin', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('[data-testid="edit-page-btn"]')).toBeVisible();
  });

  test('clicking Edit Page activates contenteditable on content elements', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-page-btn"]').click();

    // At least one editable element should have contenteditable=true
    const first = page.locator('[data-field]').first();
    await expect(first).toHaveAttribute('contenteditable', 'true');
  });

  test('edit bar (save/cancel) appears after clicking Edit Page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-page-btn"]').click();

    await expect(page.locator('[data-testid="edit-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-save-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-cancel-btn"]')).toBeVisible();
  });

  test('cancel reverts editable fields and hides edit bar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-page-btn"]').click();

    // Capture original text of a content element
    const target = page.locator('[data-field="title"]');
    const original = await target.textContent();

    // Type something different
    await target.fill('CHANGED_TEXT_XYZ');

    // Cancel
    await page.locator('[data-testid="edit-cancel-btn"]').click();

    // Text should revert
    await expect(target).toHaveText(original.trim());

    // Edit bar should be gone
    await expect(page.locator('[data-testid="edit-controls"]')).not.toBeVisible();

    // Edit button should be back
    await expect(page.locator('[data-testid="edit-page-btn"]')).toBeVisible();
  });

  test('save persists changes — reloading shows new text', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-page-btn"]').click();

    const target = page.locator('[data-field="title"]');
    const original = await target.textContent();
    const newText  = `Test heading ${Date.now()}`;

    await target.fill(newText);
    await page.locator('[data-testid="edit-save-btn"]').click();

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('[data-content-key="news_heading"]')).toHaveText(new RegExp(newText, 'i'));

    // Cleanup: restore original text
    await page.locator('[data-testid="edit-page-btn"]').click();
    await page.locator('[data-content-key="news_heading"]').fill(original.trim());
    await page.locator('[data-testid="edit-save-btn"]').click();
  });

});
