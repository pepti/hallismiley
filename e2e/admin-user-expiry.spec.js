// Time-limited logins in the admin UI (login-expiry-2026-09-26, migration 114).
//
// The Users list's "Gildir til" column: the badge a login with an expiry
// carries, the modal that sets 7 / 14 / 30 days, a date or none — and, from
// the other side, the sign-in modal telling an expired login why it cannot
// get in. The server rules (every sign-in path, the session check, the API
// validation) are proved in tests/integration/loginExpiry.test.js.
const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin, openSignIn } = require('./helpers');
const { seedUser } = require('./lib/accounts');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { PUBLIC_DEFAULT_LOCALE, tClient } = require('../tests/lib/locale');

test.use({ viewport: { width: 1400, height: 900 } });

const LIVE    = { username: 'e2eexpirylive', email: 'expiry-live@e2e.test', password: 'ExpiryPass123' };
const EXPIRED = { username: 'e2eexpiryold', email: 'expiry-old@e2e.test', password: 'ExpiryPass123' };
const DAY = 24 * 60 * 60 * 1000;

async function sql(text, params) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try { return (await pool.query(text, params)).rows; } finally { await pool.end(); }
}

const row = (page, username) =>
  page.locator('.admin-users-table tbody tr').filter({ has: page.locator('.user-username', { hasText: new RegExp(`^${username}$`) }) });

test.describe('admin users — Gildir til', () => {
  test.beforeEach(async () => {
    await seedUser(LIVE);
    await seedUser(EXPIRED);
    await sql('UPDATE users SET expires_at = NULL, failed_login_attempts = 0, locked_until = NULL WHERE username = $1', [LIVE.username]);
    await sql(`UPDATE users SET expires_at = NOW() - INTERVAL '1 hour', failed_login_attempts = 0, locked_until = NULL
                WHERE username = $1`, [EXPIRED.username]);
  });

  test('set 7 days → the badge counts down; clear → no badge', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/${PUBLIC_DEFAULT_LOCALE}/admin/users?q=${LIVE.username}`);
    const r = row(page, LIVE.username);
    await expect(r).toBeVisible();
    await expect(r.locator('.users-expiry-badge')).toHaveCount(0);

    await r.locator('.expiry-user-btn').click();
    const modal = page.locator('.users-expiry-modal');
    await expect(modal).toBeVisible();
    await modal.locator('input[name="users-expiry-choice"][value="7"]').check();
    await modal.locator('button[type=submit]').click();
    await expect(modal).toHaveCount(0);

    const badge = row(page, LIVE.username).locator('.users-expiry-badge');
    await expect(badge).toHaveText(tClient('adminUsers.expiresIn.many', { n: 7 }));
    await expect(badge).toHaveAttribute('data-expiry-state', 'active');
    const [{ expires_at: at }] = await sql('SELECT expires_at FROM users WHERE username = $1', [LIVE.username]);
    expect(Math.abs(new Date(at).getTime() - (Date.now() + 7 * DAY))).toBeLessThan(5 * 60 * 1000);

    // The modal reopens on the saved date; "none" clears it.
    await row(page, LIVE.username).locator('.expiry-user-btn').click();
    await expect(modal.locator('input[name="users-expiry-choice"][value="date"]')).toBeChecked();
    await modal.locator('input[name="users-expiry-choice"][value="none"]').check();
    await modal.locator('button[type=submit]').click();
    await expect(modal).toHaveCount(0);
    await expect(row(page, LIVE.username).locator('.users-expiry-badge')).toHaveCount(0);
    const [{ expires_at: cleared }] = await sql('SELECT expires_at FROM users WHERE username = $1', [LIVE.username]);
    expect(cleared).toBeNull();
  });

  test('an expired login shows the "útrunninn" badge', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/${PUBLIC_DEFAULT_LOCALE}/admin/users?q=${EXPIRED.username}`);
    const badge = row(page, EXPIRED.username).locator('.users-expiry-badge');
    await expect(badge).toHaveText(tClient('adminUsers.expired'));
    await expect(badge).toHaveAttribute('data-expiry-state', 'expired');
  });

  test('the admin gets no expiry button on their own row', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/${PUBLIC_DEFAULT_LOCALE}/admin/users?q=testadmin`);
    const own = row(page, 'testadmin');
    await expect(own).toBeVisible();
    await expect(own.locator('.expiry-user-btn')).toHaveCount(0);
  });
});

test.describe('sign-in with an expired login', () => {
  test.beforeEach(async () => {
    await seedUser(EXPIRED);
    await sql(`UPDATE users SET expires_at = NOW() - INTERVAL '1 hour', failed_login_attempts = 0, locked_until = NULL
                WHERE username = $1`, [EXPIRED.username]);
  });

  test('the modal says the login has expired — only with the right password', async ({ page }) => {
    await page.goto(`/${PUBLIC_DEFAULT_LOCALE}/`);
    await openSignIn(page);
    const error = page.locator('[data-testid="login-form"] .form-error');

    await page.fill('#login-username', EXPIRED.username);
    await page.fill('#login-password', 'wrong-password');
    await page.locator('[data-testid="login-submit"]').click();
    await expect(error).not.toBeEmpty({ timeout: 8_000 });
    await expect(error).not.toHaveText(tClient('auth.errors.accountExpired'));

    await page.fill('#login-password', EXPIRED.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(error).toHaveText(tClient('auth.errors.accountExpired'), { timeout: 8_000 });
    await expect(page.locator('[data-testid="nav-user-btn"]')).toHaveCount(0);
  });
});
