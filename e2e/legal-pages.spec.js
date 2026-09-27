// @ts-check
// The legal pages name the site they are on (legal-pages-site-host): the
// host comes from the canonical origin ssrMeta bakes from APP_URL, so
// rekstrarkerfi.is says rekstrarkerfi.is and orangesmiley.is says
// orangesmiley.is — one engine page, no product fork. The landscape images
// are the company's own (iceland-v2), not licensed photographs.
const { test, expect } = require('@playwright/test');

for (const path of ['/is/terms', '/is/personuvernd', '/en/terms', '/en/personuvernd']) {
  test(`${path} names this site's own host`, async ({ page }) => {
    await page.goto(path);
    const canonical = await page.locator('#ssr-canonical').getAttribute('href');
    const host = new URL(String(canonical)).hostname.replace(/^www\./, '');
    const first = page.locator('.legal-section').first();
    await expect(first.locator('strong').first()).toHaveText(host);
    await expect(page.locator('.legal-article')).not.toContainText('{siteHost}');
  });
}

test('the terms credit the landscape images to the company, not to licensed photographers', async ({ page }) => {
  await page.goto('/is/terms');
  const article = page.locator('.legal-article');
  await expect(article).toContainText('Landslagsmyndirnar á vefnum eru gerðar af Orange Smiley ehf.');
  await expect(article).not.toContainText('leyfi höfunda');
  await expect(article.locator('a[href="/assets/iceland/CREDITS.md"]')).toHaveCount(1);
});
