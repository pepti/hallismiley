const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { loginAsAdmin, createTestUser } = require('./helpers');

// /admin/updates — "which version is this site running, and who decides when it
// changes?".
//
// The e2e server runs this instance's committed config, which is `managed`, so
// the default-path tests assert the MANAGED rendering: a sentence explaining
// that Orange Smiley drives, and no controls at all. The manual/auto renderings
// are driven through a stubbed API response, because switching the real
// instance's contract would mean redeploying it — and the server-side transition
// they end in is covered exhaustively by the Jest suites
// (tests/integration/updateApplier.test.js).

// The BASE ships the self-update module OFF (no config/client.json), and off
// means genuinely absent: the sidebar drops the Updates line and /admin/updates
// 404s. Probe once per test and skip when dormant — instances that enable the
// module (a 401 here, since the endpoint then exists behind auth) run the full
// suite. Keeping the spec in the engine is the point: it travels to every fleet.
test.beforeEach(async ({ request }) => {
  const res = await request.get('/api/v1/system/version');
  test.skip(res.status() === 404, 'self-update module dormant in the base — instance suites cover this');
});

const UPDATES_API = '**/api/v1/system/updates';

/** A stubbed GET /api/v1/system/updates, so a rendering can be tested per mode. */
function stubUpdates(page, overrides = {}) {
  const body = {
    build: { version: '1.4.0', gitSha: 'abcdef1234567890', builtAt: '2026-08-01T10:00:00.000Z', channel: 'stable' },
    settings: {
      mode: 'manual', channel: 'stable', managed: false,
      manifestHost: 'releases.orangesmiley.is',
      maintenanceWindow: { days: ['tue', 'wed', 'thu'], fromHour: 3, toHour: 5, tz: 'Atlantic/Reykjavik' },
      nextWindowStart: '2026-08-11T03:00:00.000Z',
      triggerConfigured: true,
      ...(overrides.settings || {}),
    },
    available: overrides.available === null ? null : {
      id: 42, version: '1.4.2', channel: 'stable', status: 'available',
      imageDigest: 'sha256:' + '1'.repeat(64), previousDigest: null,
      discoveredAt: '2026-08-09T12:00:00.000Z', appliedAt: null,
      publishedAt: '2026-08-09T12:00:00.000Z',
      critical: false, compatible: true, minCompatibleVersion: null,
      scheduledFor: null, failureReason: null,
      changelogHtml: '<h3>1.4.2</h3>\n<ul>\n<li>Fixed the thing</li>\n</ul>',
      ...(overrides.available || {}),
    },
    history: overrides.history || [],
  };
  return page.route(UPDATES_API, route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('Admin → software updates', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('the sidebar links to it and the page loads', async ({ page }) => {
    await page.goto('/is/admin/general');
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 10_000 });

    await page.locator('.admin-sidebar a[href$="/admin/updates"]').click();
    await expect(page.locator('[data-testid="updates-status"]')).toBeVisible({ timeout: 10_000 });
  });

  test('the status card says what this instance is running and where updates come from', async ({ page }) => {
    await page.goto('/is/admin/updates');
    const status = page.locator('[data-testid="updates-status"]');
    await expect(status).toBeVisible({ timeout: 10_000 });
    // An unstamped local/CI build reports itself as a dev build rather than
    // inventing a version number.
    await expect(status).toContainText('releases.orangesmiley.is');
    await expect(page.locator('.admin-sidebar__build')).toBeVisible();
  });

  test('a managed instance gets a sentence, not a disabled button', async ({ page }) => {
    await page.goto('/is/admin/updates');
    await expect(page.locator('[data-testid="updates-available"]')).toBeVisible({ timeout: 10_000 });
    // No settings card, and no apply control anywhere: the contract IS the setting.
    await expect(page.locator('[data-testid="updates-settings"]')).toHaveCount(0);
    await expect(page.locator('[data-apply]')).toHaveCount(0);
  });

  test('manual mode renders an install button and the changelog', async ({ page }) => {
    await stubUpdates(page);
    await page.goto('/is/admin/updates');

    const card = page.locator('[data-testid="updates-available"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('1.4.2');
    await expect(card.locator('.updates-changelog')).toContainText('Fixed the thing');
    await expect(page.locator('[data-apply="42"]')).toBeEnabled();
    await expect(page.locator('[data-testid="updates-managed"]')).toHaveCount(0);
  });

  test('auto mode shows when it is scheduled, and still offers to go now', async ({ page }) => {
    await stubUpdates(page, {
      settings: { mode: 'auto' },
      available: { status: 'scheduled', scheduledFor: '2026-08-11T03:00:00.000Z' },
    });
    await page.goto('/is/admin/updates');

    await expect(page.locator('[data-testid="updates-scheduled"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-apply="42"]')).toBeVisible();
    // The window editor is live in auto mode.
    await expect(page.locator('[data-testid="updates-settings"] .updates-window')).not.toBeDisabled();
  });

  test('an instance with no deployment connection says so instead of offering a button that fails', async ({ page }) => {
    await stubUpdates(page, { settings: { triggerConfigured: false } });
    await page.goto('/is/admin/updates');

    await expect(page.locator('[data-testid="updates-no-trigger"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-apply="42"]')).toBeDisabled();
  });

  test('an update needing an interim release explains itself and offers nothing', async ({ page }) => {
    await stubUpdates(page, { available: { compatible: false, minCompatibleVersion: '1.5.0' } });
    await page.goto('/is/admin/updates');

    await expect(page.locator('[data-testid="updates-available"]')).toContainText('1.5.0', { timeout: 10_000 });
    await expect(page.locator('[data-apply]')).toHaveCount(0);
  });

  test('install now warns about the restart, then posts the apply', async ({ page }) => {
    await stubUpdates(page);

    let applyPosted = null;
    await page.route('**/api/v1/system/updates/42/apply', (route) => {
      applyPosted = route.request().method();
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ update: { id: 42, version: '1.4.2', status: 'applying' } }),
      });
    });

    await page.goto('/is/admin/updates');
    await expect(page.locator('[data-apply="42"]')).toBeVisible({ timeout: 10_000 });

    // The confirmation has to name the consequence — a restart — because that
    // is what someone clicking at 14:00 on a Tuesday needs to know.
    let dialogText = '';
    page.once('dialog', (d) => { dialogText = d.message(); d.accept(); });

    await page.locator('[data-apply="42"]').click();
    await expect.poll(() => applyPosted, { timeout: 10_000 }).toBe('POST');
    expect(dialogText).toMatch(/1\.4\.2/);
    expect(dialogText).toMatch(/endurræs|restart/i);
  });

  test('cancelling the confirmation posts nothing', async ({ page }) => {
    await stubUpdates(page);
    let applyPosted = false;
    await page.route('**/api/v1/system/updates/42/apply', (route) => {
      applyPosted = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/is/admin/updates');
    await expect(page.locator('[data-apply="42"]')).toBeVisible({ timeout: 10_000 });

    page.once('dialog', d => d.dismiss());
    await page.locator('[data-apply="42"]').click();
    await page.waitForTimeout(500);
    expect(applyPosted).toBe(false);
  });

  test('history lists past releases with their status', async ({ page }) => {
    await stubUpdates(page, {
      available: null,
      history: [
        { id: 7, version: '1.4.1', channel: 'stable', status: 'failed', imageDigest: 'sha256:' + '2'.repeat(64),
          previousDigest: null, discoveredAt: '2026-08-01T00:00:00.000Z', appliedAt: null, publishedAt: null,
          critical: false, compatible: true, minCompatibleVersion: null, scheduledFor: null,
          failureReason: 'still running 1.4.0' },
      ],
    });
    await page.goto('/is/admin/updates');

    const history = page.locator('[data-testid="updates-history"]');
    await expect(history).toBeVisible({ timeout: 10_000 });
    await expect(history).toContainText('1.4.1');
    await expect(history).toContainText('still running 1.4.0');
    await expect(history.locator('[data-rollback="7"]')).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await stubUpdates(page);
    await page.goto('/is/admin/updates');
    await expect(page.locator('[data-testid="updates-settings"]')).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('.updates-page')
      .analyze();

    expect(results.violations.map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe('Admin → software updates, without the role', () => {
  test('a non-admin gets neither the view nor the API', async ({ page }) => {
    await createTestUser(page);

    await page.goto('/is/admin/updates');
    await page.waitForTimeout(800);
    // The client guard sends them home; that is UX, not security…
    await expect(page.locator('.updates-page')).toHaveCount(0);

    // …so the endpoints themselves must refuse.
    const statuses = await page.evaluate(async () => {
      const get = await fetch('/api/v1/system/updates', { credentials: 'include' });
      const patch = await fetch('/api/v1/system/settings', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'auto' }),
      });
      return [get.status, patch.status];
    });
    for (const status of statuses) expect([401, 403]).toContain(status);
  });
});
