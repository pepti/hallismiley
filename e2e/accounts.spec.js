// Customer accounts + commission (migration 098; ENHANCEMENTS #17/#18) end to
// end: the admin creates an account from the list, sets its fees, walks the
// lifecycle to "signed", issues the build-fee deposit invoice from the account
// page (lands on the invoice), and sees the commission on /admin/commission.
// The handbook-only sales user is bounced from the accounts screen and 403'd.
//
// Seeds the bookkeeping seller settings straight into the ISOLATED e2e
// database (e2e/lib/dbUrl) — an invoice without a seller kennitala/VSK number
// is refused by design.
const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { TEST_ADMIN } = require('./helpers');
const { seedSalesUser, loginAsSales } = require('./lib/salesUser');
const { signInViaApi } = require('./lib/accounts');

const STAMP = Date.now();
const NAME = `E2E Viðskiptavinur ${STAMP}`;
// customer_accounts.kennitala is UNIQUE and the e2e database survives between
// runs, so a hardcoded one passes in isolation and collides on the second run.
const KENNITALA = `99${String(STAMP).slice(-8)}`;

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('customer accounts', () => {
  test.beforeAll(async () => {
    await seedSalesUser();
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      for (const [key, value] of [
        ['books.seller_name', 'Orange Smiley ehf.'],
        ['books.seller_kennitala', '1203894599'],
        ['books.seller_vat_number', '162561'],
        ['books.payment_terms_days', 14],
      ]) {
        await pool.query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, JSON.stringify(value)]
        );
      }
    } finally {
      await pool.end();
    }
  });

  test('create → fees → signed → deposit invoice → commission', async ({ page }) => {
    // Through the API, not the modal: the homepage load + modal cost ~10 s of
    // this flow's 30 s budget on the CI runner (e2e/lib/accounts.js).
    await signInViaApi(page, TEST_ADMIN);
    await page.goto('/#/admin/accounts');
    await expect(page.locator('.admin-title')).toHaveText(/Viðskiptareikningar/);

    // Create from the overlay.
    await page.click('#accounts-new');
    await page.fill('#acct-create-form [name=name]', NAME);
    await page.selectOption('#acct-create-form [name=tier]', 'verslun');
    // The buyer party (migration 100). The kennitala is the statutory minimum
    // and the issue button stays disabled without it; the address is what makes
    // the invoice Peppol-exportable and what the PDF prints.
    await page.fill('#acct-create-form [name=kennitala]', KENNITALA);
    await page.fill('#acct-create-form [name=street]', 'Bæjargata 5');
    await page.fill('#acct-create-form [name=postal_zone]', '101');
    await page.fill('#acct-create-form [name=city]', 'Reykjavík');
    await page.click('#acct-create-form [type=submit]');
    await page.waitForURL(/\/admin\/accounts\/\d+/, { timeout: 10_000 });
    await expect(page.locator('.admin-title')).toHaveText(NAME);
    await expect(page.locator('.acct-status .acct-chip')).toHaveText('Fyrirspurn');

    // Fees, then save.
    await page.fill('#acct-form [name=build_fee_isk]', '580000');
    await page.fill('#acct-form [name=monthly_fee_isk]', '29000');
    await page.click('#acct-form [type=submit]');
    // Read the fee back from the SERVER, not from the input we just typed into:
    // asserting the field still holds what we filled passes even if the save
    // 500s, which is exactly the failure this line is here to catch. Through
    // the API rather than a reload — this SPA imports all 58 view modules
    // eagerly, and a second full load does not fit the 30 s test budget on CI.
    await expect(page.locator('.toast').first()).toContainText('Vistað');
    const acctId = page.url().match(/\/admin\/accounts\/(\d+)/)[1];
    const saved = await page.request.get(`/api/v1/admin/accounts/${acctId}`);
    expect(saved.status()).toBe(200);
    expect(Number((await saved.json()).account.monthly_fee_isk)).toBe(29000);

    // Lifecycle: lead → offered → signed (the buttons show the allowed steps).
    await page.click('.acct-actions [data-status="offered"]');
    await expect(page.locator('.acct-status .acct-chip')).toHaveText('Tilboð sent');
    await page.click('.acct-actions [data-status="signed"]');
    await expect(page.locator('.acct-status .acct-chip')).toHaveText('Undirritað');
    await expect(page.locator('#acct-provision')).toBeVisible();

    // Issue the 50% build deposit; the page moves to the invoice.
    page.once('dialog', d => d.accept());
    await page.selectOption('#acct-inv-kind', 'build-deposit');
    await page.click('#acct-invoice-form [type=submit]');
    await page.waitForURL(/\/admin\/books\/invoices\//, { timeout: 10_000 });

    // The invoice carries 290.000 net + 24% VSK.
    const api = await page.request.get('/api/v1/admin/accounts?q=' + encodeURIComponent(NAME));
    const { accounts } = await api.json();
    expect(accounts).toHaveLength(1);
    const events = await page.request.get(`/api/v1/admin/accounts/${accounts[0].id}/commission`);
    const { events: evs } = await events.json();
    expect(evs).toHaveLength(1);
    expect(Number(evs[0].base_amount_isk)).toBe(290000);
    expect(Number(evs[0].amount_isk)).toBe(43500);

    // The statement shows it (admin = owner here), unpaid.
    await page.goto('/#/admin/commission');
    await expect(page.locator('.admin-title')).toHaveText(/Sölulaun/);
    const row = page.locator('#commission-events tr', { hasText: NAME });
    await expect(row).toBeVisible();
    // Thousands separator depends on the browser's ICU (Playwright's Chromium
    // formats is-IS with a comma), so match either.
    await expect(row).toContainText(/43[.,]500 kr\./);
    await expect(row.locator('.acct-chip')).toHaveText('Ógreitt');

    // And the audit trail on the account has the whole story: created, the
    // fee update, two status moves, the commission.
    await page.goto(`/#/admin/accounts/${accounts[0].id}`);
    const trail = page.locator('#acct-audit li');
    await expect(trail.first()).toBeVisible();
    // Exactly five: created, the fee update, offered, signed, the commission.
    // `>= 5` also passed when a write was audited twice.
    await expect(trail).toHaveCount(5);
    await expect(page.locator('#acct-audit')).toContainText('Sölulaun skráð');
    await expect(page.locator('#acct-audit')).toContainText('Reikningur stofnaður');
    await expect(page.locator('#acct-audit')).toContainText('Staða breytt');
  });

  test('the handbook-only sales user is bounced and 403d', async ({ page }) => {
    await loginAsSales(page);
    await page.goto('/#/admin/accounts');
    await page.waitForFunction(() => !window.location.href.includes('/admin/accounts'));
    expect((await page.request.get('/api/v1/admin/accounts')).status()).toBe(403);
    expect((await page.request.get('/api/v1/admin/commission')).status()).toBe(403);
  });
});
