// The basket's sold-out guard and the shop search box (harvested from
// icelandicstore #244 / #350 — harvest-ice-c-2026-09-24; ENHANCEMENTS #25).
//   • a stale basket line (added while the product was still in stock) is
//     flagged in the cart and blocks checkout until it is fixed — before this,
//     a sold-out line went straight to Stripe;
//   • the checkout page repeats the gate (the last one before Stripe);
//   • the shop search keeps every typed letter (the debounce used to repaint
//     the filter bar and drop the rest of the word).
// The shop is a HIDDEN surface on orangesmiley.is — hidden, not switched off,
// so its routes still work and this runs against them.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');

const SOLD = { slug: 'e2e-sold-out-mug', name: 'E2E Sold Out Mug', sku: 'E2E-SOLD-1' };
const FEW  = { slug: 'e2e-few-left-mug', name: 'E2E Few Left Mug', sku: 'E2E-FEW-1' };
let ids = {};

test.describe('Basket availability', () => {
  test.beforeAll(async () => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query('DELETE FROM products WHERE slug = ANY($1)', [[SOLD.slug, FEW.slug]]);
      for (const [p, stock] of [[SOLD, 0], [FEW, 2]]) {
        const { rows } = await pool.query(
          `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, sku, active)
           VALUES ($1, $2, '', 990, 700, $3, 'product', $4, TRUE) RETURNING id`,
          [p.slug, p.name, stock, p.sku]
        );
        ids[p.slug] = rows[0].id;
      }
    } finally { await pool.end(); }
  });

  test.afterAll(async () => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try { await pool.query('DELETE FROM products WHERE slug = ANY($1)', [[SOLD.slug, FEW.slug]]); }
    finally { await pool.end(); }
  });

  const plant = async (page, lines) => {
    await page.goto('/is/cart');
    await page.evaluate((items) => {
      localStorage.setItem('shop.cart.items::guest', JSON.stringify(items));
    }, lines);
    await page.reload();
  };
  const line = (p, qty) => ({
    productId: ids[p.slug], variantId: null, variantAttributes: null, variantLabel: null,
    slug: p.slug, name: p.name, priceIsk: 990, priceEur: 700, qty, imageUrl: null,
  });

  test('a sold-out line and an over-quantity line are flagged, and checkout is blocked until fixed', async ({ page }) => {
    await plant(page, [line(SOLD, 1), line(FEW, 5)]);
    const rows = page.locator('.shop-cart__row');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-testid="cart-stock-notice"]')).toBeVisible();
    await expect(page.locator('[data-testid="cart-short"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="cart-checkout"]')).toBeDisabled();

    // The checkout page is the last gate before Stripe.
    await page.goto('/is/checkout');
    await expect(page.locator('[data-testid="checkout-stock-notice"]')).toBeVisible();
    await expect(page.locator('[data-testid="checkout-submit"]')).toBeDisabled();

    // Removing the sold-out line and lowering the other clears the block.
    await page.goto('/is/cart');
    await page.locator('.shop-cart__row', { hasText: SOLD.name }).locator('.shop-cart__remove').click();
    const qty = page.locator('.shop-cart__row', { hasText: FEW.name }).locator('.shop-cart__qty');
    await qty.fill('2');
    await qty.dispatchEvent('change');
    await page.reload();
    await expect(page.locator('[data-testid="cart-stock-notice"]')).toHaveCount(0);
    await expect(page.locator('a[data-testid="cart-checkout"]')).toBeVisible();
  });

  // Harvest 2 lane 4b (ice #343 / #51 / #399): a stale basket price is replaced
  // by the catalogue's and the page says so; the VAT inside the total is shown
  // per rate, zero-rated when the order ships abroad; an Icelandic postcode
  // must be three digits.
  test('a stale price is re-priced and announced; VAT per rate; export is 0 %; the IS postcode rule', async ({ page }) => {
    // An 11 % product: the rate must reach the page through the public
    // catalogue payload (it once did not — Product.publicCols lacked vat_rate).
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try { await pool.query('UPDATE products SET vat_rate = 11 WHERE slug = $1', [FEW.slug]); }
    finally { await pool.end(); }

    await plant(page, [{ ...line(FEW, 1), priceIsk: 500 }]);
    await expect(page.locator('[data-testid="cart-repriced"]')).toBeVisible();
    await expect(page.locator('.shop-cart__cell--line')).toHaveText('990 kr.');
    // 990 × 11/111 = 98.1 → 98 (server/utils/vat.js splitVatInclusive).
    await expect(page.locator('[data-testid="cart-vat-11"]')).toContainText('98 kr.');
    await expect(page.locator('[data-testid="cart-vat-24"]')).toHaveCount(0);

    await page.goto('/is/checkout');
    // Flat-rate shipping (2.500 kr.) is 24 %: 2500 × 24/124 = 483.9 → 484.
    await expect(page.locator('[data-testid="checkout-vat-11"]')).toContainText('98 kr.');
    await expect(page.locator('[data-testid="checkout-vat-24"]')).toContainText('484 kr.');
    await page.selectOption('select[name="country"]', 'DK');
    await expect(page.locator('[data-testid="checkout-vat-0"]')).toContainText('0 kr.');
    await expect(page.locator('[data-testid="checkout-vat-export"]')).toBeVisible();

    await page.selectOption('select[name="country"]', 'IS');
    await page.fill('input[name="guest_email"]', 'e2e-vat@example.com');
    await page.fill('input[name="guest_name"]', 'E2E Vat');
    await page.fill('input[name="name"]', 'E2E Vat');
    await page.fill('input[name="line1"]', 'Gata 1');
    await page.fill('input[name="city"]', 'Reykjavík');
    await page.fill('input[name="postal"]', '1');
    await page.locator('[data-testid="checkout-submit"]').click();
    // reportValidity() stopped the submit at the postcode; the page stays put.
    expect(await page.locator('input[name="postal"]').evaluate(el => el.validity.valid)).toBe(false);
    await expect(page).toHaveURL(/\/is\/checkout/);
  });

  test('the shop search box keeps every typed character', async ({ page }) => {
    // The /shop landing has no search; a section page carries the filter bar.
    await page.goto('/is/shop/products');
    const q = page.locator('#shop-filters-q');
    await q.click();
    await q.pressSequentially('e2', { delay: 50 });
    // The clear button appearing proves the debounce has fired.
    await expect(page.locator('#shop-filters-clear-q')).toBeVisible();
    await page.keyboard.type('e few', { delay: 50 });
    await expect(q).toHaveValue('e2e few');
    await expect(q).toBeFocused();
  });
});
