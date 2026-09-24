// Stale-release guard (public/js/services/buildGuard.js), end to end.
// Ported from icelandicstore #332/#333/#426 (harvest-ice-e-2026-09-24).
//
// A tab left open across a deploy keeps running the code it loaded — and, with
// self-update, an instance can pull a new image at 03:00 while an admin's tab
// sits open. The guard makes an open tab notice a newer release and reload onto
// it — at the next navigation, or on refocus when nothing has been typed —
// without throwing away input and without looping.
//
// The e2e server has no build stamp (every X-App-Build is 'dev', which the
// guard ignores), so a "deploy" is simulated: the SPA shell is rewritten to
// name release A, and API responses are rewritten to answer as release B.
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin } = require('./helpers');

const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';

// shell.build → the release the next HTML shell names; api.build → the release
// API responses answer as (null = untouched, i.e. 'dev').
async function simulateReleases(page, shell, api) {
  await page.route((url) => url.pathname.startsWith('/en/'), async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const res = await route.fetch();
    const body = (await res.text()).replace(
      /(<meta[^>]*name="app-build"[^>]*content=")[^"]*(")/, `$1${shell.build}$2`,
    );
    return route.fulfill({ response: res, body });
  });
  await page.route((url) => url.pathname.startsWith('/api/v1/') || url.pathname === '/health', async (route) => {
    if (!api.build) return route.fallback();
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), 'x-app-build': api.build } });
  });
}

function countDocuments(page) {
  const seen = { n: 0 };
  page.on('request', (r) => { if (r.resourceType() === 'document') seen.n += 1; });
  return seen;
}

async function openLeads(page) {
  await page.goto('/en/admin/leads');
  await expect(page.locator('#leads-q')).toBeVisible();
}

const sidebar = (page, route) => page.locator(`.admin-sidebar a[data-route="${route}"]`).first();

