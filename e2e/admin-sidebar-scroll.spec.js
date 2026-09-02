// The admin sidebar scrolls on its own instead of pushing the page (ice #204).
//
// The nav has outgrown one screen (bookkeeping, handbook and product-governance
// groups). Before this fix the sticky aside had no height cap, so reaching the
// last entries meant scrolling the whole page to the bottom — and the row-tint
// popover on a bottom row rendered off the visible box. Pinned at a short
// viewport so the overflow is guaranteed regardless of how many groups exist.
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.use({ viewport: { width: 1280, height: 620 } });

const ASIDE = '.admin-sidebar';

test.describe('admin nav — self-scrolling sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator(ASIDE)).toBeVisible();
  });

  test('the aside is a capped scroll container and the page itself does not grow to fit it', async ({ page }) => {
    const m = await page.locator(ASIDE).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        overflowY:    cs.overflowY,
        maxHeightSet: cs.maxHeight !== 'none',
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        viewport:     window.innerHeight,
        pageScrollY:  window.scrollY,
      };
    });
    expect(m.overflowY).toBe('auto');
    expect(m.maxHeightSet).toBe(true);
    // Fits inside the viewport (cap works) while carrying more than it shows.
    expect(m.clientHeight).toBeLessThan(m.viewport);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
  });

  test('the last nav entry is reachable by scrolling the aside alone', async ({ page }) => {
    const last = page.locator(`${ASIDE} a.admin-sidebar__item`).last();
    const before = await page.evaluate(() => window.scrollY);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // The aside scrolled; the document did not have to.
    const asideScrolled = await page.locator(ASIDE).evaluate(el => el.scrollTop > 0);
    expect(asideScrolled).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });

  test('the row-tint popover on a bottom row stays inside the visible aside', async ({ page }) => {
    await page.click('[data-testid="admin-nav-edit-toggle"]');
    await expect(page.locator('.admin-sidebar--editing')).toBeVisible();
    const trig = page.locator(`${ASIDE} [data-tint-btn]`).last();
    await trig.scrollIntoViewIfNeeded();
    await trig.click();
    const pop = page.locator('.admin-sidebar__tint-pop');
    await expect(pop).toBeVisible();
    const inside = await page.evaluate(() => {
      const a = document.querySelector('.admin-sidebar').getBoundingClientRect();
      const p = document.querySelector('.admin-sidebar__tint-pop').getBoundingClientRect();
      return p.top >= a.top - 1 && p.bottom <= a.bottom + 1;
    });
    expect(inside).toBe(true);
  });
});
