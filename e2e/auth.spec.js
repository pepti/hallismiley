const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { TEST_ADMIN, openSignIn } = require('./helpers');
const { gate } = require('./lib/featureGate');
const { identity } = require('./lib/identity');
// A product may run with public signup off and the nav's "Innskrá" hidden
// (the `signup` module, identity.surface.navSignIn — R2b).
const SIGNUP_OFF = gate('signup').skip;
const NAV_SIGN_IN = identity.surface.navSignIn !== false;

test.describe('Auth flows', () => {

  test.describe('Sign Up page', () => {
    test.skip(SIGNUP_OFF, 'public signup is switched off on this product (the signup module)');
    test('loads with avatar picker and form fields', async ({ page }) => {
      await page.goto('/#/signup');
      await expect(page.locator('#avatar-picker')).toBeVisible();
      await expect(page.locator('#signup-email')).toBeVisible();
      await expect(page.locator('#signup-username')).toBeVisible();
      await expect(page.locator('#signup-password')).toBeVisible();
    });

    test('successful signup shows email verification message', async ({ page }) => {
      const uid      = Date.now();
      const username = `e2euser${uid}`;
      const email    = `e2euser${uid}@e2e.test`;

      await page.goto('/#/signup');
      await page.fill('#signup-email', email);
      await page.fill('#signup-username', username);
      await page.fill('#signup-password', 'ValidPass1');
      await page.fill('#signup-confirm', 'ValidPass1');
      await page.click('#signup-btn');

      await expect(page.locator('#signup-success')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#signup-success-email')).toContainText(email);
    });

    test('duplicate username shows error', async ({ page }) => {
      await page.goto('/#/signup');
      await page.fill('#signup-email', 'another@e2e.test');
      await page.fill('#signup-username', TEST_ADMIN.username); // already exists
      await page.fill('#signup-password', 'ValidPass1');
      await page.fill('#signup-confirm', 'ValidPass1');
      await page.click('#signup-btn');

      await expect(page.locator('#signup-error')).not.toBeEmpty({ timeout: 8_000 });
    });

    test('weak password shows validation error', async ({ page }) => {
      await page.goto('/#/signup');
      await page.fill('#signup-email', 'weak@e2e.test');
      await page.fill('#signup-username', 'weakpwuser');
      await page.fill('#signup-password', 'abc');      // too short
      await page.fill('#signup-confirm', 'abc');
      await page.click('#signup-btn');

      await expect(page.locator('#signup-error')).not.toBeEmpty();
    });
  });

  test.describe('Login', () => {
    test('valid credentials succeed — navbar shows username', async ({ page }) => {
      await page.goto('/');
      await openSignIn(page);
      await page.fill('#login-username', TEST_ADMIN.username);
      await page.fill('#login-password', TEST_ADMIN.password);
      await page.locator('[data-testid="login-submit"]').click();

      await expect(page.locator('[data-testid="nav-user-btn"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.lol-nav__user-name')).toContainText(TEST_ADMIN.username);
    });

    test('wrong password shows error message', async ({ page }) => {
      await page.goto('/');
      await openSignIn(page);
      await page.fill('#login-username', TEST_ADMIN.username);
      await page.fill('#login-password', 'wrong-password');
      await page.locator('[data-testid="login-submit"]').click();

      await expect(page.locator('[data-testid="login-form"] .form-error')).not.toBeEmpty({ timeout: 8_000 });
    });

    test('signing in with the admin email (any case) works', async ({ page }) => {
      await page.goto('/');
      await openSignIn(page);
      await page.fill('#login-username', TEST_ADMIN.email.toUpperCase());
      await page.fill('#login-password', TEST_ADMIN.password);
      await page.locator('[data-testid="login-submit"]').click();

      await expect(page.locator('[data-testid="nav-user-btn"]')).toBeVisible({ timeout: 10_000 });
    });

    test('login field has mobile-friendly keyboard hints', async ({ page }) => {
      await page.goto('/');
      await openSignIn(page);
      const input = page.locator('#login-username');
      await expect(input).toHaveAttribute('inputmode', 'email');
      await expect(input).toHaveAttribute('autocapitalize', 'none');
      await expect(input).toHaveAttribute('autocorrect', 'off');
      await expect(input).toHaveAttribute('spellcheck', 'false');
    });

    test('password reveal toggle flips input type and aria-pressed', async ({ page }) => {
      await page.goto('/');
      await openSignIn(page);

      const pw     = page.locator('#login-password');
      const toggle = page.locator('.login-modal-overlay .password-toggle__btn');

      await expect(pw).toHaveAttribute('type', 'password');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await toggle.click();

      await expect(pw).toHaveAttribute('type', 'text');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');

      await toggle.click();

      await expect(pw).toHaveAttribute('type', 'password');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
  });

  test.describe('Logout', () => {
    test('logout clears session and shows Sign In / Sign Up', async ({ page }) => {
      // Log in first
      await page.goto('/');
      await openSignIn(page);
      await page.fill('#login-username', TEST_ADMIN.username);
      await page.fill('#login-password', TEST_ADMIN.password);
      await page.locator('[data-testid="login-submit"]').click();
      await page.locator('[data-testid="nav-user-btn"]').waitFor({ timeout: 10_000 });

      // Open dropdown and sign out
      await page.locator('[data-testid="nav-user-btn"]').click();
      await page.locator('[data-testid="nav-signout"]').click();

      // Nav should revert to guest state
      await expect(page.locator('[data-testid="nav-user-btn"]')).toHaveCount(0, { timeout: 8_000 });
      await expect(page.locator('[data-testid="nav-signin"]')).toHaveCount(NAV_SIGN_IN ? 1 : 0);
      await expect(page.locator('[data-testid="nav-signup"]')).toHaveCount(SIGNUP_OFF ? 0 : 1);
    });
  });

});
