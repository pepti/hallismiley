// Checkout settings in the storefront (harvest2-lane7a; ported from
// icelandicstore #151): the cart and the checkout SHOW the ordering pause and
// the minimum and disable checkout; the checkout renders only the fields the
// admin shows and prices delivery by the server's rule. UX only — the server
// gates (tests/integration/checkoutSettings.test.js).
//
// /api/v1/shop/config is STUBBED over the real answer (page.route): the e2e
// database is shared by four workers, and pausing the real shop would break
// every other shop spec running at the same time.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');

const SLUG = 'l7a-e2e-mug';
const LINE = {
  productId: null, // set in beforeAll
  variantId: null, variantAttributes: null, variantLabel: null,
  slug: 'l7a-e2e-mug', name: 'L7A E2E Mug', priceIsk: 2000, priceEur: 1400, qty: 1, imageUrl: null,
};

async function withConfig(page, checkout, shipping = {}) {
  await page.route('**/api/v1/shop/config', async (route) => {
    const res = await route.fetch();
    const cfg = await res.json();
    cfg.checkout = { ...cfg.checkout, ...checkout };
    cfg.shipping = { ...cfg.shipping, ...shipping };
    await route.fulfill({ response: res, json: cfg });
  });
}
async function plant(page, lines) {
  await page.goto('/is/cart');
  await page.evaluate((items) => localStorage.setItem('shop.cart.items::guest', JSON.stringify(items)), lines);
  await page.reload();
}

test.describe('Checkout settings in the storefront', () => {
  test.beforeAll(async () => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query('DELETE FROM products WHERE slug = $1', [SLUG]);
      const { rows } = await pool.query(
        `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, sku, active)
         VALUES ($1, 'L7A E2E Mug', '', 2000, 1400, 50, 'product', 'L7A-E2E-MUG', TRUE) RETURNING id`, [SLUG]);
      LINE.productId = rows[0].id;
    } finally { await pool.end(); }
  });
  test.afterAll(async () => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try { await pool.query('DELETE FROM products WHERE slug = $1', [SLUG]); } finally { await pool.end(); }
  });

  test('a paused shop says so and disables checkout, in the cart and at checkout', async ({ page }) => {
    await withConfig(page, { ordering_paused: true, ordering_paused_message: { is: 'Lokað vegna vörutalningar', en: '' } });
    await plant(page, [LINE]);
    await expect(page.locator('[data-testid="cart-paused"]')).toHaveText('Lokað vegna vörutalningar');
    await expect(page.locator('[data-testid="cart-checkout"]')).toBeDisabled();
    await page.goto('/is/checkout');
    await expect(page.locator('[data-testid="checkout-paused"]')).toHaveText('Lokað vegna vörutalningar');
    await expect(page.locator('[data-testid="checkout-submit"]')).toBeDisabled();
  });

  test('under the minimum: how much is missing, checkout disabled', async ({ page }) => {
    await withConfig(page, { ordering_paused: false, min_order_value_isk: 5000 });
    await plant(page, [LINE]);
    await expect(page.locator('[data-testid="cart-min-order"]')).toContainText('3.000');
    await expect(page.locator('[data-testid="cart-checkout"]')).toBeDisabled();
  });

  test('the checkout shows only the fields the admin shows, and free delivery over the threshold', async ({ page }) => {
    await withConfig(page,
      { ordering_paused: false, min_order_value_isk: 0, fields: { phone: 'hidden', company: 'required', kennitala: 'optional', note: 'hidden' } },
      { flat_rate: { priceIsk: 1500, priceEur: 1100 }, free_over_isk: 4000 });
    await plant(page, [{ ...LINE, qty: 1 }]);
    await page.goto('/is/checkout');
    await expect(page.locator('input[name="phone"]')).toHaveCount(0);
    await expect(page.locator('textarea[name="note"]')).toHaveCount(0);
    await expect(page.locator('input[name="company"]')).toHaveAttribute('required', '');
    await expect(page.locator('input[name="kennitala"]')).not.toHaveAttribute('required', '');
    await expect(page.locator('[data-testid="checkout-flat-rate"]')).toContainText('1.500');
    await plant(page, [{ ...LINE, qty: 2 }]); // 4000 kr. — the threshold itself is free
    await page.goto('/is/checkout');
    await expect(page.locator('[data-testid="checkout-flat-rate"]')).not.toContainText('1.500');
  });
});
