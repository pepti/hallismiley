const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin, createTestUser } = require('./helpers');

/**
 * The landing-page background editor, surfaced in Profile settings for admins
 * (the placement icelandicstore uses). The same component backs
 * /admin/background, so this spec covers both mount points.
 *
 * The security assertions are the point: the client gate is cosmetic, so the
 * test also calls the API directly as a non-admin — a UI-only check would pass
 * even if the endpoint were wide open.
 */
test.describe('Landing background editor', () => {

  test('admin sees the editor in Profile settings', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/profile');
    await expect(page.locator('.bg-admin')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#bg-mode')).toBeVisible();
    await expect(page.locator('#bg-veil')).toBeVisible();
    await expect(page.locator('#bg-upload')).toBeAttached();
  });

  test('saving from Profile changes what the public landing config reports', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/profile');
    await page.waitForSelector('#bg-mode', { timeout: 10_000 });

    const original = await page.locator('#bg-mode').inputValue();
    try {
      await page.selectOption('#bg-mode', 'plain');
      await page.locator('#bg-save').click();
      await expect(page.locator('#bg-status')).not.toBeEmpty({ timeout: 10_000 });

      const cfg = await page.evaluate(() =>
        fetch('/api/v1/content/landing_background?locale=en').then(r => r.json()));
      expect(cfg.mode).toBe('plain');
    } finally {
      // Leave the shared dev/e2e database as we found it — other specs assert
      // on the hero, and the home page reads this row.
      await page.selectOption('#bg-mode', original);
      await page.locator('#bg-save').click();
      await page.waitForTimeout(500);
    }
  });

  test('the same editor backs the standalone admin page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/background');
    await expect(page.locator('.bg-admin')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#bg-mode')).toBeVisible();
  });

  test('a non-admin gets neither the UI nor the API', async ({ page }) => {
    await createTestUser(page);
    await page.goto('/is/profile');
    await page.waitForSelector('.profile-container', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('.bg-admin')).toHaveCount(0);

    // The client gate is cosmetic — the endpoint itself must refuse.
    const status = await page.evaluate(() =>
      fetch('/api/v1/admin/background/landing', { credentials: 'include' }).then(r => r.status));
    expect([401, 403]).toContain(status);
  });

});

/**
 * The background library manager (sections + media), the second admin-only
 * component on the same two surfaces. Covers the full round trip an admin
 * actually performs — create a section, upload media into it, reorder, delete —
 * and proves the reorder survives a reload rather than only repainting.
 */
