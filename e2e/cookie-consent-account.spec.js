// @ts-check
// The cookie banner follows the ACCOUNT, not just the browser (harvested from
// icelandicstore #411, harvest-ice-b-2026-09-24; Halli 2026-09-23: a signed-in
// user who had already answered was asked again). users.cookie_consent,
// migration 111; services/cookieConsent.js + public/js/consent.js.
//
// The suite pre-seeds `cookie_consent` = declined in every context
// (playwright.config.js), so this spec opens its own contexts without it. A
// per-spec account: the answer is per-account state (e2e/lib/accounts.js).
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { seedAdminUser, signInViaApi } = require('./lib/accounts');

const ACCOUNT = { username: 'e2ecookieadmin', email: 'cookie-admin@e2e.test', password: 'CookieAdmin123' };
const EMPTY = { cookies: [], origins: [] };
const BANNER = '#cookie-consent-banner';

async function dbConsent(value) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    if (value === undefined) {
      const { rows } = await pool.query('SELECT cookie_consent FROM users WHERE username = $1', [ACCOUNT.username]);
      return rows[0]?.cookie_consent ?? null;
    }
    await pool.query('UPDATE users SET cookie_consent = $2 WHERE username = $1', [ACCOUNT.username, value]);
    return value;
  } finally {
    await pool.end();
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('cookie banner follows the account', () => {
  test.beforeAll(async () => { await seedAdminUser(ACCOUNT); });
  test.afterAll(async () => { await dbConsent(null); });

  test('an answer on the account hides the banner in a browser that never answered', async ({ browser }) => {
    await dbConsent('accepted');
    const ctx = await browser.newContext({ storageState: EMPTY });
    const page = await ctx.newPage();
    try {
      // Signed out, nobody has answered here: the banner asks.
      await page.goto('/is/');
      await expect(page.locator(BANNER)).toBeVisible();

      // Signed in, the account's answer is adopted: no banner, and this browser
      // now remembers it too.
      await signInViaApi(page, ACCOUNT);
      await page.reload();
      await expect(page.locator('[data-testid="nav-user-btn"]')).toBeVisible();
      await expect(page.locator(BANNER)).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('cookie_consent'))).toBe('accepted');
    } finally {
      await ctx.close();
    }
  });

  test('an answer on the banner while signed in is saved to the account; the banner reopens from the privacy page', async ({ browser }) => {
    await dbConsent(null);
    const ctx = await browser.newContext({ storageState: EMPTY });
    const page = await ctx.newPage();
    try {
      await signInViaApi(page, ACCOUNT);
      await page.goto('/is/personuvernd');
      const banner = page.locator(BANNER);
      await expect(banner).toBeVisible();
      const saved = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/users/me/cookie-consent');
      await banner.getByRole('button', { name: 'Hafna' }).click();
      expect((await saved).status()).toBe(200);
      await expect(banner).toHaveCount(0);
      expect(await dbConsent()).toBe('declined');

      // "Breyta vali á vafrakökum" asks again.
      await page.getByTestId('privacy-cookie-choice').click();
      await expect(page.locator(BANNER)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
