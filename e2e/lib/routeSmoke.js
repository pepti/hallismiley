// Assertions for the role × route harness (e2e/roles/*.spec.js). Ported from
// icelandicstore #62 (e2e/lib/routeSmoke.js) and made engine-generic: the
// "rendered" and "refused" tests read the router's own behaviour (the view's
// module was loaded, the URL stayed or was replaced) instead of one
// storefront's selectors.
//
//   watch(page)            collect console errors, page errors and 5xx answers
//   openRoute(page, path)  full load of /<locale><path>, wait for the SPA to paint
//   expectRendered(...)    the route's own view painted, not the 404 view; clean
//   expectAdminOpens(...)  + the admin shell, still on the route, no error banner
//   expectRefused(...)     an admin route a role may not open: the SPA left it,
//                          no admin shell, nothing leaked; clean
//   expectNoSideScroll     at 375px the page is no wider than the viewport
//   clickThrough(...)      click every visible link in a container, one by one
const { expect } = require('@playwright/test');
const { PUBLIC_DEFAULT_LOCALE } = require('./locale');

// Console noise that is not an app defect. Kept tight so real errors surface:
//   • "Failed to load resource" is Chrome's line for ANY 4xx/5xx subresource —
//     a refused API call (401/403/404 is the server doing its job) or a missing
//     placeholder image. 5xx answers are asserted separately from the network,
//     so filtering this line never hides a server error.
//   • the hero video / a lazy image cancelled by the next navigation.
const IGNORE = [
  /Failed to load resource/i,
  /net::ERR_ABORTED/i,
  /ResizeObserver loop/i,
];

function watch(page) {
  const errors = [];
  const serverErrors = [];
  const onConsole = (msg) => { if (msg.type() === 'error') errors.push(msg.text()); };
  const onPageError = (err) => errors.push(`pageerror: ${err.message}`);
  const onResponse = (res) => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  return {
    errors,
    serverErrors,
    real: () => errors.filter((e) => !IGNORE.some((re) => re.test(e))),
    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
    },
  };
}

/** The views whose modules the page requested (public/js/views/<Name>.js). */
function watchViews(page) {
  const views = new Set();
  page.on('request', (r) => {
    const m = new URL(r.url()).pathname.match(/\/views\/(\w+)\.js$/);
    if (m) views.add(m[1]);
  });
  return views;
}

const localeOf = (page) => new URL(page.url()).pathname.split('/').filter(Boolean)[0];

/**
 * Full load of `route` under the visitor-default locale, then wait for the SPA:
 * #app painted and the network quiet (bounded — the home hero streams video).
 */
async function openRoute(page, route, { locale = PUBLIC_DEFAULT_LOCALE } = {}) {
  const url = `/${locale}${route === '/' ? '/' : route}`;
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app > *').first()).toBeAttached({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  return res;
}

function assertClean(w, where) {
  const real = w.real();
  expect(real, `console errors on ${where}:\n  ${real.join('\n  ')}`).toEqual([]);
  expect(w.serverErrors, `5xx answers on ${where}`).toEqual([]);
}

/** A public route renders its own view (not the 404 view), cleanly. */
async function expectRendered(page, route, w, views) {
  const res = await openRoute(page, route.pattern);
  expect(res && res.status(), `document status for ${route.pattern}`).toBeLessThan(500);
  await expect(page.locator('.not-found'), `${route.pattern} rendered the 404 view`).toHaveCount(0);
  // A route that renders HomeView (/login) or redirects (a signed-out
  // /profile) has no module of its own to prove; the others must load theirs.
  if (route.view && route.view !== 'HomeView' && route.guard.kind === 'public' && !/\/(login)$/.test(route.pattern)) {
    const stillThere = new URL(page.url()).pathname.endsWith(route.pattern);
    if (stillThere) expect([...views], `${route.pattern} never loaded ${route.view}`).toContain(route.view);
  }
  assertClean(w, route.pattern);
}

/** An admin route opens for this role: its view, the shell, no error banner. */
async function expectAdminOpens(page, route, w, views) {
  await openRoute(page, route.pattern);
  const lc = localeOf(page);
  await expect(page, `${route.pattern} redirected away`).toHaveURL(new RegExp(`/${lc}${route.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?#]|$)`));
  await expect(page.locator('.admin-shell').first(), `no admin shell on ${route.pattern}`).toBeVisible({ timeout: 15_000 });
  if (route.view) expect([...views], `${route.pattern} never loaded ${route.view}`).toContain(route.view);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await expect(page.locator('.admin-error'), `error banner on ${route.pattern}`).toHaveCount(0);
  assertClean(w, route.pattern);
}

/**
 * An admin route this role may not open: the router replaced the URL (home, or
 * /login for a visitor, which lands on home with the sign-in modal), no admin
 * shell painted, the view's module never loaded, nothing 5xx'd.
 */
async function expectRefused(page, route, w, views) {
  await openRoute(page, route.pattern);
  await expect.poll(() => new URL(page.url()).pathname, { message: `${route.pattern} was not refused`, timeout: 10_000 })
    .not.toMatch(new RegExp(`${route.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('.admin-shell'), `admin shell leaked on ${route.pattern}`).toHaveCount(0);
  if (route.view && route.view !== 'AdminView') {
    expect([...views], `${route.pattern} loaded ${route.view} for a role without it`).not.toContain(route.view);
  }
  assertClean(w, route.pattern);
}

/** At 375px nothing scrolls sideways (1px of sub-pixel rounding allowed). */
async function expectNoSideScroll(page, where) {
  await page.setViewportSize({ width: 375, height: 812 });
  // Let what reacts to the resize settle (a chart redraws on its
  // ResizeObserver, a frame or two later); a page still too wide after that
  // is the finding.
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    { timeout: 3_000 },
  ).toBeLessThanOrEqual(1).catch(() => {});
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed';
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
    return { scroll: doc.scrollWidth, client: doc.clientWidth, wide };
  });
  expect(m.scroll, `${where} scrolls sideways at 375px (scrollWidth ${m.scroll} > ${m.client}); widest: ${m.wide.join(', ')}`)
    .toBeLessThanOrEqual(m.client + 1);
}

/** The data-route links visible in `container` (deduplicated, in page order). */
async function linkRoutes(page, container) {
  return page.locator(`${container} a[data-route]`).evaluateAll((els) => {
    const seen = new Set();
    const out = [];
    for (const a of els) {
      const r = a.getAttribute('data-route');
      const visible = a.offsetParent !== null || a.getClientRects().length > 0;
      if (!visible || seen.has(r)) continue;
      seen.add(r);
      out.push(r);
    }
    return out;
  });
}

module.exports = {
  IGNORE, watch, watchViews, openRoute, expectRendered, expectAdminOpens, expectRefused,
  expectNoSideScroll, linkRoutes, assertClean, localeOf,
};
