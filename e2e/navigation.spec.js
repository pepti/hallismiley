const { test, expect } = require('@playwright/test');

test.describe('Navigation — basic page loads', () => {

  // The browser sends Accept-Language: en-US, which correctly beats the
  // Icelandic no-signal default — so assert each locale at its own URL.
  test('homepage shows the business value proposition in Icelandic', async ({ page }) => {
    await page.goto('/is/');
    await expect(page.locator('.lol-hero__title')).toContainText('Allt kerfið þitt');
    await expect(page.locator('.lol-hero__title')).toContainText('á einum stað');
  });

  test('homepage mirrors the value proposition in English', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('.lol-hero__title')).toContainText('Your whole system');
    await expect(page.locator('.lol-hero__title')).toContainText('in one place');
  });

  test('homepage hero is static — no video background by default', async ({ page }) => {
    // The video/photo background machinery is retained (admin background
    // settings can still select it); the business default is the plain hero.
    await page.goto('/');
    await expect(page.locator('video.lol-hero__bg')).toHaveCount(0);
  });

  test('Projects page loads and shows project cards', async ({ page }) => {
    await page.goto('/#/verkefni');
    await expect(page.locator('.project-card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('project detail page loads for Stofan Bakhús', async ({ page }) => {
    await page.goto('/#/verkefni');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await page.getByRole('button', { name: /View project: Stofan Bakhús/i }).click();
    await expect(page.locator('.pd-hero__title')).toContainText('Stofan Bakhús');
  });

  test('project detail page shows gallery images', async ({ page }) => {
    await page.goto('/#/verkefni');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await page.getByRole('button', { name: /View project: Stofan Bakhús/i }).click();
    await expect(page.locator('.gallery-grid')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.gallery-grid__item').first()).toBeVisible();
  });

  test('Contact page is reachable from the navbar', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-route="/hafa-samband"]').click();
    await expect(page.locator('#contact-page-form')).toBeAttached();
  });

  test('services page is reachable from the navbar and shows the three tiers', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-route="/thjonusta"]').click();
    await expect(page.locator('.tier-card')).toHaveCount(3);
    await expect(page.locator('.tier-card__draft').first()).toBeVisible();
  });

  test('no JavaScript errors on homepage', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    // Let async rendering settle
    await page.waitForTimeout(2_000);

    expect(errors, `Unexpected JS errors: ${errors.join(', ')}`).toHaveLength(0);
  });

});

// The contract from job 2D: portfolio-era surfaces are gone from the public
// navigation but are NOT deleted — every route still renders for anyone who
// has the URL, and the underlying APIs and admin surfaces are untouched.
test.describe('Hidden surfaces — unlinked but functional', () => {

  test('the public nav offers only the business routes', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('.lol-nav__center');
    for (const route of ['/party', '/shop', '/news', '/halli', '/projects', '/contact']) {
      await expect(nav.locator(`[data-route="${route}"]`)).toHaveCount(0);
    }
    for (const route of ['/', '/thjonusta', '/verkefni', '/um-okkur', '/hafa-samband']) {
      await expect(nav.locator(`[data-route="${route}"]`)).toHaveCount(1);
    }
  });

  test('the personal bio page still renders at its route', async ({ page }) => {
    await page.goto('/#/halli');
    await expect(page.locator('.halli-bio')).toBeVisible();
  });

  test('the shop still renders at its route', async ({ page }) => {
    await page.goto('/#/shop');
    await expect(page.locator('.shop-page').first()).toBeVisible({ timeout: 10_000 });
  });

  test('the party page still renders at its route', async ({ page }) => {
    await page.goto('/is/party');
    await expect(page.locator('.party-view, .party-hero, main').first()).toBeVisible({ timeout: 10_000 });
  });

});
