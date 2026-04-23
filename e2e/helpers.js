const TEST_ADMIN = {
  username: 'testadmin',
  email:    'admin@e2e.test',
  password: 'AdminPass123',
};

/**
 * Log in as the E2E admin account via the login modal.
 * Safe to call even if already logged in — skips if the user button is present.
 */
async function loginAsAdmin(page) {
  await page.goto('/');

  // Already logged in?
  if (await page.locator('.lol-nav__user-btn').isVisible()) return;

  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.fill('#login-username', TEST_ADMIN.username);
  await page.fill('#login-password', TEST_ADMIN.password);
  await page.click('.login-form [type=submit]');
  await page.waitForSelector('.lol-nav__user-btn', { timeout: 10_000 });
}

/**
 * Sign up a new unique user via the signup form UI.
 * Returns { username, email, password }.
 */
async function createTestUser(page) {
  const uid      = Date.now();
  const username = `testuser${uid}`;
  const email    = `testuser${uid}@e2e.test`;
  const password = 'TestUser123';

  await page.goto('/#/signup');
  await page.fill('#signup-email', email);
  await page.fill('#signup-username', username);
  await page.fill('#signup-password', password);
  await page.fill('#signup-confirm', password);
  await page.click('#signup-btn');
  await page.waitForSelector('#signup-success', { state: 'visible' });

  return { username, email, password };
}

/**
 * Sign up a brand-new unique user via the signup form UI.
 * Returns { username, email, password }.
 * Alias for createTestUser — use when the intent is signing up (not just creating).
 */
async function signupUser(page) {
  return createTestUser(page);
}

/**
 * Navigate to the Stofan Bakhús project detail page from the projects list.
 * Works whether logged in or not.
 */
async function navigateToProject(page, name = /Stofan Bakhús/i) {
  await page.goto('/#/projects');
  await page.waitForSelector('.project-card', { timeout: 10_000 });
  await page.getByRole('button', { name }).click();
  await page.waitForSelector('.pd-hero__title', { timeout: 10_000 });
}

module.exports = { loginAsAdmin, createTestUser, signupUser, navigateToProject, TEST_ADMIN };
