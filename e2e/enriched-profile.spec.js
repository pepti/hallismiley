const { test, expect } = require('@playwright/test');
const { loginAsAdmin }  = require('./helpers');

// ─────────────────────────────────────────────────────────────────────────────
// Profile page: new enriched sections
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Enriched profile page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/profile');
    await page.waitForSelector('.profile-header', { timeout: 10_000 });
  });

  test('profile page shows bio textarea in edit section', async ({ page }) => {
    await page.locator('#profile-edit-btn').click();
    await expect(page.locator('#edit-section')).toBeVisible();
    await expect(page.locator('#edit-bio')).toBeVisible();
  });

  test('profile page shows bio char counter', async ({ page }) => {
    await page.locator('#profile-edit-btn').click();
    await expect(page.locator('#bio-char-count')).toBeVisible();
  });

  test('profile page shows theme toggle', async ({ page }) => {
    await expect(page.locator('#theme-toggle')).toBeVisible();
  });

  test('profile page shows notification toggles', async ({ page }) => {
    await expect(page.locator('#notify-comments-toggle')).toBeVisible();
    await expect(page.locator('#notify-updates-toggle')).toBeVisible();
  });

  test('profile completeness bar is present', async ({ page }) => {
    await expect(page.locator('.profile-completeness')).toBeVisible();
    await expect(page.locator('.profile-completeness__pct')).toBeVisible();
  });

  test('favorites section is present', async ({ page }) => {
    await expect(page.locator('#favorites-section')).toBeVisible();
  });

  test('connected accounts section is present', async ({ page }) => {
    await expect(page.locator('#connected-section')).toBeVisible();
    await expect(page.locator('#edit-github')).toBeVisible();
    await expect(page.locator('#edit-linkedin')).toBeVisible();
  });

  test('comments "coming soon" placeholder is present', async ({ page }) => {
    await expect(page.locator('.coming-soon')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Theme toggle
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/profile');
    await page.waitForSelector('#theme-toggle', { timeout: 10_000 });
  });

  test('toggling theme to light adds theme-light class to body', async ({ page }) => {
    // Ensure we start in dark (uncheck if needed)
    const toggle = page.locator('#theme-toggle');
    const isChecked = await toggle.isChecked();
    if (isChecked) {
      // Already light — toggle back to dark first
      await toggle.click();
      await page.waitForTimeout(200);
    }

    // Now toggle to light
    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/theme-light/);
  });

  test('toggling back to dark removes theme-light class', async ({ page }) => {
    const toggle = page.locator('#theme-toggle');
    // Set to light
    if (!await toggle.isChecked()) await toggle.click();
    await page.waitForTimeout(200);
    // Toggle back to dark
    await toggle.click();
    await page.waitForTimeout(200);
    await expect(page.locator('body')).not.toHaveClass(/theme-light/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Public profile page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Public profile page', () => {
  test('loads at #/users/testadmin and shows avatar', async ({ page }) => {
    await page.goto('/#/users/testadmin');
    await page.waitForSelector('.public-profile-header', { timeout: 10_000 });
    await expect(page.locator('.public-profile-header__avatar')).toBeVisible();
  });

  test('public profile shows username', async ({ page }) => {
    await page.goto('/#/users/testadmin');
    await page.waitForSelector('.public-profile-header', { timeout: 10_000 });
    await expect(page.locator('.public-profile-header__username')).toContainText('testadmin');
  });

  test('public profile shows role badge', async ({ page }) => {
    await page.goto('/#/users/testadmin');
    await page.waitForSelector('.public-profile-header', { timeout: 10_000 });
    await expect(page.locator('.badge')).toBeVisible();
  });

  test('nonexistent user shows not-found message', async ({ page }) => {
    await page.goto('/#/users/no-such-user-xyz-12345');
    await page.waitForSelector('.not-found, .public-profile-container', { timeout: 10_000 });
    await expect(page.locator('.not-found__title')).toBeVisible();
  });

  test('public profile does not show edit controls', async ({ page }) => {
    await page.goto('/#/users/testadmin');
    await page.waitForSelector('.public-profile-header', { timeout: 10_000 });
    await expect(page.locator('#profile-edit-btn')).not.toBeVisible();
    await expect(page.locator('#pw-form')).not.toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Favorite button on project cards
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Favorite button on project cards', () => {
  test('favorite button visible on project cards when logged in', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/projects');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    // At least one card should have a fav button
    await expect(page.locator('.project-card__fav-btn').first()).toBeVisible();
  });

  test('favorite button not visible when logged out', async ({ page }) => {
    // Do not log in
    await page.goto('/#/projects');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    const favBtns = page.locator('.project-card__fav-btn');
    await expect(favBtns).toHaveCount(0);
  });
});
