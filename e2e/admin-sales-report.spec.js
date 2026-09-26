// The sales report and the "Í dag" attention cards in a browser (harvest 2
// lane 5; icelandicstore #414/#417/#419): the period picker prints its dates
// and is remembered, every KPI carries its change, the insights and marketing
// sections paint on their own requests, the attention cards link to lists
// filtered to exactly their count, nothing scrolls sideways on a phone, and
// each theme in the picker paints the delta pills from its own status tokens.
//
// A custom role with EXPLICIT grants: this product hides the shop views from
// an all-views admin (identity.surface.hiddenAdminViews), an explicit grant is
// always shown. Set L5_SHOT_DIR to also write screenshots (desktop + 375 px,
// every theme) for a review.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { seedUser, signInViaApi } = require('./lib/accounts');
const { identity } = require('./lib/identity');

const USER = { username: 'e2el5reports', email: 'l5-reports@e2e.test', password: 'L5Reports123' };
const ROLE = 'e2e-l5-reports';
const VIEWS = ['dashboard', 'sales', 'orders', 'inventory', 'users', 'feedback', 'customers', 'analytics'];
const THEMES = identity.theme.picker;
const SHOTS = process.env.L5_SHOT_DIR || null;

async function withDb(fn) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try { return await fn(pool); } finally { await pool.end(); }
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Let the route cross-fade finish, or the capture shows two pages at once.
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe('sales report + Í dag attention (harvest 2 lane 5)', () => {
  test.beforeAll(async () => {
    await seedUser(USER);
    await withDb(async (pool) => {
      await pool.query(
        `INSERT INTO roles (name, description, view_access, is_system) VALUES ($1, 'e2e lane 5', $2::jsonb, FALSE)
         ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`, [ROLE, JSON.stringify(VIEWS)]);
      await pool.query('UPDATE users SET role = $1, theme = NULL WHERE username = $2', [ROLE, USER.username]);
      await pool.query(`DELETE FROM orders WHERE order_number LIKE 'E2E-L5-%'`);
      await pool.query(`DELETE FROM products WHERE slug LIKE 'e2e-l5-%'`);
      const { rows: p } = await pool.query(
        `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, vat_rate)
         VALUES ('e2e-l5-mug', 'E2E Kaffibolli', '', 3990, 2800, 20, 'product', 24),
                ('e2e-l5-book', 'E2E Uppskriftabók', '', 5990, 4200, 0, 'product', 11)
         RETURNING id, slug`);
      const mug = p.find(r => r.slug === 'e2e-l5-mug').id;
      await pool.query(
        `INSERT INTO discounts (code, title, value_type, value) VALUES ('E2EHAUST', 'Haustútsala', 'percentage', 10)
         ON CONFLICT DO NOTHING`);
      // Paid orders this month and last month (the comparison), one of them
      // with the code and one still to fulfil.
      const orders = [
        ['E2E-L5-1', 7980, 1545, "now() - INTERVAL '2 hours'", 'unfulfilled', null, 'Anna Jónsdóttir', 'anna@e2e.test'],
        ['E2E-L5-2', 3591, 695, "now() - INTERVAL '1 day'", 'fulfilled', 'E2EHAUST', 'Bjarni Sig', 'bjarni@e2e.test'],
        ['E2E-L5-3', 11970, 2317, "now() - INTERVAL '33 days'", 'fulfilled', null, 'Anna Jónsdóttir', 'anna@e2e.test'],
        ['E2E-L5-4', 3990, 772, "now() - INTERVAL '140 days'", 'fulfilled', null, 'Dóra Dormant', 'dora@e2e.test'],
      ];
      for (const [no, total, vat, paid, ful, code, name, email] of orders) {
        const { rows } = await pool.query(
          `INSERT INTO orders (order_number, guest_email, guest_name, currency, subtotal, shipping, total, status,
              shipping_method, payment_status, fulfillment_status, paid_at, fulfilled_at, created_at, vat_total,
              discount_code, discount_amount)
           VALUES ($1, $2, $3, 'ISK', $4, 0, $4, 'paid', 'local_pickup', 'paid', $5, ${paid},
                   CASE WHEN $5 = 'fulfilled' THEN ${paid} + INTERVAL '5 hours' END, ${paid}, $6, $7, $8)
           RETURNING id`,
          [no, email, name, total, ful, vat, code, code ? 399 : 0]);
        await pool.query(
          `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_snapshot, quantity, currency, vat_rate)
           VALUES ($1, $2, 'E2E Kaffibolli', $3, 1, 'ISK', 24)`, [rows[0].id, mug, total]);
      }
      await pool.query(
        `INSERT INTO users (email, username, role, email_verified, approval_status, requested_at)
         VALUES ('l5-pending@e2e.test', 'e2el5pending', 'user', FALSE, 'pending', now())
         ON CONFLICT (username) DO UPDATE SET approval_status = 'pending'`);
      const { rows: b } = await pool.query(`INSERT INTO change_request_batches (item_count) VALUES (1) RETURNING id`);
      await pool.query(
        `INSERT INTO change_requests (batch_id, page_url, note) VALUES ($1, '/admin', 'E2E lane 5: sýna VSK í yfirliti')`, [b[0].id]);
      for (const [tok, host] of [['l5a', 'www.google.is'], ['l5b', null], ['l5c', 'l.facebook.com'], ['l5d', 'mbl.is']]) {
        await pool.query(
          `INSERT INTO page_views (path, referrer_host, device, visitor_token) VALUES ('/', $1, 'desktop', $2)`, [host, tok]);
      }
    });
  });

  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, USER);
  });

  test('the report: dates, deltas, net headline, insights and marketing; the preset is remembered', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/sales');
    await expect(page.locator('#sales-dates')).not.toBeEmpty();
    await expect(page.locator('.sales-card--headline')).toBeVisible();
    await expect(page.locator('.sales-card--headline .sales-delta')).toBeVisible();
    await expect(page.locator('[data-insight="fulfilment"] .sales-insight__value')).toBeVisible();
    await expect(page.locator('[data-insight="dormant"]')).toBeVisible();
    await expect(page.locator('[data-marketing="traffic"] .sales-channel')).toHaveCount(5);
    await expect(page.locator('[data-marketing="campaigns"] code', { hasText: 'E2EHAUST' })).toBeVisible();
    // The chart canvas is drawn (Chart.js loaded lazily).
    await expect(page.locator('#sales-chart')).toBeVisible();

    // The choice is remembered once its report is accepted (a failed load puts
    // the picker back), so wait for that answer before reloading.
    const accepted = page.waitForResponse((r) => /\/api\/v1\/admin\/shop\/reports\?/.test(r.url()) && r.ok());
    await page.selectOption('#sales-preset', 'last90');
    await accepted;
    await expect(page.locator('#sales-preset')).toHaveValue('last90');
    await page.reload();
    await expect(page.locator('#sales-preset')).toHaveValue('last90');
    await page.selectOption('#sales-preset', 'thisMonth');
    await expect(page.locator('#sales-dates')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('Í dag: each attention card opens its list filtered to the same count', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const home = page.waitForResponse((r) => r.url().includes('/api/v1/admin/home'));
    await page.goto('/admin');
    const body = await (await home).json();
    const byKind = Object.fromEntries(body.todo.map((i) => [i.kind, i]));
    expect(byKind.out_of_stock.route).toBe('/admin/inventory?status=out');
    expect(byKind.signups_pending.route).toBe('/admin/users?status=pending');
    expect(byKind.change_requests_open.route).toBe('/admin/feedback?status=open');
    const ship = byKind.orders_to_ship;
    expect(ship.route).toBe('/admin/shop/orders?view=open');

    await page.locator('.idag-todo__item[data-kind="orders_to_ship"]').click();
    await expect(page).toHaveURL(/\/admin\/shop\/orders\?view=open$/);
    await expect(page.locator('#admin-orders-filter')).toHaveValue('view:open');
    await expect(page.locator('.admin-shop__table tbody tr')).toHaveCount(ship.count);
  });

  test('a 375 px phone: the report does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/sales');
    await expect(page.locator('.sales-card--headline')).toBeVisible();
    await expect(page.locator('[data-marketing="traffic"]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of THEMES) {
    test(`the ${theme} theme paints the deltas from its status tokens`, async ({ page }) => {
      await withDb((pool) => pool.query('UPDATE users SET theme = $1 WHERE username = $2', [theme, USER.username]));
      await page.addInitScript((t) => localStorage.setItem('ws_theme', t), theme);
      for (const [w, h, tag] of [[1440, 1000, 'desktop'], [375, 812, '375']]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/admin/sales');
        await expect(page.locator('[data-marketing="campaigns"]')).toBeVisible();
        await expect(page.locator('[data-insight="dormant"]')).toBeVisible();
        const probe = await page.evaluate(() => {
          const p = document.createElement('span');
          p.style.color = 'var(--success)';
          p.style.borderTopColor = 'var(--error)';
          document.body.appendChild(p);
          const cs = getComputedStyle(p);
          const out = { up: cs.color, down: cs.borderTopColor };
          p.remove();
          return out;
        });
        const up = page.locator('.sales-delta--up').first();
        if (await up.count()) expect(await up.evaluate((el) => getComputedStyle(el).color)).toBe(probe.up);
        const down = page.locator('.sales-delta--down').first();
        if (await down.count()) expect(await down.evaluate((el) => getComputedStyle(el).color)).toBe(probe.down);
        await shot(page, `sales-${theme}-${tag}`);
        await page.goto('/admin');
        await expect(page.locator('.idag-todo__item[data-kind="out_of_stock"]')).toBeVisible();
        await shot(page, `idag-${theme}-${tag}`);
      }
      await withDb((pool) => pool.query('UPDATE users SET theme = NULL WHERE username = $1', [USER.username]));
    });
  }
});
