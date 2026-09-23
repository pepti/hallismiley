// Markaður — the prospect list (ENHANCEMENTS #16, 2026-09-07). Seeds one
// shortlisted company with two fiscal years straight into the ISOLATED e2e
// database (e2e/lib/dbUrl), then: the admin finds it, filters, opens the
// drawer (years + the report path as TEXT, never a link), hands it to sales,
// and the sales user — who is NOT granted `markadur` (Halli grants that by
// hand in /admin/roles) — is bounced and 403'd. If Halli grants the view to
// `solufolk`, the last test flips: adjust it then, not before.
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');
const { seedSalesUser, loginAsSales } = require('./lib/salesUser');

const KT = '9900000099';
const NAME = 'Stuttlisti prufa ehf. (e2e)';

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('markaður', () => {
  test.beforeAll(async () => {
    await seedSalesUser();
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      const { rows: [c] } = await pool.query(
        `INSERT INTO market_companies
           (kennitala, name, sector_group, list_type, platform_detected, fit_score, tier_fit,
            status, summary, fit_notes, sources, report_path)
         VALUES ($1, $2, 'smasala', 'smb', 'shopify', 88, 'verslun', 'shortlist',
                 'Lítil búð með vefverslun (e2e).', 'Hár stjórnunarkostnaður.',
                 '[{"type":"arsreikningaskra","url":"https://example.invalid/a","fetched_at":"2026-09-01T00:00:00Z"}]'::jsonb,
                 'company/markadur/arsreikningar/9900000099-2024.pdf')
         ON CONFLICT (kennitala) DO UPDATE SET status = 'shortlist', name = EXCLUDED.name
         RETURNING id`,
        [KT, NAME]
      );
      for (const [year, rev, adm, emp] of [[2023, 80_000_000, 10_000_000, 6], [2024, 100_000_000, 10_000_000, 7]]) {
        await pool.query(
          `INSERT INTO market_financials (company_id, fiscal_year, revenue_isk, admin_cost_isk, employees)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (company_id, fiscal_year) DO UPDATE
             SET revenue_isk = EXCLUDED.revenue_isk, admin_cost_isk = EXCLUDED.admin_cost_isk`,
          [c.id, year, rev, adm, emp]
        );
      }
    } finally {
      await pool.end();
    }
  });

  test('admin lists, filters, opens the drawer and hands the company to sales', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/admin/markadur');
    await expect(page.locator('.admin-title')).toHaveText(/Markaður/);

    await page.fill('#markadur-q', KT);
    const row = page.locator('tr.markadur-row', { hasText: NAME });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.markadur-chip')).toHaveText('Stuttlisti');
    await expect(row).toContainText('10.0 %');

    // The list filter keeps it (smb) and drops it (large).
    await page.selectOption('[data-filter="list_type"]', 'smb');
    await expect(page.locator('tr.markadur-row', { hasText: NAME })).toHaveCount(1);
    await page.selectOption('[data-filter="list_type"]', 'large');
    await expect(page.locator('tr.markadur-row', { hasText: NAME })).toHaveCount(0);
    await page.selectOption('[data-filter="list_type"]', '');
    await expect(page.locator('tr.markadur-row', { hasText: NAME })).toHaveCount(1);

    // Drawer: two years, the report path as text with no anchor.
    await page.locator('tr.markadur-row', { hasText: NAME }).click();
    const drawer = page.locator('.markadur-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.markadur-years tbody tr')).toHaveCount(2);
    await expect(drawer.locator('.markadur-drawer__report code')).toHaveText(/9900000099-2024\.pdf/);
    await expect(drawer.locator('.markadur-drawer__report a')).toHaveCount(0);

    // Hand to sales (confirm dialog) → chip flips, buttons disable, API agrees.
    page.once('dialog', d => d.accept());
    await drawer.locator('[data-set-status="handed_to_sales"]').click();
    await expect(drawer.locator('.markadur-chip')).toHaveText('Afhent sölu');
    await expect(drawer.locator('[data-set-status="handed_to_sales"]')).toBeDisabled();
    await expect(drawer.locator('[data-set-status="rejected"]')).toBeDisabled();
    const id = await page.locator('tr.markadur-row', { hasText: NAME }).getAttribute('data-id');
    const res = await page.request.get(`/api/v1/admin/markadur/${id}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).company.status).toBe('handed_to_sales');

    // Escape closes the drawer.
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('the sales user is bounced from the screen and 403d by the API', async ({ page }) => {
    await loginAsSales(page);
    await page.goto('/#/admin/markadur');
    await page.waitForFunction(() => !window.location.href.includes('/admin/markadur'));
    const res = await page.request.get('/api/v1/admin/markadur');
    expect(res.status()).toBe(403);
  });
});