test.describe('Background library', () => {
  // 1×1 transparent PNG — the upload filter checks the MIME type, not the pixels.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const upload = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

  // Read the media ids of one section's grid, in painted order.
  const idsIn = (page, sectionId) =>
    page.locator(`.bg-lib-admin__grid[data-section-id="${sectionId}"] .bg-lib-admin__item`)
      .evaluateAll(els => els.map(el => el.dataset.mediaId));

  test('admin creates a section, uploads into it, reorders and deletes', async ({ page }) => {
    // Every confirm() in the component is a delete guard — accept them all.
    page.on('dialog', d => d.accept());

    await loginAsAdmin(page);
    await page.goto('/is/profile');
    await page.waitForSelector('.bg-lib-admin__toolbar', { timeout: 10_000 });

    const name = `E2E section ${Date.now()}`;
    let sectionId = null;
    try {
      // ── Create ────────────────────────────────────────────────────────────
      const groupsBefore = await page.locator('.bg-lib-admin__group').count();
      await page.fill('#bg-lib-new-section', name);
      await page.click('#bg-lib-add-section');
      await expect(page.locator('.bg-lib-admin__group')).toHaveCount(groupsBefore + 1);

      // New sections are appended, so the new group is the last one.
      const group = page.locator('.bg-lib-admin__group').last();
      sectionId = await group.getAttribute('data-section-id');
      expect(sectionId).toBeTruthy();
      await expect(group.locator('input[data-field="name"]')).toHaveValue(name);

      // ── Upload into that section ──────────────────────────────────────────
      await page.selectOption('#bg-lib-target', sectionId);
      await page.setInputFiles('#bg-lib-file', [upload('bg-one.png'), upload('bg-two.png')]);
      await expect(group.locator('.bg-lib-admin__item')).toHaveCount(2, { timeout: 20_000 });

      // Assignment is server-side, not just a client repaint.
      const assigned = await page.evaluate(async (sid) => {
        const media = await fetch('/api/v1/admin/background/media', { credentials: 'include' }).then(r => r.json());
        return media.filter(m => String(m.section_id) === String(sid)).length;
      }, sectionId);
      expect(assigned).toBe(2);

      // ── Reorder ───────────────────────────────────────────────────────────
      const before = await idsIn(page, sectionId);
      expect(before).toHaveLength(2);
      await group.locator('.bg-lib-admin__item').first().locator('[data-act="m-fwd"]').click();
      await expect
        .poll(() => idsIn(page, sectionId))
        .toEqual([before[1], before[0]]);

      // …and it persisted — a repaint alone would not survive this.
      await page.reload();
      await page.waitForSelector('.bg-lib-admin__toolbar', { timeout: 10_000 });
      await expect
        .poll(() => idsIn(page, sectionId), { timeout: 10_000 })
        .toEqual([before[1], before[0]]);

      // ── Delete media, then the section ────────────────────────────────────
      const liveGroup = page.locator(`.bg-lib-admin__group[data-section-id="${sectionId}"]`);
      await liveGroup.locator('.bg-lib-admin__item [data-act="m-del"]').first().click();
      await expect(liveGroup.locator('.bg-lib-admin__item')).toHaveCount(1);
      await liveGroup.locator('.bg-lib-admin__item [data-act="m-del"]').first().click();
      await expect(liveGroup.locator('.bg-lib-admin__item')).toHaveCount(0);

      await liveGroup.locator('[data-act="sec-del"]').click();
      await expect(page.locator(`.bg-lib-admin__group[data-section-id="${sectionId}"]`)).toHaveCount(0);
      sectionId = null;
    } finally {
      // Belt and braces: if an assertion failed mid-way, don't leave the shared
      // e2e database carrying a stray section and its uploads.
      if (sectionId) {
        await page.evaluate(async (sid) => {
          const media = await fetch('/api/v1/admin/background/media', { credentials: 'include' }).then(r => r.json());
          for (const m of media.filter(x => String(x.section_id) === String(sid))) {
            await fetch(`/api/v1/admin/background/media/${m.id}`, { method: 'DELETE', credentials: 'include' });
          }
          await fetch(`/api/v1/admin/background/sections/${sid}`, { method: 'DELETE', credentials: 'include' });
        }, sectionId);
      }
    }
  });

  test('the same library manager backs the standalone admin page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/background');
    await expect(page.locator('.bg-lib-admin')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#bg-lib-add-section')).toBeVisible();
    // The landing editor is still there, above it — porting the library must
    // not have cost the original surface.
    await expect(page.locator('#bg-mode')).toBeVisible();
  });

  test('a non-admin gets neither the library UI nor its API', async ({ page }) => {
    await createTestUser(page);
    await page.goto('/is/profile');
    await page.waitForSelector('.profile-container', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('.bg-lib-admin')).toHaveCount(0);

    // Assert the endpoints themselves, reads and writes alike — the missing UI
    // proves nothing about the server.
    const statuses = await page.evaluate(async () => {
      const calls = [
        ['GET',    '/api/v1/admin/background/library',  undefined],
        ['GET',    '/api/v1/admin/background/sections', undefined],
        ['POST',   '/api/v1/admin/background/sections', JSON.stringify({ name: 'nope' })],
        ['PATCH',  '/api/v1/admin/background/media/reorder', JSON.stringify({ order: [] })],
        ['PATCH',  '/api/v1/admin/background/library',  JSON.stringify({ enabled: true })],
      ];
      const out = [];
      for (const [method, url, body] of calls) {
        const res = await fetch(url, {
          method, credentials: 'include',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
        });
        out.push(res.status);
      }
      return out;
    });
    for (const status of statuses) expect([401, 403]).toContain(status);
  });

});
