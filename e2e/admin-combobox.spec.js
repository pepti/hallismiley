// The kit Combobox's DOM half (harvest 2 lane 4a; ported from icelandicstore
// #194/#351). The ranking and markup helpers are unit-tested
// (tests/unit/combobox.client.test.js); the listbox roles, the async source and
// the keyboard pick can only be proved in a browser.
//
// Subject: the member search on /admin/roles, the engine's async user (the
// server search is the combobox's source), and the expense supplier field,
// which replaced a native <datalist>.
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin, TEST_ADMIN } = require('./helpers');

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('Combobox — the member search on /admin/roles', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/roles');
    await page.click('.role-tab[data-tab="members"]');
    await expect(page.locator('#member-search')).toBeVisible();
  });

  test('is a real combobox: role, listbox, options, keyboard pick → one draggable chip', async ({ page }) => {
    const input = page.locator('#member-search');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    // Focus alone shows nothing: minQuery 1 — a server search needs a term.
    await input.focus();
    await expect(page.locator('.role-members .combobox__list')).toBeHidden();

    await input.fill(TEST_ADMIN.username.slice(0, 6));
    const list = page.locator('.role-members .combobox__list[role="listbox"]');
    await expect(list).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const opt = list.locator('[role="option"]').first();
    await expect(opt).toBeVisible();

    await input.press('ArrowDown');
    await expect(opt).toHaveClass(/is-active/);
    await expect(input).toHaveAttribute('aria-activedescendant', await opt.getAttribute('id'));

    await input.press('Enter');
    await expect(list).toBeHidden();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    const chips = page.locator('#member-search-results .role-chip-user[draggable="true"]');
    await expect(chips).toHaveCount(1);
  });

  test('an email-only match is kept (keywords) and Escape closes the list', async ({ page }) => {
    const input = page.locator('#member-search');
    // The admin's email domain matches on the server, not on the display name.
    await input.fill(TEST_ADMIN.email.split('@')[1]);
    const list = page.locator('.role-members .combobox__list');
    await expect(list.locator('[role="option"]').first()).toBeVisible();
    await input.press('Escape');
    await expect(list).toBeHidden();
  });
});

test.describe('Combobox — the expense supplier field', () => {
  test('replaced the native <datalist>', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/books/expenses');
    const input = page.locator('input[name="supplier_name"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).not.toHaveAttribute('list', /.+/);
    await expect(page.locator('datalist#exp-suppliers')).toHaveCount(0);
  });
});
