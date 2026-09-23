// Handbók sölufólks — the sales-staff handbook (chunk 2 of the sales-staff
// program, 2026-08-27). Verifies the RBAC promise end-to-end: a `solufolk`
// user logs in, is forwarded from /admin to the handbook, sees ONLY the
// Handbók sidebar item, reads a published guide — and is bounced (UI) and
// 403'd (API) everywhere else in the admin area.
//
// Seeds its fixtures straight into the ISOLATED e2e database (e2e/lib/dbUrl):
// a published guide and a sales user (role seeded by migration 090).
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');
// The sales user + login are shared with leads.spec.js (e2e/lib/salesUser.js).
const { seedSalesUser, loginAsSales } = require('./lib/salesUser');

const GUIDE = {
  slug:    'solusagan-e2e',
  title:   'Sölusagan (e2e)',
  summary: 'Hvernig við kynnum Rekstrarkerfið.',
  body:    '<h2>Eitt kerfi</h2><p>Ein áskrift, allt kerfið.</p>',
};

test.describe('sales handbook (solufolk)', () => {
  test.beforeAll(async () => {
    // Idempotent upserts — global-setup's migrate has already run, so the
    // sales_guides table and the seeded solufolk role exist.
    await seedSalesUser();
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query(
        `INSERT INTO sales_guides (slug, section, title, summary, body, sort_order, published, published_at)
         VALUES ($1, 'sala', $2, $3, $4, 0, TRUE, NOW())
         ON CONFLICT (slug) DO UPDATE
           SET title = EXCLUDED.title, summary = EXCLUDED.summary,
               body = EXCLUDED.body, published = TRUE`,
        [GUIDE.slug, GUIDE.title, GUIDE.summary, GUIDE.body]
      );
    } finally {
      await pool.end();
    }
  });

  test('sales user lands on the handbook with a two-item sidebar and reads a guide', async ({ page }) => {
    await loginAsSales(page);

    // /admin forwards a dashboard-less user to their first visible view.
    await page.goto('/#/admin');
    await page.waitForURL('**/admin/handbok', { timeout: 10_000 });
    await expect(page.locator('.admin-title')).toHaveText(/Handbók sölufólks/);

    // Sidebar reconciliation: exactly Handbók + Fyrirspurnir (the leads inbox,
    // migration 097), none of the rest.
    const items = page.locator('.admin-sidebar a.admin-sidebar__item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('Handbók');
    await expect(items.nth(1)).toContainText('Fyrirspurnir');

    // The seeded guide card is in the Sala section; open and read it.
    const card = page.locator('.admin-handbok__card', { hasText: GUIDE.title });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('.admin-handbok__body h2')).toHaveText('Eitt kerfi');
    await expect(page.locator('.admin-handbok__body p')).toContainText('Ein áskrift');
  });

  test('sales user is bounced from other admin routes and 403d by their APIs', async ({ page }) => {
    await loginAsSales(page);

    // Router guard bounces the deep link back to the locale root.
    await page.goto('/#/admin/customers');
    await page.waitForFunction(() => !window.location.href.includes('/admin/customers'));

    // Server-side enforcement (the layer that actually matters).
    const res = await page.request.get('/api/v1/admin/customers');
    expect(res.status()).toBe(403);
    const orders = await page.request.get('/api/v1/admin/shop/orders');
    expect(orders.status()).toBe(403);

    // But the handbook API answers.
    const guides = await page.request.get('/api/v1/admin/handbok');
    expect(guides.status()).toBe(200);
    expect((await guides.json()).guides.some(g => g.slug === GUIDE.slug)).toBe(true);
  });

  test('draft guides stay invisible to the sales user', async ({ page }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query(
        `INSERT INTO sales_guides (slug, section, title, body, published)
         VALUES ('drog-e2e', 'sala', 'Drög (e2e)', '<p>Ekki tilbúið.</p>', FALSE)
         ON CONFLICT (slug) DO UPDATE SET published = FALSE`
      );
    } finally {
      await pool.end();
    }

    await loginAsSales(page);
    await page.goto('/#/admin/handbok');
    await expect(page.locator('.admin-handbok__card', { hasText: GUIDE.title })).toBeVisible();
    await expect(page.locator('.admin-handbok__card', { hasText: 'Drög (e2e)' })).toHaveCount(0);

    const res = await page.request.get('/api/v1/admin/handbok/drog-e2e');
    expect(res.status()).toBe(404);
  });

  test('admin still reaches the handbook from the sidebar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/admin/handbok');
    await expect(page.locator('.admin-title')).toHaveText(/Handbók sölufólks/);
    await expect(page.locator('.admin-handbok__card', { hasText: GUIDE.title })).toBeVisible();
  });

  test('admin creates a draft in the editor, publishes it, then deletes it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/#/admin/handbok');

    // Create as draft.
    await page.click('#handbok-new');
    await page.fill('#handbok-editor-form [name=title]', 'Editor-próf (e2e)');
    await page.selectOption('#handbok-editor-form [name=section]', 'vara');
    await page.fill('#handbok-editor-form [name=body]', '<p>Prufutexti úr ritli.</p>');
    await page.click('#handbok-editor-form [type=submit]');
    const card = page.locator('.admin-handbok__card', { hasText: 'Editor-próf (e2e)' });
    await expect(card).toBeVisible();
    await expect(card.locator('.admin-handbok__draft-badge')).toBeVisible();

    // Publish via the edit overlay; the draft badge disappears.
    const wrap = page.locator('.admin-handbok__card-wrap', { hasText: 'Editor-próf (e2e)' });
    await wrap.locator('[data-edit]').click();
    await page.check('#handbok-editor-form [name=published]');
    await page.click('#handbok-editor-form [type=submit]');
    await expect(card).toBeVisible();
    await expect(card.locator('.admin-handbok__draft-badge')).toHaveCount(0);

    // Delete from the editor (admin only) so re-runs start clean.
    page.once('dialog', d => d.accept());
    await wrap.locator('[data-edit]').click();
    await page.click('#handbok-delete-btn');
    await expect(page.locator('.admin-handbok__card', { hasText: 'Editor-próf (e2e)' })).toHaveCount(0);
  });

  // Regression (2026-08-27): the reader called the published-only endpoint, so
  // an admin could see a draft card in the library and get "Guide not found"
  // on opening it — which is exactly the review-before-publish path.
  test('admin can OPEN a draft from the library and read it', async ({ page }) => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query(
        `INSERT INTO sales_guides (slug, section, title, body, published)
         VALUES ('drog-lestur-e2e', 'grunnur', 'Drög til lestrar (e2e)',
                 '<h2>Drög</h2><p>Þetta er óútgefinn texti.</p>', FALSE)
         ON CONFLICT (slug) DO UPDATE SET published = FALSE`
      );
    } finally {
      await pool.end();
    }

    await loginAsAdmin(page);
    await page.goto('/#/admin/handbok');
    await page.locator('.admin-handbok__card', { hasText: 'Drög til lestrar (e2e)' }).click();

    await expect(page.locator('.admin-handbok__body h2')).toHaveText('Drög');
    await expect(page.locator('.admin-handbok__body p')).toContainText('óútgefinn');
    await expect(page.locator('.admin-error')).toHaveCount(0);
    // The read page flags that this one is not published yet.
    await expect(page.locator('.admin-handbok__eyebrow .admin-handbok__draft-badge')).toBeVisible();
  });

  test('sales user still cannot open a draft by URL', async ({ page }) => {
    await loginAsSales(page);
    await page.goto('/#/admin/handbok/drog-lestur-e2e');
    await expect(page.locator('.admin-error')).toBeVisible();
    await expect(page.locator('.admin-handbok__body')).toHaveCount(0);
    const res = await page.request.get('/api/v1/admin/handbok/drog-lestur-e2e');
    expect(res.status()).toBe(404);
    const prev = await page.request.get('/api/v1/admin/handbok/drog-lestur-e2e/preview');
    expect(prev.status()).toBe(403);
  });

  test('sales user sees no editor affordances', async ({ page }) => {
    await loginAsSales(page);
    await page.goto('/#/admin/handbok');
    await expect(page.locator('.admin-handbok__card', { hasText: GUIDE.title })).toBeVisible();
    await expect(page.locator('#handbok-new')).toHaveCount(0);
    await expect(page.locator('[data-edit]')).toHaveCount(0);
  });
});
