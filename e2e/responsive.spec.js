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

  test('halli bio page loads at 375px', async ({ page }) => {
    await page.goto('/#/halli');
    await expect(page.locator('.halli-bio')).toBeVisible();
  });

  // Mobile nav layout: language toggle + auth CTAs move into the hamburger
  // drawer at <=640px so the top bar stays uncluttered. See
  // public/css/layout.css @media (max-width: 640px).
  test.describe('Mobile navigation drawer', () => {
    test('top bar hides language toggle and sign-in CTAs', async ({ page }) => {
      await page.goto('/');
      const topLang = page.locator('.lol-nav__right .lol-nav__lang');
      const topSignIn = page.locator('.lol-nav__right [data-testid="nav-signin"]');
      await expect(topLang).toBeHidden();
      await expect(topSignIn).toBeHidden();
      await expect(page.locator('#nav-hamburger')).toBeVisible();
    });

    test('drawer exposes language toggle and auth CTAs when opened', async ({ page }) => {
      await page.goto('/');
      await page.locator('#nav-hamburger').click();

      const extras = page.locator('.lol-nav__mobile-extras');
      await expect(extras).toBeVisible();
      await expect(extras.locator('.lol-nav__lang')).toBeVisible();
      await expect(page.locator('[data-testid="nav-signin-drawer"]')).toBeVisible();
      await expect(page.locator('[data-testid="nav-signup-drawer"]')).toBeVisible();
    });

    test('sign-in button inside the drawer opens the login modal', async ({ page }) => {
      await page.goto('/');
      await page.locator('#nav-hamburger').click();
      await page.locator('[data-testid="nav-signin-drawer"]').click();
      await expect(page.locator('.login-modal-overlay')).toHaveClass(/open/);
      await expect(page.locator('#login-username')).toBeVisible();
    });
  });

});