test.describe('Stale release → reload', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('a newer release seen in a response reloads the page at the next navigation', async ({ page }) => {
    const shell = { build: A };
    const api = { build: null };
    await simulateReleases(page, shell, api);
    await openLeads(page);
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute('content', A);

    // First, with no deploy, navigation must stay in-app. Without this the whole
    // suite would pass on a guard that reloaded on every single navigation.
    const before = countDocuments(page);
    await sidebar(page, '/admin/accounts').click();
    await expect(page).toHaveURL(/\/en\/admin\/accounts$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/admin\/leads$/);
    expect(before.n).toBe(0);

    // Deploy: the server now answers as B and serves a B shell.
    shell.build = B;
    api.build = B;
    await page.evaluate(() => fetch('/api/v1/ambience'));

    const doc = page.waitForRequest((r) => r.resourceType() === 'document');
    await sidebar(page, '/admin/accounts').click();
    await doc;
    await page.waitForLoadState('load');
    await expect(page).toHaveURL(/\/en\/admin\/accounts$/);
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute('content', B);
    await expect(page.locator('.update-banner')).toHaveCount(0);
  });

  test('on refocus with nothing typed, the page reloads straight away', async ({ page }) => {
    const shell = { build: A };
    const api = { build: null };
    await simulateReleases(page, shell, api);
    await openLeads(page);

    shell.build = B;
    api.build = B;
    await page.evaluate(() => fetch('/api/v1/ambience'));
    const doc = page.waitForRequest((r) => r.resourceType() === 'document');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await doc;
    await page.waitForLoadState('load');
    await expect(page).toHaveURL(/\/en\/admin\/leads$/);
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute('content', B);
  });

  test('on refocus after typing, the page keeps the input and shows the banner instead', async ({ page }) => {
    const shell = { build: A };
    const api = { build: null };
    await simulateReleases(page, shell, api);
    await openLeads(page);
    const docs = countDocuments(page);

    await page.fill('#leads-q', 'unsaved words');
    api.build = B;
    await page.evaluate(() => fetch('/api/v1/ambience'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page.locator('.update-banner')).toBeVisible();
    await expect(page.locator('#leads-q')).toHaveValue('unsaved words');
    expect(docs.n).toBe(0);
  });

  test('a reload that does not reach the new release is not repeated: banner, no loop', async ({ page }) => {
    // The shell keeps naming A while the API answers B — as if old and new
    // instances were answering in turn. One reload is tried, then the guard stops.
    const shell = { build: A };
    const api = { build: null };
    await simulateReleases(page, shell, api);
    await openLeads(page);
    const docs = countDocuments(page);

    api.build = B;
    await page.evaluate(() => fetch('/api/v1/ambience'));
    await sidebar(page, '/admin/accounts').click();
    await page.waitForLoadState('load');

    await expect(page.locator('.update-banner')).toBeVisible({ timeout: 15_000 });
    // Give a second reload every chance to happen before counting.
    await page.waitForTimeout(1500);
    expect(docs.n).toBe(1);
  });

  // A deploy lands while the page makes no request at all (admin pages don't
  // poll), then one click. That click must reload BEFORE the new view renders
  // on old code — the guard asks the server first (ice TEST report M1).
  test('a deploy the page has not heard about yet still reloads on the very first click', async ({ page }) => {
    const shell = { build: A };
    const api = { build: null };
    await simulateReleases(page, shell, api);
    await openLeads(page);

    shell.build = B;
    api.build = B;
    const doc = page.waitForRequest((r) => r.resourceType() === 'document');
    await sidebar(page, '/admin/accounts').click();
    await doc;
    await page.waitForLoadState('load');
    await expect(page).toHaveURL(/\/en\/admin\/accounts$/);
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute('content', B);
    await expect(page.locator('.update-banner')).toHaveCount(0);
  });

  // The live region exists empty before any message (so it is announced when
  // filled), sits first in the body (early in tab order), and the banner uses
  // the phone's width instead of collapsing to half of it.
  test('the banner region is announced, early in tab order, and full-width on a phone', async ({ page }) => {
    const shell = { build: A };
    const api = { build: null };
    await simulateReleases(page, shell, api);
    await page.setViewportSize({ width: 390, height: 800 });
    await openLeads(page);

    const region = await page.evaluate(() => {
      const r = document.querySelector('.update-banner-region');
      return r && {
        first: document.body.firstElementChild === r,
        role: r.getAttribute('role'),
        live: r.getAttribute('aria-live'),
        empty: r.childElementCount === 0,
      };
    });
    expect(region).toEqual({ first: true, role: 'status', live: 'polite', empty: true });

    await page.fill('#leads-q', 'x');
    api.build = B;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const banner = page.locator('.update-banner-region .update-banner');
    await expect(banner).toBeVisible();
    const box = await banner.boundingBox();
    expect(box.width).toBeGreaterThan(300);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });

  // Views load on demand (router.js VIEWS). Under release-stamped URLs an old
  // tab's view module answers 404 once the next release serves. The failed
  // load itself must notice (asking /health) and reload the tab.
  test('a view whose code is gone after a deploy reloads onto the new release', async ({ page }) => {
    const shell = { build: A };
    const api = { build: A };
    await simulateReleases(page, shell, api);
    await openLeads(page);
    await page.evaluate(() => fetch('/api/v1/ambience'));   // the tab has just heard "A"
    const docs = countDocuments(page);

    // Gone only for the old page: once the reload's document request goes out,
    // the new page gets the real file.
    let old = true;
    page.on('request', (r) => { if (r.resourceType() === 'document') old = false; });
    const gone = (url) => /\/views\/AdminAccountsView\.js$/.test(url.pathname);
    await page.route(gone, (route) => (old
      ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found","code":404}' })
      : route.fallback()));
    shell.build = B;
    api.build = B;

    const doc = page.waitForRequest((r) => r.resourceType() === 'document');
    await sidebar(page, '/admin/accounts').click();
    await doc;
    await page.waitForLoadState('load');
    await expect(page).toHaveURL(/\/en\/admin\/accounts$/);
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute('content', B);
    expect(docs.n).toBe(1);
  });
});
