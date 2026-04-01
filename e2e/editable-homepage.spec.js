const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.describe('Editable homepage', () => {

  test('Edit Page button NOT visible for logged-out users', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-edit-btn')).toHaveCount(0);
  });

  test('Edit Page button IS visible for admin', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('#home-edit-btn')).toBeVisible();
  });

  test('clicking Edit Page activates contenteditable on content elements', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('#home-edit-btn').click();

    // At least one editable element should have contenteditable=true
    const first = page.locator('[data-content-key]').first();
    await expect(first).toHaveAttribute('contenteditable', 'true');
  });

  test('edit bar (save/cancel) appears after clicking Edit Page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('#home-edit-btn').click();

    await expect(page.locator('#home-edit-bar')).toBeVisible();
    await expect(page.locator('#home-edit-save')).toBeVisible();
    await expect(page.locator('#home-edit-cancel')).toBeVisible();
  });

  test('cancel reverts editable fields and hides edit bar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('#home-edit-btn').click();

    // Capture original text of a content element
    const target = page.locator('[data-content-key="news_heading"]');
    const original = await target.textContent();

    // Type something different
    await target.fill('CHANGED_TEXT_XYZ');

    // Cancel
    await page.locator('#home-edit-cancel').click();

    // Text should revert
    await expect(target).toHaveText(original.trim());

    // Edit bar should be gone
    await expect(page.locator('#home-edit-bar')).not.toBeVisible();

    // Edit button should be back
    await expect(page.locator('#home-edit-btn')).toBeVisible();
  });

  test('save persists changes — reloading shows new text', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('#home-edit-btn').click();

    const target = page.locator('[data-content-key="news_heading"]');
    const original = await target.textContent();
    const newText  = `Test heading ${Date.now()}`;

    await target.fill(newText);
    await page.locator('#home-edit-save').click();

    // Edit bar should close
    await expect(page.locator('#home-edit-bar')).not.toBeVisible();

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('[data-content-key="news_heading"]')).toHaveText(newText);

    // Cleanup: restore original text
    await page.locator('#home-edit-btn').click();
    await page.locator('[data-content-key="news_heading"]').fill(original.trim());
    await page.locator('#home-edit-save').click();
  });

});
