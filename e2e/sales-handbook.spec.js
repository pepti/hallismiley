// Handbók sölufólks — the sales-staff handbook (chunk 2 of the sales-staff
// program, 2026-08-27). Verifies the RBAC promise end-to-end: a `solufolk`
// user logs in, is forwarded from /admin to the handbook, sees ONLY the
// Handbók sidebar item, reads a published guide — and is bounced (UI) and
// 403'd (API) everywhere else in the admin area.
//
// Seeds its fixtures straight into the ISOLATED e2e database (e2e/lib/dbUrl):
// a published guide and a sales user (role seeded by migration 090).
const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');

const SALES_USER = {
  username: 'e2esales',
  email:    'sales@e2e.test',
  password: 'SalesPass123',
};

const GUIDE = {
  slug:    'solusagan-e2e',
  title:   'Sölusagan (e2e)',
  summary: 'Hvernig við kynnum Rekstrarkerfið.',
  body:    '<h2>Eitt kerfi</h2><p>Ein áskrift, allt kerfið.</p>',
};

async function loginAsSales(page) {
  await page.goto('/');
  if (await page.locator('[data-testid="nav-user-btn"]').isVisible()) return;
  await page.locator('[data-testid="nav-signin"]').click();
  await page.fill('#login-username', SALES_USER.username);
  await page.fill('#login-password', SALES_USER.password);
  await page.click('.login-form [type=submit]');
  await page.waitForSelector('[data-testid="nav-user-btn"]', { timeout: 10_000 });
}

test.describe('sales handbook (solufolk)', () => {
  test.beforeAll(async () => {
    // Idempotent upserts — global-setup's migrate has already run, so the
    // sales_guides table and the seeded solufolk role exist.
    const { Scrypt } = require('oslo/password');
    const hash = await new Scrypt().hash(SALES_USER.password);
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query(
        `INSERT INTO users (email, username, password_hash, role, email_verified)
         VALUES ($1, $2, $3, 'solufolk', TRUE)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, role = 'solufolk'`,
        [SALES_USER.email, SALES_USER.username, hash]
      );
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

  test('sales user lands on the handbook with a one-item sidebar and reads a guide', async ({ page }) => {
    await loginAsSales(page);

    // /admin forwards a dashboard-less user to their first visible view.
    await page.goto('/#/admin');
    await page.waitForURL('**/admin/handbok', { timeout: 10_000 });
    await expect(page.locator('.admin-title')).toHaveText(/Handbók sölufólks/);

    // Sidebar reconciliation: exactly the Handbók item, none of the rest.
    const items = page.locator('.admin-sidebar a.admin-sidebar__item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Handbók');

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

  test('sales user sees no editor affordances', async ({ page }) => {
    await loginAsSales(page);
    await page.goto('/#/admin/handbok');
    await expect(page.locator('.admin-handbok__card', { hasText: GUIDE.title })).toBeVisible();
    await expect(page.locator('#handbok-new')).toHaveCount(0);
    await expect(page.locator('[data-edit]')).toHaveCount(0);
  });
});
