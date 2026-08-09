const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.describe('Profile page', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/profile');
    // Wait for profile to finish loading
    await page.waitForSelector('.profile-header', { timeout: 10_000 });
  });

  test('profile page loads with user avatar', async ({ page }) => {
    await expect(page.locator('.profile-header__avatar')).toBeVisible();
  });

  test('profile page shows the logged-in username', async ({ page }) => {
    await expect(page.locator('.profile-header__username')).toContainText('testadmin');
  });

  test('profile page shows email address', async ({ page }) => {
    await expect(page.locator('.profile-header__email')).toBeVisible();
  });

  test('Edit Profile button is present', async ({ page }) => {
    await expect(page.locator('#profile-edit-btn')).toBeVisible();
  });

  test('clicking Edit Profile reveals the edit panel', async ({ page }) => {
    await page.locator('#profile-edit-btn').click();
    await expect(page.locator('#edit-section')).toBeVisible();
    await expect(page.locator('#edit-displayname')).toBeVisible();
    await expect(page.locator('#edit-save-btn')).toBeVisible();
  });

  test('cancel on edit panel hides it again', async ({ page }) => {
    await page.locator('#profile-edit-btn').click();
    await expect(page.locator('#edit-section')).toBeVisible();

    await page.locator('#edit-cancel-btn').click();
    await expect(page.locator('#edit-section')).not.toBeVisible();
    await expect(page.locator('#profile-edit-btn')).toBeVisible();
  });

  test('can update display name', async ({ page }) => {
    await page.locator('#profile-edit-btn').click();

    const newName = `Test Display ${Date.now()}`;
    await page.locator('#edit-displayname').fill(newName);
    await page.locator('#edit-save-btn').click();

    // Edit section should close after save
    await expect(page.locator('#edit-section')).not.toBeVisible({ timeout: 8_000 });
  });

  test('change password section is present with required fields', async ({ page }) => {
    await expect(page.locator('#pw-form')).toBeVisible();
    await expect(page.locator('#pw-current')).toBeVisible();
    await expect(page.locator('#pw-new')).toBeVisible();
    await expect(page.locator('#pw-confirm')).toBeVisible();
  });

  test('active sessions table is visible', async ({ page }) => {
    await expect(page.locator('#sessions-tbody')).toBeVisible();
    // At least one session row (the current session) should exist
    await expect(page.locator('#sessions-tbody tr').first()).toBeVisible();
  });

  test('current session shows "Current" badge', async ({ page }) => {
    await expect(page.locator('.session-current-badge')).toBeVisible();
  });

});
