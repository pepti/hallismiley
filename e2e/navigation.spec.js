const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
// Brand, hero clip and title suffix come from the product identity
// (config/client.json → <script id="identity">), never from a literal, so the
// engine's spec passes unchanged in a downstream with its own identity.
const { identity, readIdentity, escapeRe, isHiddenRoute } = require('./lib/identity');
const { tClient } = require('./lib/locale');
// The company pages (/thjonusta, /um-okkur, /hafa-samband) and the products
// card are the COMPANY site's: a downstream that hides /thjonusta
// (hallismiley) links none of them, so the cases that click through them run
// only where the services page is public (identity-seam-3).
const testCompany = isHiddenRoute('/thjonusta') ? test.skip : test;

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

  testCompany('the homepage names its products, and the product card leads to the product site', async ({ page }) => {
    // Halli (2026-09-13): anyone who wants to know more about Rekstrarkerfið
    // goes to its own site in a new tab; the company site carries no tiers.
    for (const locale of ['is', 'en']) {
      await page.goto(`/${locale}/`);
      const card = page.locator('.home-products__card');
      await expect(card).toHaveCount(1);
      await expect(card.locator('.home-products__name')).toHaveText('Rekstrarkerfið');
      const cta = card.locator('.home-products__cta');
      await expect(cta).toHaveAttribute('href', `https://rekstrarkerfi.is/${locale}/`);
      await expect(cta).toHaveAttribute('target', '_blank');
      await expect(cta).toHaveAttribute('rel', /noopener/);
    }
  });

  test('homepage hero shows the background video by default', async ({ page }) => {
    // Halli's call (2026-08-22, the hallismiley-layout revert): the video hero
    // is the default again. Scene/gradient/photo/plain remain admin-selectable,
    // so this asserts the DEFAULT, not the only possibility. The clip is the
    // product's (identity.hero; for Orange Smiley hero-dc7df since 2026-09-13,
    // when the waterfall gave way to it) — the page must show the clip the
    // server handed it, and that must be the one this repo's config names.
    await page.goto('/');
    const served = await readIdentity(page);
    expect(served.hero).toEqual(identity.hero);
    const video = page.locator('video.lol-hero__bg');
    await expect(video).toBeAttached();
    await expect(video.locator('source')).toHaveAttribute('src', new RegExp(`${escapeRe(identity.hero.clip)}$`));
    await expect(video).toHaveAttribute('poster', new RegExp(`${escapeRe(identity.hero.poster)}$`));
    await expect(video).toHaveAttribute('autoplay', '');
    // The dark veil is what keeps the fixed light hero copy legible.
    await expect(page.locator('.lol-hero__overlay')).toBeAttached();
    // No scene layers in video mode.
    await expect(page.locator('.lol-hero--scene')).toHaveCount(0);
  });

  test('homepage hero video stays still under reduced motion, and follows a live change', async ({ page }) => {
    // The clip is a continuous camera push-in. Like every animated surface it
    // asks utils/motion.js first: reduced motion shows the poster, downloads
    // nothing, and starts only if the visitor turns the setting off.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const video = page.locator('video.lol-hero__bg');
    await expect(video).toBeAttached();
    await expect(video).not.toHaveAttribute('autoplay', /.*/);
    await expect(video).toHaveAttribute('preload', 'none');
    await expect(video).toHaveAttribute('poster', new RegExp(`${escapeRe(identity.hero.poster)}$`));
    // Give autoplay every chance to misbehave before asserting it did not.
    await page.waitForTimeout(500);
    expect(await video.evaluate((v) => v.paused)).toBe(true);
    expect(await video.evaluate((v) => v.currentTime)).toBe(0);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => video.evaluate((v) => !v.paused)).toBe(true);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);
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

  testCompany('Contact page is reachable from the navbar', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-route="/hafa-samband"]').click();
    await expect(page.locator('#contact-page-form')).toBeAttached();
  });

  testCompany('services page is reachable from the navbar and lists the services', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-route="/thjonusta"]').click();
    await expect(page.locator('.service-list > .service-item')).toHaveCount(6);
    await expect(page.locator('.thjonusta-product__link')).toBeVisible();
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

  test('the public nav offers home + identity.surface.nav and none of the hidden routes', async ({ page }) => {
    // The list is the product's (config/client.json), read through the same
    // seam the NavBar reads — never a route literal.
    await page.goto('/');
    const served = await readIdentity(page);
    expect(served.surface.nav).toEqual(identity.surface.nav);
    const nav = page.locator('.lol-nav__center');
    const hidden = (r) => identity.surface.hiddenRoutes.some((h) => r === h || r.startsWith(h + '/'));
    const shown = identity.surface.nav.filter((e) => !hidden(e.route)).map((e) => e.route);
    const links = nav.locator('.lol-nav__link[data-route]');
    await expect(links).toHaveCount(1 + shown.length);
    expect(await links.evaluateAll((as) => as.map((a) => a.dataset.route))).toEqual(['/', ...shown]);
    for (const route of identity.surface.hiddenRoutes) {
      await expect(nav.locator(`[data-route="${route}"]`)).toHaveCount(0);
    }
    // The footer nav row carries the same list.
    const footer = page.locator('.lol-footer__top .lol-footer__nav-link');
    await expect(footer).toHaveCount(1 + shown.length);
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
  // that; tests/unit/pageTitle.test.js pins the page parts against the server's,
  // and this pins that a CLIENT-SIDE navigation actually applies them. The
  // brand and the suffix are the product identity's; the page parts are i18n
  // keys (`meta.<key>.title`, engine table + product overlay) composed the
  // same way on both sides — read here from the SPA table (e2e/lib/locale.js).
  const { name, titleSuffix } = identity.brand;
  const part = (key, lc) => tClient(key, {}, lc).split('{brand}').join(name);
  const HOME_IS = part('meta.home.title', 'is');

  testCompany('a client-side navigation retitles the tab, matching the SSR title', async ({ page }) => {
    await page.goto('/is/');
    await expect(page).toHaveTitle(HOME_IS);

    // Navigate the way a visitor does — click the nav, no page load.
    await page.click('a[href="/is/thjonusta"]');
    await expect(page).toHaveURL(/\/is\/thjonusta$/);
    await expect(page).toHaveTitle(`${part('meta.thjonusta.title', 'is')}${titleSuffix}`);

    // And a direct load of the same URL must agree, or the tab would say one
    // thing on load and another after a click.
    await page.goto('/is/thjonusta');
    await expect(page).toHaveTitle(`${part('meta.thjonusta.title', 'is')}${titleSuffix}`);
  });

  testCompany('going back restores the previous title', async ({ page }) => {
    await page.goto('/is/');
    await page.click('a[href="/is/um-okkur"]');
    await expect(page).toHaveTitle(`${part('meta.umOkkur.title', 'is')}${titleSuffix}`);
    await page.goBack();
    await expect(page).toHaveURL(/\/is\/$/);
    await expect(page).toHaveTitle(HOME_IS);
  });

  testCompany('the English side is titled in English', async ({ page }) => {
    await page.goto('/en/');
    await page.click('a[href="/en/thjonusta"]');
    await expect(page).toHaveTitle(`${part('meta.thjonusta.title', 'en')}${titleSuffix}`);
  });

  test('the nav lockup and the footer carry the brand the server handed the page', async ({ page }) => {
    await page.goto('/is/');
    await expect(page.locator('.lol-nav__logo-text')).toHaveText(name);
    await expect(page.locator('.lol-footer__logo')).toHaveText(name);
  });
});
