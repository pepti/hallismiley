const { test, expect } = require('@playwright/test');
const { loginAsAdmin }  = require('./helpers');

// Regression: the news editor overlay is position:fixed but lived inside
// .view, whose fade-in animation filled forwards with a non-none transform —
// which made .view the overlay's containing block. The overlay was then sized
// to the page (scrolling with it) while the body was scroll-locked, so once
// the editor grew past the page height (many queued media) its footer — the
// Create Article button — could not be reached by scrolling.
test.describe('News editor overlay', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('scrolls to the footer with many queued media files', async ({ page }) => {
    await page.goto('/en/news');
    // Let the .view fade-in finish — while it runs, its transform is legitimately non-none.
    await page.locator('.view').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    await page.locator('#news-new-btn').click();

    const overlay = page.locator('#news-editor-overlay');
    await expect(overlay).toBeVisible();

    // The overlay must cover the viewport, not the page wrapper.
    const viewport = page.viewportSize();
    const box = await overlay.boundingBox();
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.height)).toBe(viewport.height);

    // Queue a stack of images so the editor is far taller than the viewport.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const files = Array.from({ length: 24 }, (_, i) => ({
      name: `pending-${String(i + 1).padStart(2, '0')}.png`, mimeType: 'image/png', buffer: png,
    }));
    await page.locator('#media-upload-image').setInputFiles(files);
    await expect(overlay.locator('.news-editor__media-pending-badge')).toHaveCount(24);

    // Scroll the way a person does — wheel over the overlay until it stops moving.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    let last = -1;
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 2000);
      const top = await overlay.evaluate(el => el.scrollTop);
      if (top === last) break;
      last = top;
    }

    // The footer button must now sit inside the viewport.
    const save = page.locator('#editor-save-btn');
    await expect(save).toBeVisible();
    const sb = await save.boundingBox();
    expect(sb.y).toBeGreaterThanOrEqual(0);
    expect(sb.y + sb.height).toBeLessThanOrEqual(viewport.height);
  });
});
