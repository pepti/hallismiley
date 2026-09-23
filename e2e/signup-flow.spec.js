const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { TEST_ADMIN }   = require('./helpers');
// The status copy is the visitor default's (identity.locale.publicDefault),
// read from the SPA table — never an Icelandic literal (e2e/lib/locale.js).
const { tClient } = require('./lib/locale');

test.describe('Signup flow', () => {

  test('avatar picker has a pre-selected avatar by default', async ({ page }) => {
    await page.goto('/#/signup');
    await page.waitForSelector('.avatar-picker__item', { timeout: 8_000 });
    await expect(page.locator('.avatar-picker__item--selected')).toHaveCount(1);
  });

  test('password strength indicator appears when typing password', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-password', 'abc');
    await expect(page.locator('#pw-strength')).not.toBeEmpty();
  });

  test('weak password shows "Weak" strength label', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-password', 'aaaaaaaa'); // 8 chars, only letters, no number
    const strength = page.locator('#pw-strength');
    await expect(strength).toContainText(/weak|fair/i);
  });

  test('strong password satisfies all requirements', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-password', 'ValidPass1!');

    await expect(page.locator('#req-length')).toHaveClass(/req--met/);
    await expect(page.locator('#req-letter')).toHaveClass(/req--met/);
    await expect(page.locator('#req-number')).toHaveClass(/req--met/);
  });

  // A visitor with no signal reads the visitor default (Accept-Language is
  // not a signal). "Lykilorðin stemma" is a prefix of "Lykilorðin stemma ekki",
  // so assert the full text plus the status class.
  test('mismatched confirm password shows error status', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-password', 'ValidPass1');
    await page.fill('#signup-confirm', 'DifferentPass1');

    const status = page.locator('#confirm-status');
    await expect(status).toHaveText(`✗ ${tClient('signup.passwordsMismatch')}`);
    await expect(status).toHaveClass(/status--err/);
  });

  test('matching confirm password shows positive status', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-password', 'ValidPass1');
    await page.fill('#signup-confirm', 'ValidPass1');

    const status = page.locator('#confirm-status');
    await expect(status).toHaveText(`✓ ${tClient('signup.passwordsMatch')}`);
    await expect(status).toHaveClass(/status--ok/);
  });

  test('weak password on submit shows validation error', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-email', `weak${Date.now()}@e2e.test`);
    await page.fill('#signup-username', `weakuser${Date.now()}`);
    await page.fill('#signup-password', 'abc');
    await page.fill('#signup-confirm', 'abc');
    await page.click('#signup-btn');

    await expect(page.locator('#signup-error')).not.toBeEmpty();
  });

  test('mismatched passwords on submit shows error', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-email', `mismatch${Date.now()}@e2e.test`);
    await page.fill('#signup-username', `mismatch${Date.now()}`);
    await page.fill('#signup-password', 'ValidPass1');
    await page.fill('#signup-confirm', 'Different1');
    await page.click('#signup-btn');

    // The submit-time error is the same i18n string, in the visitor default.
    await expect(page.locator('#signup-error')).toHaveText(tClient('signup.passwordsMismatch'));
  });

  test('duplicate username shows server-side error', async ({ page }) => {
    await page.goto('/#/signup');
    await page.fill('#signup-email', `dup${Date.now()}@e2e.test`);
    await page.fill('#signup-username', TEST_ADMIN.username);
    await page.fill('#signup-password', 'ValidPass1');
    await page.fill('#signup-confirm', 'ValidPass1');
    await page.click('#signup-btn');

    await expect(page.locator('#signup-error')).not.toBeEmpty({ timeout: 8_000 });
  });

  test('successful signup logs user in and shows welcome screen', async ({ page, context }) => {
    const uid   = Date.now();
    const email = `e2esignup${uid}@e2e.test`;

    await page.goto('/#/signup');
    await page.fill('#signup-email', email);
    await page.fill('#signup-username', `e2esignup${uid}`);
    await page.fill('#signup-password', 'ValidPass1');
    await page.fill('#signup-confirm', 'ValidPass1');
    await page.click('#signup-btn');

    await expect(page.locator('#signup-success')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#signup-success-email')).toContainText(email);

    // Auto-login: the signup response should have set a session cookie.
    const cookies = await context.cookies();
    expect(cookies.some(c => c.name === 'auth_session')).toBe(true);

    // Continue button routes home via the SPA router.
    await page.click('[data-testid="signup-continue"]');
    await expect(page).not.toHaveURL(/\/signup/);
  });

  test('selecting a different avatar updates the hidden input', async ({ page }) => {
    await page.goto('/#/signup');

    // Click the second avatar
    const secondAvatar = page.locator('.avatar-picker__item').nth(1);
    await secondAvatar.click();

    await expect(secondAvatar).toHaveClass(/avatar-picker__item--selected/);
    const avatarVal = await page.locator('#signup-avatar').inputValue();
    expect(avatarVal).toMatch(/^avatar-/);
  });

});
