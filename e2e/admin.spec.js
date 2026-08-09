const { test, expect } = require('@playwright/test');
const { loginAsAdmin }  = require('./helpers');

test.describe('Admin features', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Edit Project button is visible on project detail page', async ({ page }) => {
    await page.goto('/#/projects');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await page.getByRole('button', { name: /View project: Stofan Bakhús/i }).click();

    await expect(page.locator('.pd-edit-toggle')).toBeVisible({ timeout: 10_000 });
  });

  test('clicking Edit Project enters edit mode', async ({ page }) => {
    await page.goto('/#/projects');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await page.getByRole('button', { name: /View project: Stofan Bakhús/i }).click();

    await page.locator('.pd-edit-toggle').click();

    // Edit mode banner with Save / Cancel buttons
    await expect(page.locator('.pd-edit-banner')).toBeVisible();
    await expect(page.locator('#pd-save-btn')).toBeVisible();
    await expect(page.locator('#pd-cancel-btn')).toBeVisible();

    // Editable title field
    await expect(page.locator('#pd-edit-title')).toBeVisible();
  });

  test('Admin Users page loads with user table', async ({ page }) => {
    await page.goto('/#/admin/users');
    await expect(page.locator('table, .admin-users-table')).toBeVisible({ timeout: 10_000 });
    // At least the admin user should be in the table
    await expect(page.locator('td, .admin-users__cell').first()).toBeVisible();
  });

  test('Profile page shows user info and avatar', async ({ page }) => {
    await page.goto('/#/profile');
    await expect(page.locator('.main')).toBeVisible({ timeout: 10_000 });
    // Avatar should be displayed
    await expect(page.locator('img[alt*="avatar"], .profile-avatar, img.avatar')).toBeVisible();
  });

});
