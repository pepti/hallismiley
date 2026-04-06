const { test, expect } = require('@playwright/test');

const MOBILE = { width: 375, height: 812 };

test.describe('Responsive layout — 375px mobile', () => {

  test.use({ viewport: MOBILE });

  test('homepage renders at 375px width', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lol-hero')).toBeVisible();
    await expect(page.locator('.lol-hero__title')).toBeVisible();
  });

  test('navbar is present on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lol-nav').first()).toBeVisible();
  });

  test('no horizontal overflow on homepage at 375px', async ({ page }) => {
    await page.goto('/');
    // body should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth); // eslint-disable-line no-undef
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE.width + 2); // 2px tolerance for borders
  });

  test('projects page renders at 375px', async ({ page }) => {
    await page.goto('/#/projects');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await expect(page.locator('.project-card').first()).toBeVisible();
  });

  test('project grid is single-column on mobile', async ({ page }) => {
    await page.goto('/#/projects');
    await page.waitForSelector('.project-card', { timeout: 10_000 });

    // All project cards should have the same left position (stacked, not side-by-side)
    const cards = page.locator('.project-card');
    const count = await cards.count();
    if (count >= 2) {
      const box0 = await cards.nth(0).boundingBox();
      const box1 = await cards.nth(1).boundingBox();
      // In a single-column layout the second card is below the first
      expect(box1.y).toBeGreaterThan(box0.y);
    }
  });

  test('signup page loads and is usable at 375px', async ({ page }) => {
    await page.goto('/#/signup');
    await expect(page.locator('#signup-email')).toBeVisible();
    await expect(page.locator('#signup-btn')).toBeVisible();
  });

  test('about page loads at 375px', async ({ page }) => {
    await page.goto('/#/about');
    await expect(page.locator('.main')).toBeVisible();
  });

});
