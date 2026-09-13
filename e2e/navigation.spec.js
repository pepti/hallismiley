const { test, expect } = require('@playwright/test');

test.describe('Navigation — basic page loads', () => {

  // The site is Icelandic by default: Accept-Language no longer switches the
  // locale, so a Playwright browser (en-US) still lands on Icelandic. English
  // lives at /en/ — assert each locale at its own explicit URL.
  // The hero introduces the COMPANY (2026-09-01): this is Orange Smiley's own
  // site, and the product pitch it used to carry moved down to the products
  // section and /thjonusta, where a product belongs.
  test('homepage shows the company proposition in Icelandic', async ({ page }) => {
    await page.goto('/is/');
    await expect(page.locator('.lol-hero__title')).toContainText('Við smíðum hugbúnað');
    await expect(page.locator('.lol-hero__title')).toContainText('sem rekur fyrirtæki');
  });

  test('homepage mirrors the company proposition in English', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('.lol-hero__title')).toContainText('We build software');
    await expect(page.locator('.lol-hero__title')).toContainText('that runs businesses');
  });

  test('the homepage names its products, and the product card leads to them', async ({ page }) => {
    await page.goto('/is/');
    const card = page.locator('.home-products__card');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.home-products__name')).toHaveText('Rekstrarkerfið');
    await card.locator('.home-products__cta').click();
    await expect(page).toHaveURL(/\/is\/thjonusta$/);
  });

  test('homepage hero shows the waterfall video by default', async ({ page }) => {
    // Halli's call (2026-08-22, the hallismiley-layout revert): the waterfall
    // video hero is the default again. Scene/gradient/photo/plain remain
    // admin-selectable, so this asserts the DEFAULT, not the only possibility.
    await page.goto('/');
    const video = page.locator('video.lol-hero__bg');
    await expect(video).toBeAttached();
    await expect(video.locator('source')).toHaveAttribute('src', /waterfall/);
    // The dark veil is what keeps the fixed light hero copy legible.
    await expect(page.locator('.lol-hero__overlay')).toBeAttached();
    // No scene layers in video mode.
    await expect(page.locator('.lol-hero--scene')).toHaveCount(0);
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
    for (const route of ['/party', '/shop', '/news', '/halli', '/projects', '/contact', '/verkefni']) {
      await expect(nav.locator(`[data-route="${route}"]`)).toHaveCount(0);
    }
    for (const route of ['/', '/thjonusta', '/um-okkur', '/hafa-samband']) {
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

test.describe('Tab title follows SPA navigation', () => {
  // The server rewrites <title> per URL, but only on a full page load. Client
  // navigation never touched document.title, so the tab kept the landing page's
  // title for a whole session — every inner page read "Orange Smiley —
  // hugbúnaðarhús knúið gervigreind". utils/pageTitle.js + the router hook fixed
  // that; tests/unit/pageTitle.test.js pins the strings against the server's,
  // and this pins that a CLIENT-SIDE navigation actually applies them.

  test('a client-side navigation retitles the tab, matching the SSR title', async ({ page }) => {
    await page.goto('/is/');
    await expect(page).toHaveTitle('Orange Smiley — hugbúnaðarhús knúið gervigreind');

    // Navigate the way a visitor does — click the nav, no page load.
    await page.click('a[href="/is/thjonusta"]');
    await expect(page).toHaveURL(/\/is\/thjonusta$/);
    await expect(page).toHaveTitle('Þjónusta — Orange Smiley');

    // And a direct load of the same URL must agree, or the tab would say one
    // thing on load and another after a click.
    await page.goto('/is/thjonusta');
    await expect(page).toHaveTitle('Þjónusta — Orange Smiley');
  });

  test('going back restores the previous title', async ({ page }) => {
    await page.goto('/is/');
    await page.click('a[href="/is/um-okkur"]');
    await expect(page).toHaveTitle('Um okkur — Orange Smiley');
    await page.goBack();
    await expect(page).toHaveURL(/\/is\/$/);
    await expect(page).toHaveTitle('Orange Smiley — hugbúnaðarhús knúið gervigreind');
  });

  test('the English side is titled in English', async ({ page }) => {
    await page.goto('/en/');
    await page.click('a[href="/en/thjonusta"]');
    await expect(page).toHaveTitle('Services — Orange Smiley');
  });
});
