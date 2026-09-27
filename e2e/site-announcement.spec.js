// The time-limited site announcement (harvest2-lane7a; ported from
// icelandicstore #200): dialog on the first visit, focus trapped, Esc closes it
// to a slim banner, the banner's slot is there on the next load before the
// fetch answers, ✕ hides it for good, a NEW announcement shows again, and a
// signed-in visitor never sees it.
//
// The public endpoint is STUBBED here (page.route): the e2e database is shared
// by four workers, and arming a real announcement would put a dialog over
// every other anonymous spec. The server's window rule and its withholding are
// pinned by tests/integration/siteAnnouncement.test.js.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { seedUser, signInViaApi } = require('./lib/accounts');

const LIVE = {
  active: true, id: 'e2e-announce-1',
  title: { is: 'Nýr vefur í loftinu', en: 'Our new site is live' },
  message: { is: 'Aðgangurinn þinn fluttist með.\nVeldu þér lykilorð.', en: 'Your account came with us.' },
  link: { path: '/forgot-password', label: { is: 'Veldu lykilorð', en: 'Set a password' } },
};

async function stub(page, body) {
  await page.route('**/api/v1/announcement', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

test.describe('Site announcement', () => {
  test('dialog → banner → hidden, focus kept inside the dialog', async ({ page }) => {
    await stub(page, LIVE);
    await page.goto('/is/um-okkur');
    const dialog = page.locator('[data-testid="announcement-modal"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.locator('#announce-title')).toHaveText(LIVE.title.is);
    // The link is the first stop; Tab and Shift+Tab never leave the dialog.
    await expect(dialog.locator('[data-link]')).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

    // Esc demotes it to the banner.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const banner = page.locator('[data-testid="announcement-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(LIVE.title.is);
    expect(Math.round((await banner.boundingBox()).height)).toBe(40);

    // Next load: the slot is there BEFORE the fetch answers (held back here).
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.unroute('**/api/v1/announcement');
    await page.route('**/api/v1/announcement', async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIVE) });
    });
    await page.reload();
    await expect(banner).toHaveCount(1);
    expect(Math.round((await banner.boundingBox()).height)).toBe(40);
    release();
    await expect(banner).toContainText(LIVE.title.is);
    await expect(dialog).toHaveCount(0);

    // "Lesa meira" reopens the dialog; ✕ on the banner hides it for good.
    await banner.locator('[data-more]').click();
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-ok]').click();
    await banner.locator('[data-hide]').click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(banner).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
  });

  test('a new announcement is shown again; an ended one leaves nothing behind', async ({ page }) => {
    await page.goto('/is/um-okkur');
    await page.evaluate(() => localStorage.setItem('site_announcement',
      JSON.stringify({ id: 'an-old-one', modalSeen: true, bannerHidden: true })));
    await stub(page, LIVE);
    await page.reload();
    await expect(page.locator('[data-testid="announcement-modal"]')).toBeVisible();

    // A remembered banner whose announcement has ended: the reserved slot goes.
    await page.evaluate(() => localStorage.setItem('site_announcement',
      JSON.stringify({ id: 'e2e-announce-1', modalSeen: true, bannerHidden: false })));
    await page.unroute('**/api/v1/announcement');
    await stub(page, { active: false });
    await page.reload();
    await expect(page.locator('[data-testid="announcement-banner"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="announcement-modal"]')).toHaveCount(0);
  });

  test('following the link acknowledges it and goes there', async ({ page }) => {
    await stub(page, LIVE);
    await page.goto('/is/um-okkur');
    await page.locator('[data-testid="announcement-modal"] [data-link]').click();
    await expect(page).toHaveURL(/\/is\/forgot-password$/);
    await expect(page.locator('[data-testid="announcement-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="announcement-banner"]')).toHaveCount(0);
  });

  test('a signed-in visitor never sees it', async ({ page }) => {
    const who = { username: 'e2e-l7a-reader', email: 'l7a-reader@e2e.test', password: 'ReaderPass123' };
    await seedUser(who);
    await stub(page, LIVE);
    await page.goto('/is/um-okkur');
    await signInViaApi(page, who);
    await page.reload();
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(page.locator('[data-testid="announcement-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="announcement-banner"]')).toHaveCount(0);
  });
});
