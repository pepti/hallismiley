// @ts-check
// Admin layout preferences in a real browser (harvested from icelandicstore
// #401–#407 and #245, harvest-ice-b-2026-09-24): the page-width icon on the
// admin sidebar's Breyta row, saved per account and per page (users.page_widths,
// migration 111), "Nota á allar síður", the Mjúk hreyfing switch — and the
// centred error dialog every error toast opens.
//
// A per-spec admin, never the shared `testadmin`: widths are per-account state,
// and a failure half-way must not leave every later admin spec on Allur
// skjárinn (e2e/lib/accounts.js, point 1). The e2e database is reused between
// runs, so beforeEach puts the account back to its defaults.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { seedAdminUser, signInViaApi } = require('./lib/accounts');
const { clickAndExpectApi } = require('./helpers');

const ADMIN = { username: 'e2epagewidthadmin', email: 'page-width-admin@e2e.test', password: 'PageWidthAdmin123' };
const PUT = { method: 'PUT', path: '/api/v1/users/me/page-width' };

async function resetAccount() {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    await pool.query(
      `UPDATE users SET page_widths = '{}'::jsonb, aside_widths = '{}'::jsonb, page_width_motion = TRUE
        WHERE username = $1`, [ADMIN.username]);
  } finally {
    await pool.end();
  }
}

async function savedWidths() {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    const { rows } = await pool.query('SELECT page_widths FROM users WHERE username = $1', [ADMIN.username]);
    return rows[0]?.page_widths ?? null;
  } finally {
    await pool.end();
  }
}

async function pick(page, value) {
  await page.getByTestId('admin-page-width').click();
  await clickAndExpectApi(page, page.locator(`.admin-sidebar__width-pop [data-page-width="${value}"]`), PUT);
}

test.describe.configure({ mode: 'serial' });

test.describe('Admin page width', () => {
  test.use({ viewport: { width: 2200, height: 1100 } });

  test.beforeAll(async () => { await seedAdminUser(ADMIN); });
  test.beforeEach(async ({ page }) => {
    await resetAccount();
    await signInViaApi(page, ADMIN);
  });
  test.afterAll(async () => { await resetAccount(); });

  test('the sidebar icon sets one page\'s width, kept on the account and nowhere else', async ({ page }) => {
    await page.goto('/is/admin/users');
    const shell = page.locator('.admin-shell');
    const icon = page.getByTestId('admin-page-width');
    // Venjuleg (1280px) is every admin page's default.
    await expect(shell).not.toHaveClass(/admin-shell--(wide|full)/);
    await expect(icon).not.toHaveClass(/is-custom/);

    // Three widths, the default ticked and marked; Escape closes and refocuses.
    await icon.click();
    const pop = page.locator('.admin-sidebar__width-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('[data-page-width]')).toHaveCount(3);
    await expect(pop.locator('[data-page-width="normal"]')).toHaveAttribute('aria-checked', 'true');
    await expect(pop.locator('[data-page-width="normal"] .admin-sidebar__width-mark')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(icon).toBeFocused();

    await pick(page, 'full');
    await expect(shell).toHaveClass(/admin-shell--full/);
    await expect(icon).toHaveClass(/is-custom/);
    expect(await savedWidths()).toEqual({ '/admin/users': 'full' });
    const box = await shell.boundingBox();
    expect(box && box.width).toBeGreaterThan(1900);

    // Survives a reload (it rides on the session), and another page keeps its own.
    await page.reload();
    await expect(page.locator('.admin-shell')).toHaveClass(/admin-shell--full/);
    await page.goto('/is/admin/leads');
    await expect(page.locator('.admin-shell')).not.toHaveClass(/admin-shell--(wide|full)/);

    // Picking the default again clears the choice (no key saved).
    await page.goto('/is/admin/users');
    await pick(page, 'normal');
    await expect(page.locator('.admin-shell')).not.toHaveClass(/admin-shell--(wide|full)/);
    expect(await savedWidths()).toEqual({});
  });

  test('"Nota á allar síður" makes one width every admin page\'s; its undo clears it', async ({ page }) => {
    await page.goto('/is/admin/users');
    await pick(page, 'wide');
    await page.getByTestId('admin-page-width').click();
    await clickAndExpectApi(page, page.locator('.admin-sidebar__width-pop [data-page-width-all="set"]'), PUT);
    expect(await savedWidths()).toEqual({ '*': 'wide' });

    await page.goto('/is/admin/leads');
    await expect(page.locator('.admin-shell')).toHaveClass(/admin-shell--wide/);
    await page.getByTestId('admin-page-width').click();
    await clickAndExpectApi(page, page.locator('.admin-sidebar__width-pop [data-page-width-all="clear"]'), PUT);
    await expect(page.locator('.admin-shell')).not.toHaveClass(/admin-shell--(wide|full)/);
    expect(await savedWidths()).toEqual({});
  });

  test('Mjúk hreyfing is on by default and switches off per account', async ({ page }) => {
    await page.goto('/is/admin/users');
    const shell = page.locator('.admin-shell');
    await expect(shell).toHaveClass(/admin-shell--motion/);
    await page.getByTestId('admin-page-width').click();
    const motion = page.locator('.admin-sidebar__width-pop [data-page-width-motion]');
    await expect(motion).toHaveAttribute('aria-checked', 'true');
    await clickAndExpectApi(page, motion, { method: 'PUT', path: '/api/v1/users/me/page-width-motion' });
    await expect(motion).toHaveAttribute('aria-checked', 'false');
    await expect(shell).not.toHaveClass(/admin-shell--motion/);
    await page.reload();
    await expect(page.locator('.admin-shell')).not.toHaveClass(/admin-shell--motion/);
  });

  test('an error toast opens the centred error dialog; OK closes it', async ({ page }) => {
    await page.goto('/is/admin/users');
    await expect(page.locator('.admin-shell')).toBeVisible();
    await page.evaluate(async () => {
      const base = new URL('.', document.querySelector('script[type="module"][src$="/main.js"]').src).pathname;
      const { showToast } = await import(`${base}components/Toast.js`);
      showToast('Prófunarvilla', 'error');
      showToast('Prófunarvilla', 'error');   // an identical one collapses
      showToast('Önnur villa', 'error');     // a different one queues
    });
    const dialog = page.getByTestId('error-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alertdialog')).toContainText('Prófunarvilla');
    await expect(page.getByTestId('error-dialog-ok')).toBeFocused();
    await page.getByTestId('error-dialog-ok').click();
    await expect(page.getByRole('alertdialog')).toContainText('Önnur villa');
    await page.keyboard.press('Enter');
    await expect(page.locator('.error-dialog-overlay.open')).toHaveCount(0);
    // No red toast in the corner.
    await expect(page.locator('.toast--error')).toHaveCount(0);
  });
});
