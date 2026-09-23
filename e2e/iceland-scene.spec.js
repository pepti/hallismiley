// Iceland scene engine — the photographic layer behind the public pages
// (public/js/scenes/, chunk 1: home). Covers what the unit level can't: real
// image loading, per-theme grading reaching the pixel, the reduced-motion
// static path, and accessibility over photographs.
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const AxeBuilder = require('@axe-core/playwright').default;
const { loginAsAdmin } = require('./helpers');
// The theme set and the public nav are the product's (config/client.json):
// the contrast grade is pinned only where Miðnætti is offered, and the SPA
// walk follows whatever nav routes wear a scene.
const { identity } = require('./lib/identity');
const { ROUTE_SCENE_IMAGES } = require('../server/config/sceneRoutes');

// The session-restore authchange re-renders the view shortly after load, which
// restarts the .view fade. Anything that measures computed styles (axe,
// contrast) must let that settle first or it reads mid-animation values.
async function settle(page) {
  await page.waitForTimeout(2_000);
}

// Home reverted to the hallismiley video hero (2026-08-22) — the engine's
// generic behaviours (LQIP, theme grading, reduced motion, a11y) are covered
// on /is/thjonusta's band instead (the canyon river since iceland-v2). Scene mode on the home hero
// itself remains admin-selectable but is no longer the tested default.
test.describe('Iceland scene — engine behaviours (on /is/thjonusta)', () => {
  test('scene renders: photo loaded, LQIP behind it, no place chip', async ({ page }) => {
    // What this guards against is scene engine exceptions, not resource noise.
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/is/thjonusta');
    const scene = page.locator('.ice-scene--bleed[data-scene="canyon-river"]');
    await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });

    // LQIP is present (inline data URI) and stays in the DOM as the fallback.
    const lqipBg = await scene.locator('.ice-scene__lqip').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(lqipBg).toContain('data:image/jpeg');

    // iceland-v2 (2026-09-22): the images are AI-generated landforms, not
    // real places, so the place chip is gone — naming one would be false.
    await expect(scene.locator('.ice-scene__chip')).toHaveCount(0);

    expect(errors, `Unexpected JS errors: ${errors.join(', ')}`).toEqual([]);
  });

  test('the high-contrast theme grades the photograph for contrast', async ({ page }) => {
    // Theme set the way a visitor's choice persists (localStorage +
    // theme-boot pre-paint) — setting the attribute after load loses a race
    // with themePrefs.applyTheme() on the session-restore authchange.
    // (Was the mono grayscale check; mono retired 2026-09-02, Miðnætti took
    // over the contrast job and its grade is what this now pins.) The grade
    // is Miðnætti's, so the pin only applies where the product's picker
    // offers it — a downstream with its own theme set has nothing to pin here.
    test.skip(!identity.theme.picker.includes('midnight'), 'this product does not offer the midnight theme (identity.theme.picker)');
    await page.addInitScript(() => localStorage.setItem('ws_theme', 'midnight'));
    await page.goto('/is/thjonusta');
    const img = page.locator('.ice-scene--bleed[data-scene="canyon-river"] .ice-scene__img');
    await expect(img).toBeAttached({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('midnight');
    const filter = await img.evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('contrast(1.15)');
  });

  test('reduced motion: no Ken Burns, page still fully rendered', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/is/thjonusta');
    const img = page.locator('.ice-scene--bleed[data-scene="canyon-river"] .ice-scene__img');
    await expect(img).toBeVisible({ timeout: 10_000 });
    expect(await img.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    // The scene is still there — motion off never means content off.
    await expect(page.locator('.ice-scene--bleed[data-scene="canyon-river"]')).toHaveClass(/is-loaded/);
    await expect(page.locator('h1.thjonusta-title')).toBeVisible();
  });

  test('has no detectable accessibility violations over the photography', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="canyon-river"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    await settle(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test('photo credits are linked and served', async ({ page }) => {
    // Attribution: the legal row links the generated credits file (the
    // images are Orange Smiley's own AI generations since 2026-09-22).
    await page.goto('/');
    const link = page.locator('.lol-footer__legal-link[href="/assets/iceland/CREDITS.md"]');
    await expect(link).toBeAttached();
    const res = await page.request.get('/assets/iceland/CREDITS.md');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Orange Smiley ehf.');
  });
});

// ── Chunk 2: inner pages + View Transitions ─────────────────────────────────
test.describe('Iceland scene — inner pages', () => {
  // Every visitor-facing band page since iceland-v2 (2026-09-22).
  const pages = [
    ['/is/thjonusta', 'canyon-river', 'h1.thjonusta-title'],
    ['/is/um-okkur', 'glacier-tongue', 'h1.um-okkur-title'],
    ['/is/verkefni', 'rhyolite-ridges', 'h1.thjonusta-title'],
    ['/is/personuvernd', 'cave-falls', 'h1.legal-title'],
    ['/is/terms', 'basalt-canyon', 'h1.legal-title'],
    ['/is/engin-slik-sida', 'braided-sand', 'h1.not-found__title'],
  ];
  for (const [path, image, h1sel] of pages) {
    test(`${path} wears its landscape with the h1 on the band`, async ({ page }) => {
      await page.goto(path);
      const scene = page.locator(`.ice-scene--bleed[data-scene="${image}"]`);
      await expect(scene).toBeVisible();
      await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });
      // The h1 lives ON the band's panel, inside #main-content.
      await expect(page.locator(`#main-content ${h1sel}`)).toBeVisible();
    });
  }

  // The legal headings are one long word each in Icelandic (PERSÓNUVERNDAR-
  // STEFNA, NOTKUNARSKILMÁLAR). Down to 320px they must render on ONE line —
  // a mid-word break is a bug (rekstrarkerfid's qa-chrome-findings found the
  // 1.2rem floor wrapping it; rk-feed 2026-09-23). In English the titles are
  // two words and may wrap at the space, but never overflow the panel.
  test('the legal headings fit on one line at 320px and 375px — no mid-word break', async ({ page }) => {
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/is/personuvernd', '/is/terms']) {
        await page.goto(path);
        const h1 = page.locator('h1.legal-title');
        await expect(h1).toBeVisible();
        const lines = await h1.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
        });
        expect(lines, `${path} at ${width}px`).toBe(1);
        const fits = await h1.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
        expect(fits, `${path} at ${width}px overflows`).toBe(true);
      }
      for (const path of ['/en/personuvernd', '/en/terms']) {
        await page.goto(path);
        const h1 = page.locator('h1.legal-title');
        await expect(h1).toBeVisible();
        // Every word intact: each word's rects share one top, and the heading
        // does not overflow its panel.
        const wordsIntact = await h1.evaluate((el) => {
          const text = el.textContent;
          const node = el.firstChild;
          if (!node || node.nodeType !== Node.TEXT_NODE) return true;
          let ok = true;
          const re = /\S+/g;
          let m;
          while ((m = re.exec(text))) {
            const range = document.createRange();
            range.setStart(node, m.index);
            range.setEnd(node, m.index + m[0].length);
            const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            if (tops.size > 1) ok = false;
          }
          return ok && el.scrollWidth <= el.clientWidth + 1;
        });
        expect(wordsIntact, `${path} at ${width}px`).toBe(true);
      }
    }
  });

  test('/is/profile moves its header onto the hot spring, listeners intact', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/profile');
    const scene = page.locator('.ice-scene--bleed[data-scene="hot-spring"]');
    await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });
    await expect(scene.locator('h1.profile-header__username')).toBeVisible();
    // The header node was MOVED, not re-rendered — its bound button still works.
    await scene.locator('#profile-edit-btn').click();
    await expect(page.locator('#edit-section')).toBeVisible();
  });

  // The card pages: the scene fills the page behind the frosted card.
  for (const [path, image, cardSel] of [
    ['/is/signup', 'moss-falls', '.signup-card'],
    ['/is/forgot-password', 'snow-rapids', '.auth-card'],
    ['/is/reset-password', 'snow-rapids', '.auth-card'],
    ['/is/verify-email', 'snow-rapids', '.auth-card'],
  ]) {
    test(`${path} sits on its landscape behind the card`, async ({ page }) => {
      await page.goto(path);
      const scene = page.locator(`.scene-page > .ice-scene--backdrop[data-scene="${image}"]`);
      await expect(scene).toHaveClass(/is-loaded/, { timeout: 10_000 });
      await expect(page.locator(cardSel)).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();
    });
  }

  test('/is/hafa-samband mounts its beach inside the editable hero untouched', async ({ page }) => {
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
    // The nav is the product's (identity.surface.nav); walk the links that
    // lead to a scene page (server/config/sceneRoutes.js).
    const sceneLinks = identity.surface.nav
      .filter((e) => ROUTE_SCENE_IMAGES[e.route] && !identity.surface.hiddenRoutes.includes(e.route))
      .map((e) => e.route);
    test.skip(sceneLinks.length === 0, 'this product links no scene page from its nav');
    await page.goto('/is/');
    await expect(page.locator('video.lol-hero__bg')).toBeAttached({ timeout: 10_000 });
    for (const route of sceneLinks) {
      await page.locator(`.lol-nav__link[data-route="${route}"]`).first().click();
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
    await expect(page.locator('.ice-scene--bleed[data-scene="canyon-river"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
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
    await expect(page.locator('.ice-scene--bleed[data-scene="canyon-river"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
  });

  test('the sun phase lands on the body while ambience is on', async ({ page }) => {
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="canyon-river"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    // The engine dynamic-imports after mount; give it a beat.
    await expect(page.locator('body[data-amb-phase]')).toBeAttached({ timeout: 10_000 });
    const phase = await page.evaluate(() => document.body.dataset.ambPhase);
    expect(['day', 'golden', 'blue', 'night']).toContain(phase);
  });

  test('reduced motion keeps the whole live layer off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/is/thjonusta');
    await expect(page.locator('.ice-scene--bleed[data-scene="canyon-river"]')).toHaveClass(/is-loaded/, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.body.dataset.ambPhase)).toBeUndefined();
    // The fx canvas never wakes up.
    expect(await page.locator('.ice-scene--bleed .ice-scene__fx').first().isHidden()).toBe(true);
  });
});
