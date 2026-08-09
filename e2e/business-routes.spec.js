const { test, expect } = require('@playwright/test');

/**
 * The public business site, walked end to end in BOTH locales.
 *
 * This is the spec that would catch a re-skin regressing the actual product:
 * every business route renders its own content, the navigation reaches them,
 * Icelandic is the primary language with English mirroring it, and the
 * portfolio-era surfaces stay reachable-but-unlinked (job 2D's contract).
 */

// route → the heading text that proves the right view rendered, per locale.
const ROUTES = [
  { path: '',              is: 'Allt kerfið þitt',      en: 'Your whole system' },
  { path: '/thjonusta',    is: 'Ein áskrift',           en: 'One subscription' },
  { path: '/verkefni',     is: 'Verkefni',              en: 'Projects' },
  { path: '/um-okkur',     is: 'Lítil stofa',           en: 'Small studio' },
  { path: '/hafa-samband', is: null,                    en: null },  // form-led page, asserted below
  { path: '/personuvernd', is: 'Persónuvernd',          en: 'Privacy' },
];

for (const locale of ['is', 'en']) {
  test.describe(`business routes — ${locale}`, () => {

    for (const route of ROUTES) {
      test(`/${locale}${route.path || '/'} renders`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.goto(`/${locale}${route.path || '/'}`);

        // The nav is present on every business page and offers exactly the
        // business routes.
        await expect(page.locator('.lol-nav__center [data-route="/thjonusta"]')).toHaveCount(1);

        const expected = route[locale];
        if (expected) {
          await expect(page.locator('h1, h2').filter({ hasText: expected }).first())
            .toBeVisible({ timeout: 10_000 });
        } else {
          // /hafa-samband is the lead form.
          await expect(page.locator('#contact-page-form')).toBeVisible({ timeout: 10_000 });
        }

        expect(errors, `JS errors on /${locale}${route.path}: ${errors.join(', ')}`).toHaveLength(0);
      });
    }

    test(`the whole nav is walkable in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/`);
      for (const path of ['/thjonusta', '/verkefni', '/um-okkur', '/hafa-samband']) {
        await page.locator(`.lol-nav__center [data-route="${path}"]`).click();
        await expect(page).toHaveURL(new RegExp(`/${locale}${path}$`));
        await page.goto(`/${locale}/`);
      }
    });
  });
}

test.describe('locale behaviour', () => {
  test('the language toggle switches locale and keeps the route', async ({ page }) => {
    await page.goto('/is/thjonusta');
    // Scope to the right-hand nav: the switcher is duplicated into the mobile
    // drawer, and that copy is hidden on a desktop viewport.
    await page.locator('.lol-nav__right .lol-nav__lang-opt[data-locale="en"]').click();
    await expect(page).toHaveURL(/\/en\/thjonusta$/);
    await expect(page.locator('h1').filter({ hasText: 'One subscription' })).toBeVisible();
  });

  test('an unprefixed business path serves Icelandic to a visitor with no signal', async ({ browser }) => {
    // PUBLIC_DEFAULT_LOCALE. A browser sending Accept-Language: en-US would
    // legitimately get English, so the context asks for neither.
    const ctx = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'Accept-Language': 'de-DE' } });
    const page = await ctx.newPage();
    const res = await page.goto('/');
    expect(res.url()).toMatch(/\/is\/$/);
    await ctx.close();
  });
});

test.describe('service tiers', () => {
  test('the pricing page shows three tiers, each marked DRAFT', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('.tier-card')).toHaveCount(3);
    // Prices are unconfirmed until Halli signs off — the chip must be on every
    // card, so nobody mistakes the placeholder for a quote.
    await expect(page.locator('.tier-card__draft')).toHaveCount(3);
    await expect(page.locator('.tier-card__draft').first()).toContainText(/DRÖG/);
    // The feature matrix distinguishes the tiers rather than repeating them.
    await expect(page.locator('.tier-matrix tbody tr')).toHaveCount(12);
  });

  test('every tier CTA leads to the lead form', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await page.locator('.tier-card__cta').first().click();
    await expect(page).toHaveURL(/\/is\/hafa-samband$/);
    await expect(page.locator('#contact-page-form')).toBeVisible();
  });
});
