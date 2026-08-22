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

// Home reverted to the hallismiley video hero (2026-08-22) — the engine's
// generic behaviours (LQIP, theme grading, reduced motion, a11y) are covered
// on /is/thjonusta's Sigöldugljúfur band instead. Scene mode on the home hero
// itself remains admin-selectable but is no longer the tested default.
test.describe('Iceland scene — engine behaviours (on /is/thjonusta)', () => {
  test('scene renders: photo loaded, LQIP behind it, place chip visible', async ({ page }) => {
    // What this guards against is scene engine exceptions, not resource noise.
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/is/thjonusta');
    const scene = page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]');
    await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });

    // LQIP is present (inline data URI) and stays in the DOM as the fallback.
    const lqipBg = await scene.locator('.ice-scene__lqip').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(lqipBg).toContain('data:image/jpeg');

    await expect(scene.locator('.ice-scene__chip')).toBeVisible();
    await expect(scene.locator('.ice-scene__chip')).toHaveText('Sigöldugljúfur — Hálendið');

    expect(errors, `Unexpected JS errors: ${errors.join(', ')}`).toEqual([]);
  });

  test('the mono theme grades the photograph to grayscale', async ({ page }) => {
    // Theme set the way a visitor's choice persists (localStorage +
    // theme-boot pre-paint) — setting the attribute after load loses a race
    // with themePrefs.applyTheme() on the session-restore authchange.
    await page.addInitScript(() => localStorage.setItem('ws_theme', 'mono'));
    await page.goto('/is/thjonusta');
    const img = page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"] .ice-scene__img');
    await expect(img).toBeAttached({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('mono');
    const filter = await img.evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('grayscale(1)');
  });

  test('reduced motion: no Ken Burns, page still fully rendered', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/is/thjonusta');
    const img = page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"] .ice-scene__img');
    await expect(img).toBeVisible({ timeout: 10_000 });
    expect(await img.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    // The scene is still there — motion off never means content off.
    await expect(page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]')).toHaveClass(/is-loaded/);
    await expect(page.locator('h1.thjonusta-title')).toBeVisible();
  });

  test('has no detectable accessibility violations over the photography', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
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

// ── Chunk 2: inner pages + View Transitions ─────────────────────────────────
test.describe('Iceland scene — inner pages', () => {
  const pages = [
    ['/is/thjonusta', 'sigoldugljufur', 'Sigöldugljúfur — Hálendið', 'h1.thjonusta-title'],
    ['/is/um-okkur', 'glacier', 'Svínafellsjökull — Öræfi', 'h1.um-okkur-title'],
    ['/is/verkefni', 'landmannalaugar', 'Landmannalaugar — Fjallabak', 'h1.thjonusta-title'],
  ];
  for (const [path, image, chip, h1sel] of pages) {
    test(`${path} wears its landscape with the h1 on the band`, async ({ page }) => {
      await page.goto(path);
      const scene = page.locator(`.ice-scene--bleed[data-scene="${image}"]`);
      await expect(scene).toBeVisible();
      await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });
      await expect(scene.locator('.ice-scene__chip')).toHaveText(chip);
      // The h1 lives ON the band's frost panel, inside #main-content.
      await expect(page.locator(`#main-content ${h1sel}`)).toBeVisible();
    });
  }

  test('/is/hafa-samband mounts Reynisfjara inside the editable hero untouched', async ({ page }) => {
    await page.goto('/is/hafa-samband');
    const hero = page.locator('.contact-hero');
    await expect(hero).toHaveClass(/contact-hero--scene/);
    await expect(hero.locator('.contact-hero__bg .ice-scene')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    // The admin-editable field tree is byte-identical: the scene lives inside
    // the decoration node, and every data-field still renders.
    await expect(hero.locator('[data-field="title_accent"]')).toBeVisible();
    await expect(page.locator('.contact-form')).toBeVisible();
  });

  test('SPA navigation between scene pages leaves no leaked observers or errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    // Start on the (sceneless, video-hero) home and walk every scene page
    // via the SPA (View Transitions where supported, plain swap elsewhere —
    // both must land cleanly).
    await page.goto('/is/');
    await expect(page.locator('video.lol-hero__bg')).toBeAttached({ timeout: 10_000 });
    for (const link of ['thjonusta', 'verkefni', 'um-okkur', 'hafa-samband']) {
      await page.locator(`.lol-nav__link[data-route="/${link}"]`).first().click();
      await expect(page.locator('.ice-scene').first()).toBeVisible({ timeout: 10_000 });
    }
    expect(errors, `Unexpected JS errors: ${errors.join(', ')}`).toEqual([]);
  });
});

// ── Chunk 3: live ambience ──────────────────────────────────────────────────
test.describe('Live Iceland ambience', () => {
  test('the weather endpoint answers 200 whatever happens upstream', async ({ page }) => {
    const res = await page.request.get('/api/v1/ambience');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.available).toBe('boolean');
    if (body.available) {
      expect(['clear', 'cloudy', 'rain', 'snow', 'fog']).toContain(body.condition);
    }
  });

  test('the ambience toggle flips body.amb-off and persists across reloads', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    await expect(page.locator('body')).not.toHaveClass(/amb-off/);

    await page.locator('.theme-switcher__fab').click();
    const toggle = page.locator('.theme-switcher__amb .theme-switcher__toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true'); // on by default
    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/amb-off/);
    expect(await page.evaluate(() => localStorage.getItem('ws_ambience'))).toBe('0');

    await page.reload();
    await expect(page.locator('body')).toHaveClass(/amb-off/, { timeout: 10_000 });
    // Scene still renders — ambience off means static, never absent.
    await expect(page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
  });

  test('the sun phase lands on the body while ambience is on', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    // The engine dynamic-imports after mount; give it a beat.
    await expect(page.locator('body[data-amb-phase]')).toBeAttached({ timeout: 10_000 });
    const phase = await page.evaluate(() => document.body.dataset.ambPhase);
    expect(['day', 'golden', 'blue', 'night']).toContain(phase);
  });

  test('reduced motion keeps the whole live layer off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="sigoldugljufur"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.body.dataset.ambPhase)).toBeUndefined();
    // The fx canvas never wakes up.
    expect(await page.locator('.ice-scene--bleed .ice-scene__fx').first().isHidden()).toBe(true);
  });
});
