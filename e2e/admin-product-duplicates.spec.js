// Products → Duplicates (harvest 2 lane 6b; ported from icelandicstore
// #309/#312): the suggestions page shows a planted pair with its evidence, the
// heading takes focus, the preview plans on the server, and Merge folds the
// pair — after which the merged product's page answers 301 to the survivor.
// The shop is a HIDDEN surface here — hidden, not switched off, so its admin
// routes work for an admin who types the URL. The pair is this spec's own and
// is removed again (the merged row too: nothing else references it).
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');

const KEEP = { slug: 'e2e-dup-lopi-keep', name: 'E2E Lopapeysa Hekla', sku: 'E2E-DUP-1', stock: 2 };
const GONE = { slug: 'e2e-dup-lopi-gone', name: 'E2E Hekla lopapeysa', sku: 'E2E-DUP-1B', stock: 3 };
const BARCODE = '5690000000046';

async function withPool(fn) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try { return await fn(pool); } finally { await pool.end(); }
}

test.describe('Products → Duplicates', () => {
  test.beforeAll(async () => {
    await withPool(async (pool) => {
      await pool.query('DELETE FROM product_merges WHERE merged_slug = ANY($1)', [[KEEP.slug, GONE.slug]]);
      await pool.query('DELETE FROM inventory_adjustments WHERE product_id IN (SELECT id FROM products WHERE slug = ANY($1))', [[KEEP.slug, GONE.slug]]);
      await pool.query('UPDATE products SET merged_into_id = NULL WHERE slug = ANY($1)', [[KEEP.slug, GONE.slug]]);
      await pool.query('DELETE FROM products WHERE slug = ANY($1)', [[KEEP.slug, GONE.slug]]);
      for (const p of [KEEP, GONE]) {
        await pool.query(
          `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, sku, barcode, active)
           VALUES ($1, $2, '', 12900, 9000, $3, 'product', $4, $5, TRUE)`,
          [p.slug, p.name, p.stock, p.sku, BARCODE]);
      }
    });
  });

  test.afterAll(async () => {
    await withPool(async (pool) => {
      await pool.query('DELETE FROM product_merges WHERE merged_slug = ANY($1)', [[KEEP.slug, GONE.slug]]);
      await pool.query('DELETE FROM inventory_adjustments WHERE product_id IN (SELECT id FROM products WHERE slug = ANY($1))', [[KEEP.slug, GONE.slug]]);
      await pool.query('UPDATE products SET merged_into_id = NULL WHERE slug = ANY($1)', [[KEEP.slug, GONE.slug]]);
      await pool.query('DELETE FROM products WHERE slug = ANY($1)', [[KEEP.slug, GONE.slug]]);
    });
  });

  test('the pair is suggested, previewed on the server and merged; the old URL 301s', async ({ page, request }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/shop/products/duplicates');
    await expect(page.locator('#pdup-title')).toBeFocused();

    const group = page.locator('.pdup-group', { hasText: KEEP.name });
    await expect(group).toHaveCount(1);
    await expect(group.locator('.pdup-badge--barcode')).toBeVisible();
    // keep the planted KEEP row whatever the suggestion was
    await group.getByRole('radio', { name: new RegExp(KEEP.name) }).check();

    const posts = [];
    page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
    await group.locator('[data-preview]').click();
    const planTitle = group.locator('.pdup-plan__title');
    await expect(planTitle).toBeFocused();
    await expect(group.locator('.pdup-refusals')).toHaveCount(0);
    const mergeBtn = group.locator('[data-merge]');
    await expect(mergeBtn).toBeEnabled();

    page.once('dialog', d => d.accept());
    await mergeBtn.click();
    await expect(page.locator('#pdup-live')).toContainText(GONE.name);
    expect(posts.filter(p => p.endsWith('/products/merge'))).toHaveLength(1);

    const res = await request.get(`/api/v1/shop/products/${GONE.slug}`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toBe(`/api/v1/shop/products/${KEEP.slug}`);
    const stock = await withPool(async (pool) =>
      (await pool.query('SELECT slug, stock, active FROM products WHERE slug = ANY($1) ORDER BY slug', [[KEEP.slug, GONE.slug]])).rows);
    expect(stock).toEqual([
      { slug: GONE.slug, stock: 0, active: false },
      { slug: KEEP.slug, stock: 5, active: true },
    ]);
  });
});
