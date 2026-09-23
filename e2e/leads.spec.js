// Leads inbox (migration 097, 2026-09-07) end to end: a visitor's
// /hafa-samband enquiry lands in /admin/leads, the sales user works it
// (status + first-touch stamp), cannot delete it (admin-only erasure), and
// the admin deletes it so re-runs start clean. The e2e server runs with
// NODE_ENV=test, so the contact form's 5/hour limiter is off.
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { TEST_ADMIN } = require('./helpers');
const { SALES_USER, seedSalesUser } = require('./lib/salesUser');
const { signInViaApi } = require('./lib/accounts');

test.describe('leads inbox', () => {
  // Built per ATTEMPT, not per module: attempt 0 leaves its lead behind when it
  // fails before the admin deletes it, and a retry that reuses the name then
  // matches two rows — the older one already contacted. The retry index makes
  // every attempt's lead its own.
  const leadFor = (retry) => {
    const stamp = `${Date.now()}-${retry}`;
    return {
      name:    `E2E Lead ${stamp}`,
      email:   `lead-${stamp}@e2e.test`,
      message: 'Við erum með Shopify og vantar bókhald sem talar við búðina. (e2e)',
    };
  };

  test.beforeAll(async () => { await seedSalesUser(); });

  test('visitor submits → sales user works it → admin erases it', async ({ page, browser }, testInfo) => {
    const LEAD = leadFor(testInfo.retry);
    // 1. A visitor (fresh, logged-out context) sends the enquiry.
    const visitor = await browser.newContext();
    const vpage = await visitor.newPage();
    await vpage.goto('/is/hafa-samband');
    await expect(vpage.locator('#contact-page-form')).toBeVisible();
    await vpage.fill('#contact-page-name', LEAD.name);
    await vpage.fill('#contact-page-email', LEAD.email);
    await vpage.fill('#contact-page-message', LEAD.message);
    await vpage.locator('#contact-page-submit').click();
    await expect(vpage.locator('#contact-page-status')).not.toHaveClass(/error/);
    await visitor.close();

    // 2. The sales user sees it as new. Signed in through the API, not the
    // modal: this flow is three people long, and two homepage loads plus two
    // modal logins were a third of its 30 s budget on CI (e2e/lib/accounts.js).
    await signInViaApi(page, SALES_USER);
    await page.goto('/#/admin/leads');
    await expect(page.locator('.admin-title')).toHaveText(/Fyrirspurnir/);
    const row = page.locator('tr.leads-row', { hasText: LEAD.name });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.leads-chip')).toHaveText('Ný');
    // The e2e server has no email transport, so the notification did not go
    // out — and the inbox says so (migration 108: notify_error on the row),
    // with the reason on hover.
    const mark = row.locator('[data-unsent]');
    await expect(mark).toHaveText('ekki sent');
    await expect(mark).toHaveAttribute('title', /email not configured/);

    // 3. Open it, read the message, mark contacted.
    await row.click();
    await expect(page.locator('.leads-detail__message')).toContainText('talar við búðina');
    await page.locator('.leads-detail [data-set-status="contacted"]').click();
    await expect(page.locator('tr.leads-row', { hasText: LEAD.name }).locator('.leads-chip')).toHaveText('Haft samband');

    // The API agrees, and the first touch is stamped with the sales user.
    const list = await page.request.get('/api/v1/admin/leads?status=contacted');
    expect(list.status()).toBe(200);
    const lead = (await list.json()).leads.find(l => l.email === LEAD.email);
    expect(lead).toBeTruthy();
    expect(lead.contacted_at).toBeTruthy();
    expect(lead.contacted_by_name).toBe('e2esales');

    // 4. Erasure is admin-only — the sales user is refused, in UI and API.
    await expect(page.locator('.leads-detail [data-delete]')).toHaveCount(0);
    const del = await page.request.delete(`/api/v1/admin/leads/${lead.id}`);
    expect(del.status()).toBe(403);

    // 5. The admin deletes it through the inbox so re-runs start clean.
    await page.context().clearCookies();
    await signInViaApi(page, TEST_ADMIN);
    await page.goto('/#/admin/leads');
    const adminRow = page.locator('tr.leads-row', { hasText: LEAD.name });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });
    await adminRow.click();
    page.once('dialog', d => d.accept());
    await page.locator('.leads-detail [data-delete]').click();
    await expect(page.locator('tr.leads-row', { hasText: LEAD.name })).toHaveCount(0);
  });

  test('the inbox API is closed to the public', async ({ request }) => {
    expect((await request.get('/api/v1/admin/leads')).status()).toBe(401);
  });
});
