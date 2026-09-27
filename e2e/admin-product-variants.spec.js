// The product editor's variant grid (components/VariantGrid.js) — ported from
// icelandicstore #194/#381/#430 (ice e2e/admin-product-variants.spec.js;
// harvest 2 lane 6c, 2026-09-26). Before this the grid could not add a row,
// "delete" only deactivated, and nothing in e2e/ said "variant".
//   - the default order is colour → size, XS → 2XL (not the API's SKU order);
//   - "+ Add Variant" stays local until complete, then saves itself;
//   - ✕ deletes, and the row leaves the database;
//   - "+ Add a colour" plans one row per size and creates them from a paste.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');

const SLUG = 'e2e-grid-tee';
const NAME = 'E2E Grid Tee';
let productId;

test.use({ viewport: { width: 1280, height: 900 } });

async function q(sql, params) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try { return (await pool.query(sql, params)).rows; } finally { await pool.end(); }
}

test.describe('admin variant grid', () => {
  test.beforeEach(async ({ page }) => {
    await q('DELETE FROM products WHERE slug = $1', [SLUG]);
    const [p] = await q(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, variant_axes, active)
       VALUES ($1, $2, '', 3990, 2700, 0, 'product', '["color","size"]'::jsonb, TRUE) RETURNING id`, [SLUG, NAME]);
    productId = p.id;
    // Deliberately NOT in size order by SKU: M sorts before S alphabetically.
    for (const [sku, color, size] of [['E2E-G-BLK-M', 'Black', 'M'], ['E2E-G-BLK-S', 'Black', 'S'], ['E2E-G-BLK-XL', 'Black', 'XL']]) {
      await q(`INSERT INTO product_variants (product_id, sku, attributes, stock, active) VALUES ($1, $2, $3::jsonb, 0, TRUE)`,
        [productId, sku, JSON.stringify({ color, size })]);
    }
    await loginAsAdmin(page);
    await page.evaluate(() => { try { localStorage.removeItem('variantSort.grid'); } catch { /* none */ } });
    await page.goto('/is/admin/shop/products');
    await page.waitForLoadState('networkidle');
    await page.locator(`tr[data-id="${productId}"] [data-action="edit"]`).click();
    await expect(page.locator('[data-testid="variant-row"]')).toHaveCount(3);
  });

  test.afterAll(async () => { await q('DELETE FROM products WHERE slug = $1', [SLUG]); });

  const skuValues = (page) => page.locator('[data-testid="variant-row"] [data-f="sku"]').evaluateAll(els => els.map(e => e.value));

  test('rows are arranged colour → size, XS → 2XL', async ({ page }) => {
    await expect.poll(() => skuValues(page)).toEqual(['E2E-G-BLK-S', 'E2E-G-BLK-M', 'E2E-G-BLK-XL']);
  });

  test('a new row saves itself once complete; ✕ deletes it for real', async ({ page }) => {
    await page.locator('[data-testid="variant-add"]').click();
    const row = page.locator('[data-testid="variant-row"]').last();
    await row.locator('[data-f="attr:color"]').fill('Black');
    await row.locator('[data-f="attr:color"]').press('Tab');
    await row.locator('[data-f="attr:size"]').fill('L');
    await row.locator('[data-f="attr:size"]').press('Tab');
    await row.locator('[data-f="sku"]').fill('E2E-G-BLK-L');
    await row.locator('[data-f="sku"]').press('Tab');
    await expect.poll(async () => (await q('SELECT count(*)::int AS n FROM product_variants WHERE sku = $1', ['E2E-G-BLK-L']))[0].n).toBe(1);
    // It joins the arranged order: S, M, L, XL.
    await expect.poll(() => skuValues(page)).toEqual(['E2E-G-BLK-S', 'E2E-G-BLK-M', 'E2E-G-BLK-L', 'E2E-G-BLK-XL']);

    page.once('dialog', d => d.accept());
    await page.locator('[data-testid="variant-row"]:has([value="E2E-G-BLK-L"]) [data-testid="variant-del"]').click();
    await expect(page.locator('[data-testid="variant-row"]')).toHaveCount(3);
    await expect.poll(async () => (await q('SELECT count(*)::int AS n FROM product_variants WHERE sku = $1', ['E2E-G-BLK-L']))[0].n).toBe(0);
  });

  test('"+ Add a colour" plans every size and creates the rows from a paste', async ({ page }) => {
    await page.locator('[data-testid="variant-add-value"]').click();
    await page.locator('[data-testid="add-value-value"]').fill('Navy');
    await expect(page.locator('[data-testid="add-value-row"]')).toHaveCount(3);
    await page.locator('[data-testid="add-value-paste"]').fill('S\tE2E-G-NVY-S\nM\tE2E-G-NVY-M\nXL\tE2E-G-NVY-XL');
    await page.locator('[data-testid="add-value-create"]').click();
    await expect(page.locator('[data-testid="variant-row"]')).toHaveCount(6);
    const rows = await q(`SELECT sku FROM product_variants WHERE product_id = $1 AND sku LIKE 'E2E-G-NVY-%' ORDER BY sku`, [productId]);
    expect(rows.map(r => r.sku)).toEqual(['E2E-G-NVY-M', 'E2E-G-NVY-S', 'E2E-G-NVY-XL']);
  });

  test('clicking a header sorts, and a second header shows the click order', async ({ page }) => {
    await page.locator('[data-sortcol="sku"]').click();
    await expect.poll(() => skuValues(page)).toEqual(['E2E-G-BLK-M', 'E2E-G-BLK-S', 'E2E-G-BLK-XL']);
    await page.locator('[data-sortcol="attr:size"]').click();
    await expect(page.locator('[data-sortcol="sku"] .vsort-th__order')).toHaveText('1');
    await expect(page.locator('[data-sortcol="attr:size"] .vsort-th__order')).toHaveText('2');
  });
});
