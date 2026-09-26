// "Í dag" — the admin home at /admin (AdminView.js over GET /api/v1/admin/home;
// D-020 step 4, 2026-09-26). The page renders the blocks the server sent for
// the signed-in admin, fits a 390px phone without sideways scroll, and paints
// from the tokens under every theme this product's picker offers.
//
// Its own admin account (e2e/lib/accounts.js): the theme cases write
// users.theme, which no other worker may share.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { seedAdminUser, signInViaApi } = require('./lib/accounts');
const { identity } = require('./lib/identity');
const { tClient } = require('./lib/locale');

const ADMIN = { username: 'e2eidagadmin', email: 'idag-admin@e2e.test', password: 'IdagAdmin123' };
// The home follows the sidebar: an all-views holder does not get the views
// this product hides (identity.surface.hiddenAdminViews).
const HIDDEN = new Set(identity.surface.hiddenAdminViews || []);
const THEMES = identity.theme.picker;

async function withDb(fn) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try { return await fn(pool); } finally { await pool.end(); }
}

test.describe('admin home — Í dag', () => {
  test.beforeAll(async () => {
    await seedAdminUser(ADMIN);
    await withDb(async (pool) => {
      const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [ADMIN.username]);
      const adminId = rows[0].id;
      // An overdue invoice (Bíður þín + Staðan) and a new enquiry. Additive,
      // named for this spec, safe to re-run.
      await pool.query(
        `INSERT INTO invoices (series, invoice_number, seller_name, seller_kennitala, seller_vat_number,
            customer_name, issued_at, due_at, subtotal_net, vat_total, total_gross, status, created_by)
         VALUES ('invoice', 990426, 'Seljandi ehf.', '1203894599', '148820', 'E2E Í dag ehf.',
                 now() - INTERVAL '50 days', now() - INTERVAL '35 days', 10000, 2400, 12400, 'issued', $1)
         ON CONFLICT DO NOTHING`, [adminId]);
      await pool.query(
        `INSERT INTO leads (submission_id, name, email, message, status)
         SELECT gen_random_uuid(), 'E2E Í dag', 'idag-lead@e2e.test', 'Kaffi fyrir 14 herbergi', 'new'
          WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'idag-lead@e2e.test')`);
      await pool.query('UPDATE users SET theme = NULL, totp_enabled = FALSE WHERE id = $1', [adminId]);
    });
  });

  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, ADMIN);
  });

  test('renders the blocks the server sent for the admin', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const homeResponse = page.waitForResponse((r) => r.url().includes('/api/v1/admin/home'));
    await page.goto('/admin');
    const body = await (await homeResponse).json();

    await expect(page.locator('.idag .admin-title')).toHaveText(tClient('adminHome.title'));
    await expect(page.locator('.idag-head__when time')).toBeVisible();
    // The skeleton is gone once the answer is painted.
    await expect(page.locator('.idag .admin-skeleton__bar')).toHaveCount(0);

    // Every to-do kind the server sent is a row, in the server's order.
    const kinds = await page.locator('.idag-todo__item').evaluateAll((els) => els.map((e) => e.dataset.kind));
    expect(kinds).toEqual(body.todo.map((i) => i.kind));
    if (!HIDDEN.has('ar')) {
      await expect(page.locator('.idag-todo__item[data-kind="invoices_overdue"]')).toBeVisible();
      await expect(page.locator('.idag-todo__item--warn .idag-todo__tag')).toHaveText(tClient('adminHome.waiting.tag.overdue'));
      await expect(page.locator('.idag-fig[data-fig="ar"]')).toBeVisible();
      // Bar shares ride the CSSOM (CSP: no style="" in the markup the view writes).
      const grow = await page.locator('.idag-aging__seg--later').evaluate((el) => el.style.flexGrow);
      expect(Number(grow)).toBeGreaterThan(0);
    }
    if (!HIDDEN.has('leads')) {
      await expect(page.locator('.idag-todo__item[data-kind="leads_new"]')).toBeVisible();
      await expect(page.locator('.idag-feed__item[data-type="lead_received"]').first()).toBeVisible();
    }
    // Figures the server left out are not painted; the ones it sent are.
    for (const [key, fig] of [['salesToday', 'sales'], ['openOrders', 'orders'], ['receivables', 'ar'], ['vatNext', 'vat']]) {
      await expect(page.locator(`.idag-fig[data-fig="${fig}"]`)).toHaveCount(body.figures[key] ? 1 : 0);
    }
    // An unenrolled admin still has the two-step step ahead of them.
    if (body.setup) {
      await expect(page.locator('.idag-setup')).toBeVisible();
      await expect(page.locator('.idag-step[data-step="twoStep"]')).toBeVisible();
    }
    // The projects board is a Vefur sidebar line now.
    await expect(page.locator('.admin-sidebar a[data-route="/admin/projects"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a 390px phone: one column, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');
    await expect(page.locator('.idag-todo-card, .idag-setup').first()).toBeVisible();
    await expect(page.locator('.idag .admin-skeleton__bar')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Every block sits inside the viewport.
    const widest = await page.locator('.idag').evaluate((el) => Math.max(...[...el.querySelectorAll('*')].map((n) => n.getBoundingClientRect().right)));
    expect(widest).toBeLessThanOrEqual(390);
  });

  for (const theme of THEMES) {
    test(`paints from the tokens under the ${theme} theme`, async ({ page }) => {
      await withDb((pool) => pool.query('UPDATE users SET theme = $1 WHERE username = $2', [theme, ADMIN.username]));
      await page.addInitScript((t) => localStorage.setItem('ws_theme', t), theme);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/admin');
      await expect(page.locator('.idag-head__when time')).toBeVisible();
      const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(attr).toBe(theme === identity.theme.root ? null : theme);

      // The status line and the rail's rule resolve to THIS theme's tokens.
      const probe = await page.evaluate(() => {
        const p = document.createElement('span');
        p.style.color = 'var(--text-secondary)';
        p.style.borderTopColor = 'var(--gold)';
        document.body.appendChild(p);
        const cs = getComputedStyle(p);
        const out = { secondary: cs.color, gold: cs.borderTopColor };
        p.remove();
        return out;
      });
      const when = await page.locator('.idag-head__when').evaluate((el) => getComputedStyle(el).color);
      expect(when).toBe(probe.secondary);
      const tally = page.locator('.idag-tally');
      if (await tally.count()) {
        expect(await tally.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(probe.gold);
      }
      await withDb((pool) => pool.query('UPDATE users SET theme = NULL WHERE username = $1', [ADMIN.username]));
    });
  }
});
