const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin, navigateToProject } = require('./helpers');

test.describe('Project edit mode', () => {

  test.describe('as admin', () => {

    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page);
    });

    test('Edit Project button is visible on project detail page', async ({ page }) => {
      await navigateToProject(page);
      await expect(page.locator('.pd-edit-toggle')).toBeVisible();
    });

    test('clicking Edit Project enters edit mode', async ({ page }) => {
      await navigateToProject(page);
      await page.locator('.pd-edit-toggle').click();

      await expect(page.locator('.pd-edit-banner')).toBeVisible();
      await expect(page.locator('#pd-save-btn')).toBeVisible();
      await expect(page.locator('#pd-cancel-btn')).toBeVisible();
    });

    test('edit mode shows editable title field', async ({ page }) => {
      await navigateToProject(page);
      await page.locator('.pd-edit-toggle').click();

      await expect(page.locator('#pd-edit-title')).toBeVisible();
    });

    test('cancel exits edit mode', async ({ page }) => {
      await navigateToProject(page);
      await page.locator('.pd-edit-toggle').click();
      await expect(page.locator('.pd-edit-banner')).toBeVisible();

      await page.locator('#pd-cancel-btn').click();
      await expect(page.locator('.pd-edit-banner')).not.toBeVisible({ timeout: 8_000 });
    });

    test('gallery controls are visible in edit mode', async ({ page }) => {
      await navigateToProject(page);
      await page.locator('.pd-edit-toggle').click();

      // Gallery should have management controls
      await expect(page.locator('.gallery-grid')).toBeVisible({ timeout: 8_000 });
    });

  });

  test.describe('as regular (logged-out) user', () => {

    test('Edit Project button is NOT visible for logged-out user', async ({ page }) => {
      await navigateToProject(page);
      await expect(page.locator('.pd-edit-toggle')).toHaveCount(0);
    });

  });

});
