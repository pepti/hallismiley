// The roles × admin-screens grid and the one-customer edit dialog (harvest 2
// lane 3, 2026-09-26; the pattern of icelandicstore #421's grid and #336's
// customer edit). The server rules are proved in tests/integration
// (adminRoles.test.js, adminCustomers.test.js); what only a browser can show is
// that the grid collects a change, the save bar counts it, a save persists it,
// the phone layout shows one column, and the customer dialog round-trips.
//
// With L3_SHOTS=<dir> the last test also writes the review screenshots (three
// themes × desktop and 375px) there; without it that test is skipped.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec, skipUnless } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
const { loginAsAdmin } = require('./helpers');

const ROLE_LABEL = 'Bókari e2e';
const CUSTOMER_EMAIL = 'l3-customer@e2e.test';

async function db(fn) {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try { return await fn(pool); } finally { await pool.end(); }
}

// A clean slate: no leftover e2e role, one plain passwordless customer.
async function seed() {
  return db(async (pool) => {
    await pool.query(`DELETE FROM user_roles WHERE role_name LIKE 'bokari-e2e%'`);
    await pool.query(`DELETE FROM roles WHERE name LIKE 'bokari-e2e%'`);
    await pool.query('DELETE FROM users WHERE email = $1', [CUSTOMER_EMAIL]);
    const { rows } = await pool.query(
      `INSERT INTO users (email, username, password_hash, role, display_name, approval_status)
       VALUES ($1, 'l3customer', NULL, 'user', 'Jóna Kúnni', 'approved') RETURNING id`, [CUSTOMER_EMAIL]);
    return rows[0].id;
  });
}

test.describe('Roles grid (/admin/roles)', () => {
  skipUnless(test, 'rbac-roles');
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await seed();
    await loginAsAdmin(page);
    await page.goto('/is/admin/roles');
    await expect(page.locator('table.role-grid')).toBeVisible();
  });

  test('create by name, tick a screen, the save bar counts it, save persists, delete', async ({ page }) => {
    // The administrator column is locked on; there is no checkbox in it.
    await expect(page.locator('td[data-role="admin"] input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('td[data-role="user"] input[type="checkbox"]')).toHaveCount(0);

    await page.click('#role-new');
    await page.fill('#role-ed-label', ROLE_LABEL);
    await page.click('#role-ed-save');
    const head = page.locator('th.role-col[data-role="bokari-e2e"]');
    await expect(head).toContainText(ROLE_LABEL);

    const box = page.locator('input[data-role="bokari-e2e"][data-view="leads"]');
    await box.check();
    const bar = page.locator('#role-savebar');
    await expect(bar).toBeVisible();
    await expect(page.locator('#role-savebar-msg')).toContainText('1');
    await page.click('#role-save');
    await expect(bar).toBeHidden();

    await page.reload();
    await expect(page.locator('input[data-role="bokari-e2e"][data-view="leads"]')).toBeChecked();

    // Delete through the editor (nobody holds the role).
    page.once('dialog', d => d.accept());
    await page.click('[data-edit="bokari-e2e"]');
    await page.click('#role-ed-delete');
    await expect(page.locator('th.role-col[data-role="bokari-e2e"]')).toHaveCount(0);
  });

  test('a reserved name is refused with a message', async ({ page }) => {
    await page.click('#role-new');
    await page.fill('#role-ed-label', 'Stjórnandi');
    await page.click('#role-ed-save');
    await expect(page.locator('#role-ed-error')).not.toBeEmpty();
  });
});

test.describe('Roles grid on a phone', () => {
  skipUnless(test, 'rbac-roles');
  // Signed in at desktop width (the phone nav folds the sign-in button away),
  // then narrowed.
  test.use({ viewport: { width: 1280, height: 900 } });

  test('one role column at a time, picked with the combobox; no sideways page scroll', async ({ page }) => {
    await seed();
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/is/admin/roles');
    await expect(page.locator('table.role-grid')).toBeVisible();
    const visibleCols = page.locator('th.role-col:visible');
    await expect(visibleCols).toHaveCount(1);
    const input = page.locator('#role-narrow-input');
    await input.focus();
    await page.locator('.role-narrow-pick .combobox__opt').first().click();
    await expect(visibleCols).toHaveCount(1);
    await expect(page.locator('th.role-col:visible')).toHaveAttribute('data-role', 'admin');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Nothing on the page pokes past its own right edge either: a button that
    // sticks out into the shell's padding scrolls the page sideways on CI's
    // Linux rendering even when it still fits locally ("Nýtt hlutverk" did).
    const poking = await page.locator('.admin-page').evaluate((pageEl) => {
      const edge = pageEl.getBoundingClientRect().right + 0.5;
      return [...pageEl.querySelectorAll('*')]
        .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > edge; })
        .map((n) => `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}.${String(n.className).trim().replace(/\s+/g, '.')}`);
    });
    expect(poking).toEqual([]);
  });
});

