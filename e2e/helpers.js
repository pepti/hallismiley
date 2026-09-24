const { readIdentity } = require('./lib/identity');
const { gate } = require('./lib/featureGate');
const { seedUser, signInViaApi } = require('./lib/accounts');

const TEST_ADMIN = {
  username: 'testadmin',
  email:    'admin@e2e.test',
  password: 'AdminPass123',
};

/**
 * Open the login modal the way THIS server offers it: the nav's "Innskrá",
 * or — on a product that hides it (identity.surface.navSignIn, R2b) — the
 * /login door, which opens the same modal. Reads the identity the page was
 * SERVED, so it is right on either e2e server. Call after a page.goto.
 */
async function openSignIn(page) {
  const id = await readIdentity(page);
  if (!id || id.surface.navSignIn !== false) {
    await page.locator('[data-testid="nav-signin"]').click();
    return;
  }
  const lc = new URL(page.url()).pathname.split('/').filter(Boolean)[0] || id.locale.publicDefault;
  await page.goto(`/${lc}/login`);
  await page.locator('#login-username').waitFor();
}

/**
 * Log in as the E2E admin account via the login modal.
 * Safe to call even if already logged in — skips if the user button is present.
 */
async function loginAsAdmin(page) {
  await page.goto('/');

  // Already logged in?
  if (await page.locator('[data-testid="nav-user-btn"]').isVisible()) return;

  await openSignIn(page);
  await page.fill('#login-username', TEST_ADMIN.username);
  await page.fill('#login-password', TEST_ADMIN.password);
  await page.click('.login-form [type=submit]');
  await page.waitForSelector('[data-testid="nav-user-btn"]', { timeout: 10_000 });
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

  // No public signup here (the `signup` module off, R2b): seed the account
  // and sign it in, which is where the signup form leaves a new user too.
  if (gate('signup').skip) {
    await seedUser({ username, email, password });
    await signInViaApi(page, { username, password });
    return { username, email, password };
  }

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


// Click, then wait for the resulting API response itself — never
// `networkidle`, which is not a save-completed signal (analytics beacons and
// polling keep the network busy; worse, "idle" can arrive while the save is
// still in flight). Arm waitForResponse BEFORE clicking or a fast response
// can land in the gap. Ported from icelandicstore #178.
async function clickAndExpectApi(page, locator, { method, path, status = 200 }) {
  const responded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === method
  );
  await locator.click();
  const res = await responded;
  if (res.status() !== status) {
    throw new Error(`${method} ${path} responded ${res.status()}, expected ${status}`);
  }
  return res;
}

module.exports = {
  clickAndExpectApi, loginAsAdmin, openSignIn, createTestUser, signupUser, navigateToProject, TEST_ADMIN };
