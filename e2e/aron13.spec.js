const { test, expect } = require('@playwright/test');

/**
 * /is/aron13ara — Aron's hidden birthday page: three mini games in order,
 * each revealing a message; progress persists across reloads; the route is
 * Icelandic-only and noindexed.
 *
 * Reduced motion is emulated so countdowns, typewriters and particles are
 * instant. The real-time catch game is finished through a hook the view only
 * exposes when the server stamps a non-production app-env (as in e2e).
 */

async function fresh(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/is/aron13ara');
  await page.evaluate(() => { localStorage.removeItem('aron13:step'); localStorage.removeItem('aron13:best'); });
  await page.reload();
  await page.waitForSelector('[data-testid="aron13-start"]');
}

async function startGame(page) {
  await page.click('[data-testid="aron13-start"]');
  await expect(page.locator('[data-testid="aron13-game"]')).toBeVisible();
}

/** Break every block; always finds all three diamonds. Survives a TNT game over. */
async function mineEverything(page) {
  // 36 cells, stone takes 3 hits → at most 72 clicks plus a possible retry.
  for (let i = 0; i < 160; i++) {
    if (await page.locator('[data-testid="aron13-reveal"]').count()) return;
    const retry = page.locator('[data-testid="aron13-retry"]');
    if (await retry.count()) { await retry.click(); continue; }
    const cell = page.locator('.a13-mine__cell:not(:disabled)').first();
    if (!(await cell.count())) return;
    // The board is unmounted 500 ms after the last diamond; a click that
    // lands in that window must not hang the test.
    try { await cell.click({ force: true, timeout: 1500 }); } catch { /* board gone — loop re-checks */ }
  }
}

test.describe('Aron 13 birthday page', () => {

  test.beforeEach(async ({ page }) => { await fresh(page); });

  test('plays all three games and reveals the three messages', async ({ page }) => {
    await expect(page).toHaveURL(/\/is\/aron13ara$/);
    await expect(page.locator('h1')).toContainText('Aron');

    // Game 1 — mining.
    await expect(page.locator('[data-puzzle="nama"]')).toBeVisible();
    await startGame(page);
    await mineEverything(page);
    await expect(page.locator('[data-testid="aron13-reveal"]')).toContainText('Já þetta ert þú Aron', { timeout: 10_000 });
    await expect(page.locator('[data-testid="aron13-chest-1"]')).toHaveClass(/is-open/);
    await page.click('[data-testid="aron13-next"]');

    // Game 2 — catch (real-time; finished via the test-only hook).
    await expect(page.locator('[data-puzzle="robux"]')).toBeVisible();
    await startGame(page);
    await expect(page.locator('.a13-catch')).toBeVisible();
    await page.evaluate(() => window.__aron13.win(4));
    await expect(page.locator('[data-testid="aron13-reveal"]')).toContainText('Fyrri gjöfin er Claude Code áskrift út árið 2026');
    await page.click('[data-testid="aron13-next"]');

    // Game 3 — crafting, tap-to-place.
    await expect(page.locator('[data-puzzle="smidi"]')).toBeVisible();
    await startGame(page);
    await page.click('[data-item="diamond"]');
    await page.click('[data-cell="1"]');
    await page.click('[data-cell="4"]');
    await page.click('[data-item="diamond"]'); // deselect
    await page.click('[data-item="stick"]');
    await page.click('[data-cell="7"]');
    await expect(page.locator('[data-testid="aron13-craft"]')).toBeEnabled();
    await page.click('[data-testid="aron13-craft"]');
    await expect(page.locator('[data-testid="aron13-reveal"]')).toContainText('Seinni gjöfin er NBA 2K26');
    await page.click('[data-testid="aron13-next"]');

    const done = page.locator('[data-testid="aron13-done"]');
    await expect(done).toContainText('Til hamingju með 13 ára afmælið, Aron!');
    await expect(done).toContainText('Claude Code');
    await expect(done).toContainText('NBA 2K26');
    // The finale lists the gifts itself, so the "opened chests" list is hidden there.
    await expect(page.locator('[data-testid="aron13-result-3"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="aron13-chest-3"]')).toHaveClass(/is-open/);
  });

  test('the catch game really runs: coins fall and the arrow keys move the player', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('aron13:step', '1'));
    await page.reload();
    await expect(page.locator('[data-puzzle="robux"]')).toBeVisible();
    await startGame(page);
    const player = page.locator('[data-player]');
    await expect(player).toBeVisible();
    const before = await player.evaluate(el => el.style.transform);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowRight');
    const after = await player.evaluate(el => el.style.transform);
    expect(after).not.toBe(before);
    // Something has spawned and is falling within a couple of seconds.
    await expect.poll(async () => page.locator('.a13-catch__obj').count(), { timeout: 5000 }).toBeGreaterThan(0);
  });

  test('a wrong craft is met kindly and does not advance', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('aron13:step', '2'));
    await page.reload();
    await expect(page.locator('[data-puzzle="smidi"]')).toBeVisible();
    await startGame(page);
    await page.click('[data-item="ironIngot"]');
    await page.click('[data-cell="1"]');
    await page.click('[data-cell="4"]');
    await page.click('[data-item="stick"]');
    await page.click('[data-cell="7"]');
    await page.click('[data-testid="aron13-craft"]');
    await expect(page.locator('[data-testid="aron13-status"]')).toContainText('ekki demantssverð');
    await expect(page.locator('[data-testid="aron13-reveal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="aron13-chest-3"]')).not.toHaveClass(/is-open/);
  });

  test('hints are progressive and the last one names the answer', async ({ page }) => {
    const hint = page.locator('[data-testid="aron13-hint"]');
    const hints = page.locator('[data-testid="aron13-hints"] li');
    await expect(hints).toHaveCount(0);
    await hint.click();
    await expect(hints).toHaveCount(1);
    await hint.click();
    await hint.click();
    await expect(hints).toHaveCount(3);
    await expect(hints.nth(2)).toContainText('alla þrjá');
    await expect(hint).toBeDisabled();
  });

  test('progress survives a reload', async ({ page }) => {
    await startGame(page);
    await mineEverything(page);
    await expect(page.locator('[data-testid="aron13-reveal"]')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.locator('[data-testid="aron13-result-1"]')).toContainText('Já þetta ert þú Aron');
    await expect(page.locator('[data-testid="aron13-chest-1"]')).toHaveClass(/is-open/);
    await expect(page.locator('[data-puzzle="robux"]')).toBeVisible();
  });

  test('mute toggle persists', async ({ page }) => {
    const mute = page.locator('[data-testid="aron13-mute"]');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('[data-testid="aron13-mute"]')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => localStorage.removeItem('aron13:mute'));
  });

  test('is locked to Icelandic, noindexed, and hides the language switcher', async ({ page }) => {
    await page.goto('/en/aron13ara');
    await expect(page).toHaveURL(/\/is\/aron13ara$/);
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
    await expect(page.locator('.lol-nav__lang').first()).toBeHidden();
  });
});
