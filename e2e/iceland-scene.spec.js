// Iceland scene engine — the photographic layer behind the public pages
// (public/js/scenes/, chunk 1: home). Covers what the unit level can't: real
// image loading, per-theme grading reaching the pixel, the reduced-motion
// static path, and accessibility over photographs.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// The session-restore authchange re-renders the view shortly after load, which
// restarts the .view fade. Anything that measures computed styles (axe,
// contrast) must let that settle first or it reads mid-animation values.
async function settle(page) {
  await page.waitForTimeout(2_000);
}

test.describe('Iceland scene — home', () => {
  test('scene renders: photo loaded, LQIP behind it, place chip visible', async ({ page }) => {
    // Resource 404s (e.g. the optional home_hero content row that dev DBs
    // don't seed) are pre-existing noise — what this guards against is scene
    // engine exceptions.
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    const scene = page.locator('.lol-hero--scene .ice-scene');
    await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });

    // LQIP is present (inline data URI) and stays in the DOM as the fallback.
    const lqipBg = await scene.locator('.ice-scene__lqip').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(lqipBg).toContain('data:image/jpeg');

    await expect(scene.locator('.ice-scene__chip')).toBeVisible();
    await expect(scene.locator('.ice-scene__chip')).toHaveText('Skógafoss — Suðurland');

    // Section bands mount their scenes when scrolled near; force it.
    await page.locator('.home-steps').scrollIntoViewIfNeeded();
    await expect(page.locator('.home-tiers .ice-scene__img')).toBeAttached({ timeout: 10_000 });

    expect(errors, `Unexpected JS errors: ${errors.join(', ')}`).toEqual([]);
  });

  test('the mono theme grades the photograph to grayscale', async ({ page }) => {
    // Theme set the way a visitor's choice persists (localStorage +
    // theme-boot pre-paint) — setting the attribute after load loses a race
    // with themePrefs.applyTheme() on the session-restore authchange.
    await page.addInitScript(() => localStorage.setItem('ws_theme', 'mono'));
    await page.goto('/');
    const img = page.locator('.lol-hero--scene .ice-scene__img');
    await expect(img).toBeAttached({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('mono');
    const filter = await img.evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('grayscale(1)');
  });

  test('reduced motion: no Ken Burns, page still fully rendered', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const img = page.locator('.lol-hero--scene .ice-scene__img');
    await expect(img).toBeVisible({ timeout: 10_000 });
    expect(await img.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    // The scene is still there — motion off never means content off.
    await expect(page.locator('.lol-hero--scene .ice-scene')).toHaveClass(/is-loaded/);
    await expect(page.locator('.lol-hero__title')).toBeVisible();
  });

  test('has no detectable accessibility violations over the photography', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lol-hero--scene .ice-scene')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    await settle(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test('photo credits are linked and served', async ({ page }) => {
    // CC BY attribution: the legal row links the generated credits file.
    await page.goto('/');
    const link = page.locator('.lol-footer__legal-link[href="/assets/iceland/CREDITS.md"]');
    await expect(link).toBeAttached();
    const res = await page.request.get('/assets/iceland/CREDITS.md');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('CC BY');
  });
});
