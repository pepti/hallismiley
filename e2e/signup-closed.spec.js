// @ts-check
// The shop-window setting in a real browser (R2b — rekstrarkerfi.is: staff
// sign in, nobody signs up). The SECOND e2e server runs it
// (playwright.config.js: the `signup` module off, identity.surface.navSignIn
// off): the nav offers neither "Innskrá" nor "Nýskrá", /login is the door and
// opens the login modal — without a sign-up link — /signup is a 404, and
// signing in works.
const { test, expect } = require('@playwright/test');
const { TEST_ADMIN } = require('./helpers');

test.use({ baseURL: process.env.E2E_REQUIRED_BASE_URL });

test('no sign-in or sign-up in the nav; /login opens the modal and signs staff in', async ({ page }) => {
  await page.goto('/is/');
  await expect(page.locator('.lol-nav')).toBeVisible();
  await expect(page.locator('[data-testid="nav-signin"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="nav-signup"]')).toHaveCount(0);

  await page.goto('/is/login');
  await expect(page.locator('.login-modal-overlay')).toHaveClass(/open/);
  await expect(page.locator('#login-username')).toBeVisible();
  await expect(page.locator('#login-signup-link')).toHaveCount(0);
  await expect(page.locator('#login-forgot-link')).toBeVisible();

  await page.fill('#login-username', TEST_ADMIN.username);
  await page.fill('#login-password', TEST_ADMIN.password);
  await page.click('.login-form [type=submit]');
  await expect(page.locator('[data-testid="nav-user-btn"]')).toBeVisible({ timeout: 10_000 });
});

test('/signup is not found, and the signup API is absent', async ({ page, request }) => {
  const res = await page.goto('/is/signup');
  expect(res && res.status()).toBe(404);
  await expect(page.locator('.not-found__code')).toHaveText('404');
  await expect(page.locator('#signup-email')).toHaveCount(0);

  const api = await request.post('/auth/signup', { data: { username: 'nyr', email: 'nyr@e2e.test', password: 'Str0ng!Passw0rd' } });
  expect(api.status()).toBe(404);
});

test('a signed-out visitor sent to /login from a protected page gets the modal', async ({ page }) => {
  await page.goto('/is/profile');
  await expect(page.locator('.login-modal-overlay')).toHaveClass(/open/);
});
