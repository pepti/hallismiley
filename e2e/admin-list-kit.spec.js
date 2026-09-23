// The admin kit's DOM half, on a real list.
//
// The string builders are unit-tested (tests/unit/adminTableKit.test.js);
// testEnvironment is 'node' with no jsdom, so everything below — the delegated
// listeners, the URL sync, the remembered page size — can only be proved here.
//
// /admin/users is the subject because it IS the view the kit was extracted
// from: it was the only screen carrying a complete sort + pager set, so a
// regression shows up against a known-good baseline rather than a guess.
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { loginAsAdmin } = require('./helpers');

test.use({ viewport: { width: 1280, height: 900 } });

const TABLE = '.admin-users-table';
const SORT_BTN = (field) => `${TABLE} thead button[data-sort-field="${field}"]`;

test.describe('admin list kit — sorting', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/users');
    await expect(page.locator(TABLE)).toBeVisible();
  });

  test('a header click sorts, flips aria-sort, and shows in the URL', async ({ page }) => {
    const username = page.locator(`${TABLE} thead th`).filter({ has: page.locator('button[data-sort-field="username"]') });

    // Default is created_at desc, so username starts unsorted.
    await expect(username).toHaveAttribute('aria-sort', 'none');

    await page.click(SORT_BTN('username'));
    await expect(username).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=username/);
    await expect(page).toHaveURL(/dir=asc/);

    // Same column toggles rather than cycling through an unsorted state.
    await page.click(SORT_BTN('username'));
    await expect(username).toHaveAttribute('aria-sort', 'descending');

    // 'desc' IS the list default, so syncListState omits it — the URL stays
    // minimal and still round-trips, which is the property that matters.
    await expect(page).toHaveURL(/sort=username/);
    await expect(page).not.toHaveURL(/dir=/);
    await page.reload();
    await expect(
      page.locator(`${TABLE} thead th`).filter({ has: page.locator('button[data-sort-field="username"]') })
    ).toHaveAttribute('aria-sort', 'descending');
  });

  test('the sort survives a reload, because it lives in the URL', async ({ page }) => {
    await page.click(SORT_BTN('email'));
    await expect(page).toHaveURL(/sort=email/);

    await page.reload();
    const email = page.locator(`${TABLE} thead th`).filter({ has: page.locator('button[data-sort-field="email"]') });
    await expect(email).toHaveAttribute('aria-sort', 'ascending');
  });

  test('the header is keyboard-operable because it is a real button', async ({ page }) => {
    const btn = page.locator(SORT_BTN('username'));
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    const username = page.locator(`${TABLE} thead th`).filter({ has: page.locator('button[data-sort-field="username"]') });
    await expect(username).toHaveAttribute('aria-sort', 'ascending');
  });

  test('only one column claims the sort at a time', async ({ page }) => {
    await page.click(SORT_BTN('username'));
    await page.click(SORT_BTN('email'));
    await expect(page.locator(`${TABLE} thead th[aria-sort="ascending"], ${TABLE} thead th[aria-sort="descending"]`)).toHaveCount(1);
  });

  test('sorting does not stack listeners across repaints', async ({ page }) => {
    // The old code re-bound the thead on every _load(). If that regressed, the
    // nth click would fire n handlers and the direction would flip n times —
    // landing back where it started on even counts.
    for (let i = 0; i < 4; i++) await page.click(SORT_BTN('username'));
    const username = page.locator(`${TABLE} thead th`).filter({ has: page.locator('button[data-sort-field="username"]') });
    // 4 clicks from `none`: asc, desc, asc, desc.
    await expect(username).toHaveAttribute('aria-sort', 'descending');
  });
});

test.describe('admin list kit — pager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/users');
    await expect(page.locator(TABLE)).toBeVisible();
  });

  test('renders with a styled container, a range and a size picker', async ({ page }) => {
    const pager = page.locator('.admin-pagination');
    await expect(pager).toBeVisible();
    await expect(pager.locator('.admin-pagination__info')).toBeVisible();
    await expect(pager.locator('select[data-page-size]')).toBeVisible();

    // `.admin-pagination` had no CSS at all before the kit — both views that
    // used it rendered as unstyled inline buttons. Prove it is laid out now.
    await expect(pager).toHaveCSS('display', 'flex');
  });

  test('the glyph-only controls have accessible names and a live count', async ({ page }) => {
    const pager = page.locator('.admin-pagination');
    await expect(pager.locator('button[data-page]').first()).toHaveAttribute('aria-label', /.+/);
    await expect(pager.locator('.admin-pagination__count')).toHaveAttribute('aria-live', 'polite');
  });

  test('prev is disabled on the first page', async ({ page }) => {
    const prev = page.locator('.admin-pagination button[data-page]').first();
    await expect(prev).toBeDisabled();
  });

  test('the chosen page size is remembered across a navigation away and back', async ({ page }) => {
    const select = page.locator('select[data-page-size]');
    await select.selectOption('100');
    await expect(select).toHaveValue('100');

    await page.goto('/is/admin');
    await page.goto('/is/admin/users');
    await expect(page.locator('select[data-page-size]')).toHaveValue('100');
  });

  test('page size is NOT in the URL — it is a personal habit, not a shared one', async ({ page }) => {
    await page.locator('select[data-page-size]').selectOption('100');
    await expect(page).not.toHaveURL(/limit=|pageSize=/);
  });
});

test.describe('admin list kit — URL state', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/is/admin/users');
    await expect(page.locator(TABLE)).toBeVisible();
  });

  test('a pristine list has a clean URL — defaults are omitted', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/users$/);
  });

  test('search lands in the URL and survives a reload', async ({ page }) => {
    await page.fill('#users-search', 'admin');
    await expect(page).toHaveURL(/q=admin/, { timeout: 3000 });

    await page.reload();
    await expect(page.locator('#users-search')).toHaveValue('admin');
  });

  test('state changes REPLACE history rather than stacking entries', async ({ page }) => {
    // pushState per settled keystroke would bury the page the user came from,
    // and every spec that calls goBack() would start failing.
    await page.goto('/is/admin');
    await page.goto('/is/admin/users');
    await page.click(SORT_BTN('username'));
    await expect(page).toHaveURL(/sort=username/);

    await page.goBack();
    await expect(page).toHaveURL(/\/admin$/);
  });
});