test.describe('Edit one customer (/admin/customers)', () => {
  skipUnless(test, 'customers-crm');
  test.use({ viewport: { width: 1280, height: 900 } });

  test('edit contact + address; the invite reports, never shows a link', async ({ page }) => {
    const id = await seed();
    await loginAsAdmin(page);
    await page.goto('/is/admin/customers');
    await page.click(`[data-edit-id="${id}"]`);
    const dialog = page.locator('.cust-edit');
    await expect(dialog.locator('[name=email]')).toHaveValue(CUSTOMER_EMAIL);
    await dialog.locator('[name=address1]').fill('Laugavegur 1');
    await dialog.locator('[name=zip]').fill('101');
    await dialog.locator('[name=city]').fill('Reykjavík');
    await dialog.locator('[name=country]').fill('is');
    await dialog.locator('[type=submit]').click();
    await expect(dialog).toHaveCount(0);

    await page.click(`[data-edit-id="${id}"]`);
    await expect(page.locator('.cust-edit [name=city]')).toHaveValue('Reykjavík');
    await expect(page.locator('.cust-edit [name=country]')).toHaveValue('IS');
    await page.click('#cust-edit-invite');
    const status = page.locator('#cust-invite-status');
    await expect(status).not.toBeEmpty();
    await expect(page.locator('.cust-edit')).not.toContainText('reset-password');
  });
});

// ── Review screenshots (only with L3_SHOTS=<dir>) ─────────────────────────────
test.describe('screenshots for the lane-3 review', () => {
  skipUnless(test, 'rbac-roles');
  test.skip(!process.env.L3_SHOTS, 'set L3_SHOTS=<dir> to write the review screenshots');
  const THEMES = { glod: 'ember', bjart: 'classic', midnaetti: 'midnight' };
  const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 375, height: 812 } };

  for (const [tname, theme] of Object.entries(THEMES)) {
    for (const [sname, size] of Object.entries(SIZES)) {
      test(`${tname} ${sname}`, async ({ page }) => {
        const dir = process.env.L3_SHOTS;
        fs.mkdirSync(dir, { recursive: true });
        await page.addInitScript((t) => { try { localStorage.setItem('ws_theme', t); } catch { /* */ } }, theme);
        const id = await seed();
        await loginAsAdmin(page);
        await page.setViewportSize(size); // after sign-in: the phone nav folds the button away
        const force = () => page.evaluate((t) => {
          if (t === 'classic') document.documentElement.removeAttribute('data-theme');
          else document.documentElement.setAttribute('data-theme', t);
        }, theme);

        await page.goto('/is/admin/roles');
        await expect(page.locator('table.role-grid')).toBeVisible();
        await force();
        // One pending change, so the save bar is in the picture.
        const first = page.locator('td.role-cell input[type="checkbox"]:visible').first();
        await first.click();
        await expect(page.locator('#role-savebar')).toBeVisible();
        await page.screenshot({ path: path.join(dir, `roles-grid-${tname}-${sname}.png`), fullPage: false });
        await page.screenshot({ path: path.join(dir, `roles-grid-${tname}-${sname}-full.png`), fullPage: true });
        // The roles page never scrolls sideways at any width (the grid scrolls in its own box).
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.click('#role-discard');
        await page.click('#role-new');
        await page.screenshot({ path: path.join(dir, `roles-editor-${tname}-${sname}.png`) });

        await page.goto('/is/admin/customers');
        await force();
        await page.click(`[data-edit-id="${id}"]`);
        await expect(page.locator('.cust-edit [name=email]')).toBeVisible();
        // No overflow assertion here: the Customers LIST table is wider than a
        // phone already (pre-existing, not this dialog).
        await page.screenshot({ path: path.join(dir, `customer-edit-${tname}-${sname}.png`) });
      });
    }
  }
});
