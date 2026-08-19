// Admin-nav row colours — the per-line tints an admin assigns in sidebar edit
// mode to group related lines as the menu grows.
//
// Persistence is the feature's whole value (the layout is stored per admin and
// syncs across devices), so the core assertion is that a colour picked in edit
// mode is still on the live nav link after a full page reload.
//
// Also covers the two picker interactions whose event ordering is easy to get
// wrong: the document-level `pointerdown` closer fires BEFORE the delegated
// click, so a naive implementation either swallows the selection or needs two
// clicks to move the popover between rows.
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// The base helpers have no gotoAndSettle — same behaviour inlined.
async function gotoAndSettle(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const ROW   = '[data-item-id="orders"]';
const TRIG  = '[data-tint-btn="orders"]';
const POP   = '.admin-sidebar__tint-pop';
const LINK  = '.admin-sidebar a[data-route="/admin/shop/orders"]';

// Edit mode is a desktop affordance (the toggle is hidden under 640px).
test.use({ viewport: { width: 1280, height: 900 } });

async function enterEditMode(page) {
  await page.click('[data-testid="admin-nav-edit-toggle"]');
  await expect(page.locator('.admin-sidebar--editing')).toBeVisible();
}

test.describe('admin nav — row colours', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await gotoAndSettle(page, '/admin');
    await enterEditMode(page);
    // Start from a known state — a previous test may have left tints behind.
    // Reset re-renders the nav but stays in edit mode, so don't re-toggle.
    await page.click('[data-nav-reset]');
    await expect(page.locator('.admin-sidebar__item[data-tint]')).toHaveCount(0);
  });

  test('a picked colour shows in view mode and survives a reload', async ({ page }) => {
    await page.click(TRIG);
    await expect(page.locator(POP)).toBeVisible();
    await page.click(`${POP} [data-tint-key="blue"]`);

    await expect(page.locator(ROW)).toHaveAttribute('data-tint', 'blue');
    await expect(page.locator(POP)).toBeHidden();

    // Leave edit mode — the tint must remain on the real nav link.
    await page.click('[data-testid="admin-nav-edit-toggle"]');
    await expect(page.locator(LINK)).toHaveAttribute('data-tint', 'blue');

    // Full reload: proves the debounced PATCH + cache round trip, not just
    // in-memory state.
    await gotoAndSettle(page, '/admin');
    await expect(page.locator(LINK)).toHaveAttribute('data-tint', 'blue');
  });

  test('the picker offers None + all 12 tints, and the new ones apply', async ({ page }) => {
    await page.click(TRIG);
    await expect(page.locator(`${POP} [data-tint-key]`)).toHaveCount(13);
    for (const key of ['red', 'rose', 'brown', 'amber', 'lime', 'green',
                       'teal', 'slate', 'blue', 'violet', 'fuchsia', 'pink']) {
      await expect(page.locator(`${POP} [data-tint-key="${key}"]`)).toHaveCount(1);
    }
    // Spot-check one of the five added in the second round, end to end.
    await page.click(`${POP} [data-tint-key="fuchsia"]`);
    await expect(page.locator(ROW)).toHaveAttribute('data-tint', 'fuchsia');
    await page.click('[data-testid="admin-nav-edit-toggle"]');
    await expect(page.locator(LINK)).toHaveAttribute('data-tint', 'fuchsia');
  });

  test('clearing a colour removes the tint', async ({ page }) => {
    await page.click(TRIG);
    await page.click(`${POP} [data-tint-key="green"]`);
    await expect(page.locator(ROW)).toHaveAttribute('data-tint', 'green');

    await page.click(TRIG);
    await page.click(`${POP} [data-tint-key="none"]`);
    await expect(page.locator(ROW)).not.toHaveAttribute('data-tint', /.*/);
  });

  test('the same trigger toggles the popover shut', async ({ page }) => {
    await page.click(TRIG);
    await expect(page.locator(POP)).toBeVisible();
    await page.click(TRIG);
    await expect(page.locator(POP)).toBeHidden();
  });

  test('moving to another row re-anchors in a single click', async ({ page }) => {
    await page.click(TRIG);
    const firstTop = await page.locator(POP).evaluate(el => el.style.top);

    await page.click('[data-tint-btn="products"]');           // exactly one click
    await expect(page.locator(POP)).toBeVisible();
    await expect(page.locator('[data-tint-btn="products"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(TRIG)).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator(POP).evaluate(el => el.style.top)).not.toBe(firstTop);
  });

  test('Escape closes the popover and returns focus to the trigger', async ({ page }) => {
    await page.click(TRIG);
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toBeHidden();
    await expect(page.locator(TRIG)).toBeFocused();
  });

  test('a tint survives dragging the row to another section', async ({ page }) => {
    await page.click(TRIG);
    await page.click(`${POP} [data-tint-key="violet"]`);
    await expect(page.locator(ROW)).toHaveAttribute('data-tint', 'violet');

    // renderNav() rebuilds the whole nav on drop — the tint must come back with it.
    await page.locator(`${ROW} [data-drag-handle]`).dragTo(page.locator('[data-item-id="users"]'));
    await expect(page.locator(ROW)).toHaveAttribute('data-tint', 'violet');
  });

  test('reset clears every colour', async ({ page }) => {
    await page.click(TRIG);
    await page.click(`${POP} [data-tint-key="red"]`);
    await expect(page.locator(ROW)).toHaveAttribute('data-tint', 'red');

    await page.click('[data-nav-reset]');
    await expect(page.locator('.admin-sidebar__item[data-tint]')).toHaveCount(0);
  });

  test('tinting adds no sidebar routes (guards the access-control counts)', async ({ page }) => {
    // e2e/access-control.spec.js asserts exact `.admin-sidebar [data-route]`
    // counts per role, so the tint must ride on the existing <a> and add nothing.
    const leaveEditMode = async () => {
      await page.click('[data-testid="admin-nav-edit-toggle"]');
      await expect(page.locator('.admin-sidebar--editing')).toHaveCount(0);
    };
    await leaveEditMode();
    const before = await page.locator('.admin-sidebar [data-route]').count();

    await enterEditMode(page);
    await page.click(TRIG);
    await page.click(`${POP} [data-tint-key="teal"]`);
    await leaveEditMode();

    await expect(page.locator(LINK)).toHaveAttribute('data-tint', 'teal');
    await expect(page.locator('[data-tint-btn]')).toHaveCount(0);   // picker is edit-mode only
    expect(await page.locator('.admin-sidebar [data-route]').count()).toBe(before);
  });
});
