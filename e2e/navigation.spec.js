const { test, expect } = require('@playwright/test');

test.describe('Navigation — basic page loads', () => {

  // The site is Icelandic by default: Accept-Language no longer switches the
  // locale, so a Playwright browser (en-US) still lands on Icelandic. English
  // lives at /en/ — assert each locale at its own explicit URL.
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

  test('homepage hero shows the Iceland scene by default', async ({ page }) => {
    // Halli's call (2026-08-21, the "Úti á Íslandi" re-skin): the Iceland
    // scene engine is the default hero. Gradient/video/photo/plain remain
    // admin-selectable, so this asserts the DEFAULT, not the only possibility.
    await page.goto('/');
    const hero = page.locator('.lol-hero--scene');
    await expect(hero).toBeVisible();
    // The scene photo loads from the hashed derivative mount and actually
    // decodes (naturalWidth > 0 = a real image, not a 404 placeholder).
    const img = hero.locator('.ice-scene__img');
    await expect(img).toHaveAttribute('src', /\/assets\/iceland\//);
    await expect(hero.locator('.ice-scene')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    // Real geography, on screen.
    await expect(hero.locator('.ice-scene__chip')).toHaveText(/Skógafoss/);
    // No legacy media layers in scene mode.
    await expect(page.locator('video.lol-hero__bg')).toHaveCount(0);
    await expect(page.locator('.lol-hero__overlay')).toHaveCount(0);
  });

  test('Projects page loads and shows project cards', async ({ page }) => {
    await page.goto('/#/verkefni');
    await expect(page.locator('.project-card').first()).toBeVisible({ timeout: 10_000 });
  });

  // The card's aria-label is Icelandic by default ("Skoða verkefni: <title>"),
  // so match on the project title, which is the same in both locales.
  test('project detail page loads for Stofan Bakhús', async ({ page }) => {
    await page.goto('/#/verkefni');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await page.getByRole('button', { name: /Stofan Bakhús/i }).click();
    await expect(page.locator('.pd-hero__title')).toContainText('Stofan Bakhús');
  });

  test('project detail page shows gallery images', async ({ page }) => {
    await page.goto('/#/verkefni');
    await page.waitForSelector('.project-card', { timeout: 10_000 });
    await page.getByRole('button', { name: /Stofan Bakhús/i }).click();
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
