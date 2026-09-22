const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

/**
 * Admin inline editing on the home page.
 *
 * These tests used to drive the skills/stats editor (`edit-page-btn`). The
 * business home page no longer renders those portfolio sections, so their
 * editor has nothing to attach to — the editable surface that remains is the
 * hero, and it is the one that matters commercially (headline, sub-headline
 * and CTA label are the copy Halli will actually want to tune).
 *
 * The assertions are unchanged in intent: hidden from anonymous visitors,
 * offered to admins, activates contenteditable, shows a save/cancel bar, and
 * cancel reverts. The skills/stats content rows and their API still exist —
 * whether to surface them again is an ENHANCEMENTS.md decision, not something
 * this spec should assume either way.
 */
test.describe('Editable homepage', () => {

  test('Edit button NOT visible for logged-out users', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="edit-hero-btn"]')).toHaveCount(0);
  });

  test('Edit button IS visible for admin', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('[data-testid="edit-hero-btn"]')).toBeVisible();
  });

  test('clicking Edit activates contenteditable on hero fields', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-hero-btn"]').click();

    const first = page.locator('[data-hero-field]').first();
    await expect(first).toHaveAttribute('contenteditable', 'true');
  });

  test('edit bar (save/cancel) appears after clicking Edit', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-hero-btn"]').click();

    await expect(page.locator('[data-testid="edit-hero-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-hero-save"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-hero-cancel"]')).toBeVisible();
  });

  test('cancel reverts edited fields and hides the edit bar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('[data-testid="edit-hero-btn"]').click();

    const target   = page.locator('[data-hero-field="subtitle"]');
    const original = (await target.textContent()).trim();

    await target.fill('CHANGED_TEXT_XYZ');
    await page.locator('[data-testid="edit-hero-cancel"]').click();

    await expect(target).toHaveText(original);
    await expect(page.locator('[data-testid="edit-hero-controls"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="edit-hero-btn"]')).toBeVisible();
  });

});
