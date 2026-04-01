const { test, expect } = require('@playwright/test');
const { TEST_ADMIN }   = require('./helpers');

test.describe('Auth flows', () => {

  test.describe('Sign Up page', () => {
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
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.fill('#login-username', TEST_ADMIN.username);
      await page.fill('#login-password', TEST_ADMIN.password);
      await page.click('.login-form [type=submit]');

      await expect(page.locator('.lol-nav__user-btn')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.lol-nav__user-name')).toContainText(TEST_ADMIN.username);
    });

    test('wrong password shows error message', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.fill('#login-username', TEST_ADMIN.username);
      await page.fill('#login-password', 'wrong-password');
      await page.click('.login-form [type=submit]');

      await expect(page.locator('.login-form .form-error')).not.toBeEmpty({ timeout: 8_000 });
    });
  });

  test.describe('Logout', () => {
    test('logout clears session and shows Sign In / Sign Up', async ({ page }) => {
      // Log in first
      await page.goto('/');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.fill('#login-username', TEST_ADMIN.username);
      await page.fill('#login-password', TEST_ADMIN.password);
      await page.click('.login-form [type=submit]');
      await page.waitForSelector('.lol-nav__user-btn', { timeout: 10_000 });

      // Open dropdown and sign out
      await page.click('.lol-nav__user-btn');
      await page.getByRole('button', { name: 'Sign Out' }).click();

      // Nav should revert to guest state
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 8_000 });
      await expect(page.getByRole('link', { name: 'Sign Up' })).toBeVisible();
    });
  });

});
