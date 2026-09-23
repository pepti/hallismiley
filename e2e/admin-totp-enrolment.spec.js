// @ts-check
// An admin who has not set up two-step verification is walked through it, and
// holds no admin rights until it is done — server/auth/mfaPolicy.js is the gate
// (covered against the API in tests/integration/adminTotpEnforcement.test.js);
// this is the person's side of it, in a real browser, end to end.
//
// The shared `testadmin` is exempt by name (playwright.config.js); `enroladmin`
// is not, so it meets the production rule. One sign-in per test — TOTP's
// replay guard allows one code per 30-second step.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');
const totp = require('../server/utils/totp');

const ADMIN = { username: 'enroladmin', email: 'enroladmin@e2e.test', password: 'EnrolAdmin123' };
const ROOT = path.join(__dirname, '..');

function script(name, ...args) {
  execFileSync('node', [path.join('server', 'scripts', name), ...args], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, DB_SSL: 'false', NODE_ENV: 'test' },
  });
}

async function signIn(page) {
  await page.goto('/is/');
  await page.locator('[data-testid="nav-signin"]').click();
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('.login-form [type=submit]');
}

test.describe.configure({ mode: 'serial' });

test.describe('Admin two-step enrolment is mandatory', () => {
  test.beforeAll(() => {
    script('setup-admin.js', ADMIN.username, ADMIN.email, ADMIN.password);
    // The e2e database is reused between runs: start from "never enrolled".
    // This is also the break-glass script doing its real job.
    script('reset-admin-totp.js', ADMIN.username);
  });

  test('sign-in lands on the set-up panel; the admin area stays shut until it is done', async ({ page }) => {
    await signIn(page);

    // Signed in — but sent to the profile, told why, and offered no admin entry.
    await expect(page).toHaveURL(/\/is\/profile$/);
    await expect(page.locator('[data-testid="totp-required"]')).toBeVisible();
    await page.locator('[data-testid="nav-user-btn"]').click();
    await expect(page.locator('[data-route="/admin"]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // A bookmarked admin URL comes back here, and the API itself refuses.
    await page.goto('/is/admin/users');
    await expect(page).toHaveURL(/\/is\/profile$/);
    const refused = await page.evaluate(() => fetch('/api/v1/admin/events', { credentials: 'include' })
      .then(async r => ({ status: r.status, body: await r.json() })));
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/two-factor|tveggja þátta/);   // a bare fetch carries no locale

    // Set it up: the key is on the page for manual entry; the code comes from it.
    await page.locator('[data-testid="totp-start"]').click();
    const secret = (await page.locator('[data-testid="totp-secret"]').textContent()).trim();
    await page.fill('[data-testid="totp-code"]', totp.generateCode(secret));
    await page.locator('[data-testid="totp-confirm"]').click();

    // The recovery codes exist for this moment only — they must stay on screen
    // until the person dismisses them (a re-render here would lose them).
    const codes = page.locator('[data-testid="totp-recovery-codes"] li');
    await expect(codes).toHaveCount(10);
    await page.waitForTimeout(600);
    await expect(codes).toHaveCount(10);
    await page.locator('#totp-done').click();

    // Now it is an admin: the panel shows the ON state, the area opens.
    await expect(page.locator('[data-testid="totp-disable"]')).toBeVisible();
    await expect(page.locator('[data-testid="totp-required"]')).toHaveCount(0);
    await page.goto('/is/admin/users');
    await expect(page.locator('table, .admin-users-table')).toBeVisible({ timeout: 10_000 });
  });

  test('break-glass: the reset script ends the sessions and the account owes enrolment again', async ({ page }) => {
    script('reset-admin-totp.js', ADMIN.username);

    await signIn(page);
    await expect(page).toHaveURL(/\/is\/profile$/);
    await expect(page.locator('[data-testid="totp-required"]')).toBeVisible();
    const session = await page.evaluate(() => fetch('/auth/session', { credentials: 'include' }).then(r => r.json()));
    expect(session.user).toMatchObject({ role: 'user', mfa_enrolment_required: true, totp_enabled: false });
  });
});
