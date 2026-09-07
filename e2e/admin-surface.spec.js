// The instance-level hidden set for the admin sidebar (2026-09-07): the
// retail screens the base ships are hidden from the everyday nav by policy
// (public/js/components/adminSurface.js), stay live at their URLs and
// grantable to roles, and can be revealed per admin in edit mode. Plus the
// /admin dashboard's move from the portfolio projects board to the company
// overview (the board lives on, unlisted, at /admin/projects).
//
// The admin's layout blob is shared across specs, so every test starts AND
// ends on Reset — a leaked `revealedItems` would change the anchor counts
// other specs assert on.
const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');

const ORDERS_LINK = '.admin-sidebar a[data-route="/admin/shop/orders"]';
const PAYROLL_LINK = '.admin-sidebar a[data-route="/admin/books/payroll"]';
const EDIT_TOGGLE = '[data-testid="admin-nav-edit-toggle"]';

// Edit mode is a desktop affordance (the toggle is hidden under 640px).
test.use({ viewport: { width: 1280, height: 900 } });

async function gotoAndSettle(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

async function enterEditMode(page) {
  await page.click(EDIT_TOGGLE);
  await expect(page.locator('.admin-sidebar--editing')).toBeVisible();
}

async function leaveEditMode(page) {
  await page.click(EDIT_TOGGLE);
  await expect(page.locator('.admin-sidebar--editing')).toHaveCount(0);
}

// Reset re-renders the nav but stays in edit mode.
async function resetLayout(page) {
  await enterEditMode(page);
  await page.click('[data-nav-reset]');
  await expect(page.locator('.admin-sidebar__item[data-tint]')).toHaveCount(0);
  await leaveEditMode(page);
}

test.describe('admin nav — hidden-by-policy retail lines', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await gotoAndSettle(page, '/admin');
    await resetLayout(page);
  });

  test.afterEach(async ({ page }) => {
    await gotoAndSettle(page, '/admin');
    await resetLayout(page);
  });

  test('the everyday nav shows the business, not the shop', async ({ page }) => {
    await expect(page.locator(ORDERS_LINK)).toHaveCount(0);
    await expect(page.locator('.admin-sidebar a[data-route="/admin/shop/products"]')).toHaveCount(0);
    await expect(page.locator('.admin-sidebar a[data-route="/admin/books/pos"]')).toHaveCount(0);
    // No orphan "Verslun" header for an all-hidden group.
    await expect(page.locator('.admin-sidebar__group-title', { hasText: /^Verslun$/ })).toHaveCount(0);
    // Payroll stays (Halli), and the business groups are there.
    await expect(page.locator(PAYROLL_LINK)).toHaveCount(1);
    await expect(page.locator('.admin-sidebar a[data-route="/admin/handbok"]')).toHaveCount(1);
    await expect(page.locator('.admin-sidebar a[data-route="/admin/feedback"]')).toHaveCount(1);
  });

  test('an admin can reveal a hidden line in edit mode, it persists, and Reset re-hides it', async ({ page }) => {
    await enterEditMode(page);
    const row = page.locator('[data-item-id="orders"]');
    await expect(row).toHaveClass(/admin-sidebar__item--hidden/);
    await expect(page.locator('[data-item-hide="orders"]')).toHaveAttribute('aria-pressed', 'true');

    await page.click('[data-item-hide="orders"]');
    await expect(page.locator('[data-item-hide="orders"]')).toHaveAttribute('aria-pressed', 'false');
    await leaveEditMode(page);
    await expect(page.locator(ORDERS_LINK)).toHaveCount(1);

    // Full reload: the reveal rode the debounced PATCH into users.admin_nav_config.
    await gotoAndSettle(page, '/admin');
    await expect(page.locator(ORDERS_LINK)).toHaveCount(1);

    // Reset returns to the instance policy.
    await resetLayout(page);
    await expect(page.locator(ORDERS_LINK)).toHaveCount(0);
  });

  test('a hidden screen still renders at its URL and shows itself as the current page', async ({ page }) => {
    await gotoAndSettle(page, '/admin/shop/orders');
    await expect(page.locator(`${ORDERS_LINK}[aria-current="page"]`)).toHaveCount(1);
    await expect(page.locator('.admin-sidebar__group-title', { hasText: /^Verslun$/ })).toHaveCount(1);
  });

  test('/admin is the company overview; the projects board lives at /admin/projects', async ({ page }) => {
    await expect(page.locator('.dash-card').first()).toBeVisible();
    await expect(page.locator('#add-project-btn')).toHaveCount(0);
    // Cards resolve — no card is left on its loading line.
    await expect(page.locator('.dash-card__loading')).toHaveCount(0, { timeout: 15_000 });

    await gotoAndSettle(page, '/admin/projects');
    await expect(page.locator('#add-project-btn')).toBeVisible();
    await expect(page.locator('.dash-card')).toHaveCount(0);
  });
});

// A role that holds ONLY a policy-hidden view must still see it: the policy
// applies to accounts holding every view ('*'), never to an explicit grant.
test.describe('admin nav — a role granted only a hidden view', () => {
  const ROLE = 'e2eorders';
  const USER = { username: 'e2eorders', email: 'orders@e2e.test', password: 'OrdersPass123' };

  test.beforeAll(async () => {
    const { Scrypt } = require('oslo/password');
    const hash = await new Scrypt().hash(USER.password);
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query(
        `INSERT INTO roles (name, description, view_access, is_system)
         VALUES ($1, 'e2e: orders only', '["orders"]'::jsonb, FALSE)
         ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
        [ROLE]
      );
      await pool.query(
        `INSERT INTO users (email, username, password_hash, role, email_verified)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
        [USER.email, USER.username, hash, ROLE]
      );
    } finally {
      await pool.end();
    }
  });

  test('lands on Pantanir with a one-item sidebar', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="nav-signin"]').click();
    await page.fill('#login-username', USER.username);
    await page.fill('#login-password', USER.password);
    await page.click('.login-form [type=submit]');
    await page.waitForSelector('[data-testid="nav-user-btn"]', { timeout: 10_000 });

    await page.goto('/#/admin');
    await page.waitForURL('**/admin/shop/orders', { timeout: 10_000 });
    const items = page.locator('.admin-sidebar a.admin-sidebar__item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveAttribute('data-route', '/admin/shop/orders');
  });
});
