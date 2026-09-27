// The stock screens (harvest2-lane6a-2026-09-26; ported from icelandicstore
// #13/#18/#23): Inventory Watch with "Fix stock", the stock count saved as one
// batch, and a goods receipt scanned in and finalised once. The screens are a
// HIDDEN retail surface on orangesmiley.is (identity.surface.hiddenAdminViews)
// — hidden, not switched off, so their routes work for an admin and this
// walks them. Stock is asserted in the database: the screens are the UI, the
// audited writer is the truth.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');

const P = [
  { slug: 'e2e-stock-mug', name: 'E2E Stock Mug', sku: 'E2E-STK-MUG', stock: 3 },
  { slug: 'e2e-stock-cap', name: 'E2E Stock Cap', sku: 'E2E-STK-CAP', stock: 0 },
];
const ids = {};
const pool = () => new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });

async function stockOf(slug) {
  const db = pool();
  try { return (await db.query('SELECT stock FROM products WHERE slug = $1', [slug])).rows[0].stock; }
  finally { await db.end(); }
}

test.describe('Stock screens', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = pool();
    try {
      await db.query(`DELETE FROM goods_receipts WHERE supplier_name = 'E2E Supplier'`);
      await db.query('DELETE FROM products WHERE slug = ANY($1)', [P.map(p => p.slug)]);
      for (const p of P) {
        const { rows } = await db.query(
          `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, sku, active)
           VALUES ($1, $2, '', 990, 700, $3, 'product', $4, TRUE) RETURNING id`,
          [p.slug, p.name, p.stock, p.sku]
        );
        ids[p.slug] = rows[0].id;
      }
    } finally { await db.end(); }
  });

  test.afterAll(async () => {
    const db = pool();
    try {
      await db.query(`DELETE FROM goods_receipts WHERE supplier_name = 'E2E Supplier'`);
      await db.query('DELETE FROM products WHERE slug = ANY($1)', [P.map(p => p.slug)]);
    } finally { await db.end(); }
  });

  test('Inventory Watch lists the unit, filters by a deep-linked status, and fixes stock', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/inventory?status=out');
    const row = page.locator('tr.stock-row', { hasText: 'E2E Stock Cap' });
    await expect(row).toBeVisible();
    await expect(row.locator('.stock-pill--out')).toBeVisible();
    await expect(page.locator('[data-chip="out"]')).toHaveAttribute('aria-pressed', 'true');
    // The mug (3 on hand, nothing sold) is OK, so not under ?status=out.
    await expect(page.locator('tr.stock-row', { hasText: 'E2E Stock Mug' })).toHaveCount(0);

    await row.locator('[data-fix]').click();
    const form = page.locator('[data-fix-form]');
    await form.locator('[data-fix-count]').fill('7');
    await form.locator('[data-fix-reason]').selectOption('recount');
    await form.locator('[data-fix-save]').click();
    await expect(page.locator('.toast').filter({ hasText: '7' }).first()).toBeVisible();
    await expect.poll(() => stockOf('e2e-stock-cap')).toBe(7);
  });

  test('the stock count builds a list by scan and saves it as one batch', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/stock-count');
    const scan = page.locator('.scan-box__input');
    await scan.fill('E2E-STK-MUG');
    await scan.press('Enter');
    const line = page.locator('tr[data-key]', { hasText: 'E2E Stock Mug' });
    await expect(line).toBeVisible();
    await line.locator('[data-qty]').fill('10');
    await line.locator('[data-qty]').press('Tab');
    await expect(line.locator('[data-new]')).toHaveText('10');
    await page.locator('[data-save]').click();
    await expect(page.locator('.admin-state')).toBeVisible();          // the list cleared
    await expect.poll(() => stockOf('e2e-stock-mug')).toBe(10);
  });

  test('a goods receipt: scan in, see it off the invoice, finalise once', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/receiving');
    await page.locator('#rcv-supplier').fill('E2E Supplier');
    await page.locator('#rcv-reference').fill('PO-E2E');
    await page.locator('form[data-new] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/receiving\/[^/]+$/);
    await page.locator('[data-per-scan]').fill('4');
    await page.locator('[data-per-scan]').dispatchEvent('change');
    const scan = page.locator('.scan-box__input');
    await scan.fill('E2E-STK-MUG');
    await scan.press('Enter');
    await expect(page.locator('.receiving-scans li', { hasText: 'E2E Stock Mug' })).toBeVisible();
    await expect(page.locator('input[data-extra]')).toBeChecked();

    page.once('dialog', d => d.accept());
    const before = await stockOf('e2e-stock-mug');
    await page.locator('[data-finalize]').click();
    await expect(page.locator('.stock-pill--rcv-finalized').first()).toBeVisible();
    await expect(page.locator('[data-finalize]')).toHaveCount(0);
    await expect.poll(() => stockOf('e2e-stock-mug')).toBe(before + 4);
  });
});
