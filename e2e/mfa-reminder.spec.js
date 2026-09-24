// @ts-check
// The two-step REMINDER (mfa-reminder-2026-09-23), in a real browser.
//
// Halli: two-factor enrolment is optional, "but put a reminder somewhere, and
// a checkmark not to see the reminder again". The main e2e server runs the
// instance default, `optional` (playwright.config.js), which is the only mode
// the reminder exists in. The session flag and the dismiss endpoint are
// pinned against the API in tests/integration/mfaReminder.test.js; this is
// the person's side: the notice atop /admin, ✕ for this page load only, the
// checkbox that makes it stay gone — on every device, because it is stored
// per account — and a second admin who is still reminded.
//
// Two per-spec admins, never the shared `testadmin`: the dismissal is
// per-account state, so a spec that writes it owns its accounts
// (e2e/lib/accounts.js, point 1). The e2e database is reused between runs,
// so beforeAll puts both back to "never enrolled, never dismissed".
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { seedAdminUser, signInViaApi } = require('./lib/accounts');

const FIRST = { username: 'e2ereminderadmin', email: 'reminder-admin@e2e.test', password: 'ReminderAdmin123' };
const SECOND = { username: 'e2ereminderadmin2', email: 'reminder-admin2@e2e.test', password: 'ReminderAdmin123' };
const REMINDER = '[data-testid="mfa-reminder"]';

async function resetAccounts() {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    await pool.query(
      `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_secret_enc = NULL,
              totp_last_step = NULL, mfa_reminder_dismissed_at = NULL
        WHERE username = ANY($1)`,
      [[FIRST.username, SECOND.username]]
    );
  } finally {
    await pool.end();
  }
}

async function dismissedAt(username) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    const { rows } = await pool.query('SELECT mfa_reminder_dismissed_at FROM users WHERE username = $1', [username]);
    return rows[0]?.mfa_reminder_dismissed_at ?? null;
  } finally {
    await pool.end();
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('two-step reminder under security.mfa.enrolment = optional', () => {
  test.beforeAll(async () => {
    await seedAdminUser(FIRST);
    await seedAdminUser(SECOND);
    await resetAccounts();
  });

  test('an unenrolled admin sees it atop /admin; ✕ hides it for this page load only', async ({ page }) => {
    await signInViaApi(page, FIRST);
    await page.goto('/is/admin');

    const reminder = page.locator(REMINDER);
    await expect(reminder).toBeVisible();
    // A labelled region with a labelled checkbox and a named close button.
    await expect(page.getByRole('region', { name: /tveggja þátta/i })).toBeVisible();
    await expect(reminder.getByRole('checkbox', { name: 'Ekki sýna þetta aftur' })).not.toBeChecked();
    await expect(reminder.getByRole('button', { name: 'Loka áminningu' })).toBeVisible();
    // It sits above the screen's own content, inside the shared shell.
    await expect(page.locator('.admin-shell__content > .mfa-reminder:first-child')).toHaveCount(1);

    await reminder.getByRole('button', { name: 'Loka áminningu' }).click();
    await expect(reminder).toHaveCount(0);

    // Moving to another admin screen in the SPA does not bring it back…
    await page.locator('.admin-sidebar a[data-route="/admin/users"]').click();
    await expect(page).toHaveURL(/\/is\/admin\/users$/);
    await expect(page.locator('.admin-shell')).toBeVisible();
    await expect(page.locator(REMINDER)).toHaveCount(0);

    // …a reload does: ✕ saved nothing.
    await page.reload();
    await expect(page.locator(REMINDER)).toBeVisible();
    expect(await dismissedAt(FIRST.username)).toBeNull();
  });

  test('"set it up" opens the two-step panel on Prófíll', async ({ page }) => {
    await signInViaApi(page, FIRST);
    await page.goto('/is/admin');
    await page.locator('[data-testid="mfa-reminder-setup"]').click();
    await expect(page).toHaveURL(/\/is\/profile\?focus=2fa$/);
    await expect(page.locator('[data-testid="totp-section"]')).toBeInViewport();
    await expect(page.locator('[data-testid="totp-start"]')).toBeVisible();
  });

  test('ticking "Ekki sýna þetta aftur" saves it for the account: gone after a reload', async ({ page }) => {
    await signInViaApi(page, FIRST);
    await page.goto('/is/admin');
    const reminder = page.locator(REMINDER);
    await expect(reminder).toBeVisible();

    await reminder.getByRole('checkbox', { name: 'Ekki sýna þetta aftur' }).check();
    await expect(page.locator(REMINDER)).toHaveCount(0);
    await expect(page.locator('.toast').filter({ hasText: 'Áminningin birtist ekki aftur' })).toBeVisible();
    expect(await dismissedAt(FIRST.username)).not.toBeNull();

    await page.reload();
    await expect(page.locator('.admin-shell')).toBeVisible();
    await expect(page.locator(REMINDER)).toHaveCount(0);
    const session = await page.evaluate(() => fetch('/auth/session', { credentials: 'include' }).then(r => r.json()));
    expect(session.user).toMatchObject({ role: 'admin', mfa_reminder: false });
  });

  test('a second unenrolled admin is still reminded', async ({ page }) => {
    await signInViaApi(page, SECOND);
    await page.goto('/is/admin');
    await expect(page.locator(REMINDER)).toBeVisible();
  });
});
