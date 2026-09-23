const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { identity } = require('./lib/identity');

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
  { path: '',              is: 'Við smíðum hugbúnað',   en: 'We build software' },
  { path: '/thjonusta',    is: 'Hugbúnaður fyrir',      en: 'Software for' },
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
      for (const path of ['/thjonusta', '/um-okkur', '/hafa-samband']) {
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
    await expect(page.locator('h1.thjonusta-title')).toContainText('Software for small and medium businesses');
  });

  test('an unprefixed business path serves the visitor default to a visitor with no signal', async ({ browser }) => {
    // PUBLIC_DEFAULT_LOCALE = identity.locale.publicDefault ('is' for Orange
    // Smiley). Accept-Language is not a signal (most Icelandic browsers send
    // en-US), so the context asks for a language the site does not have.
    const ctx = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'Accept-Language': 'de-DE' } });
    const page = await ctx.newPage();
    const res = await page.goto('/');
    expect(res.url()).toMatch(new RegExp(`/${identity.locale.publicDefault}/$`));
    await ctx.close();
  });
});

test.describe('services page', () => {
  test('it sells the company\'s software work first, the product second', async ({ page }) => {
    // Halli (2026-09-13): Orange Smiley builds any software a small or medium
    // business needs. Rekstrarkerfið is one product, so it must not be the
    // page's subject — the h1 names the offering and the product sits below
    // the services.
    await page.goto('/is/thjonusta');
    await expect(page.locator('h1.thjonusta-title')).not.toContainText('Rekstrarkerfið');
    await expect(page.locator('.service-list > .service-item')).toHaveCount(6);
    await expect(page.locator('.service-item--lead')).toHaveCount(1);
    await expect(page.locator('.thjonusta-steps__item')).toHaveCount(3);
    await expect(page.locator('#thjonusta-product-title')).toHaveText('Rekstrarkerfið');

    const order = await page.evaluate(() => {
      const services = document.querySelector('.thjonusta-services');
      const product = document.querySelector('.thjonusta-product');
      return services.compareDocumentPosition(product) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();
  });

  test('the closing call to action leads to the lead form', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await page.locator('.thjonusta-cta__button').click();
    await expect(page).toHaveURL(/\/is\/hafa-samband$/);
  });
});

test.describe('Rekstrarkerfið on the services page', () => {
  // Halli (2026-09-13): no product tiers or prices on the company site —
  // only what Rekstrarkerfið is, and a way on to its own site in a new tab.
  test('shows no tiers, prices or feature matrix', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('#thjonusta-product-title')).toBeVisible();
    await expect(page.locator('.tier-card, .tier-matrix')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/þ\.kr\.|DRÖG/);
  });

  for (const locale of ['is', 'en']) {
    test(`the product link opens rekstrarkerfi.is/${locale}/ in a new tab`, async ({ page }) => {
      await page.goto(`/${locale}/thjonusta`);
      const link = page.locator('.thjonusta-product__link');
      await expect(link).toHaveAttribute('href', `https://rekstrarkerfi.is/${locale}/`);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    });
  }
});
