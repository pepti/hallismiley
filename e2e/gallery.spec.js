const { test, expect } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);

// The site is Icelandic by default, so the project card's aria-label is now
// "Skoða verkefni: <title>" rather than "View project: <title>". Match on the
// project title alone — it comes from the database (title/title_is are both
// "Stofan Bakhús") and is therefore locale-independent.
async function openStofanBakhus(page) {
  await page.goto('/#/projects');
  await page.waitForSelector('.project-card', { timeout: 10_000 });
  await page.getByRole('button', { name: /Stofan Bakhús/i }).click();
  await page.waitForSelector('.gallery-grid', { timeout: 10_000 });
}

test.describe('Gallery and lightbox', () => {

  test('project detail page shows gallery grid with images', async ({ page }) => {
    await openStofanBakhus(page);
    await expect(page.locator('.gallery-grid')).toBeVisible();
    await expect(page.locator('.gallery-grid__item').first()).toBeVisible();
  });

  test('clicking a gallery item opens the lightbox', async ({ page }) => {
    await openStofanBakhus(page);

    // Click the first image item (not a video)
    await page.locator('.gallery-grid__item:not(.gallery-grid__item--video)').first().click();

    // Lightbox should become visible (hidden attribute removed)
    await expect(page.locator('.lb-overlay')).not.toHaveAttribute('hidden', { timeout: 5_000 });
    await expect(page.locator('.lb-img')).not.toHaveAttribute('hidden');
  });

  test('lightbox shows correct image counter', async ({ page }) => {
    await openStofanBakhus(page);

    await page.locator('.gallery-grid__item').first().click();
    await expect(page.locator('.lb-overlay')).not.toHaveAttribute('hidden', { timeout: 5_000 });

    const counter = page.locator('.lb-counter');
    await expect(counter).toContainText('1 /');
  });

  test('arrow navigation moves to next image', async ({ page }) => {
    await openStofanBakhus(page);

    await page.locator('.gallery-grid__item').first().click();
    await expect(page.locator('.lb-overlay')).not.toHaveAttribute('hidden', { timeout: 5_000 });
    await expect(page.locator('.lb-counter')).toContainText('1 /');

    await page.locator('.lb-arrow--next').click();
    await expect(page.locator('.lb-counter')).toContainText('2 /');
  });

  test('close button hides the lightbox', async ({ page }) => {
    await openStofanBakhus(page);

    await page.locator('.gallery-grid__item').first().click();
    await expect(page.locator('.lb-overlay')).not.toHaveAttribute('hidden', { timeout: 5_000 });

    await page.locator('.lb-close').click();
    await expect(page.locator('.lb-overlay')).toHaveAttribute('hidden');
  });

  test('Escape key closes the lightbox', async ({ page }) => {
    await openStofanBakhus(page);

    await page.locator('.gallery-grid__item').first().click();
    await expect(page.locator('.lb-overlay')).not.toHaveAttribute('hidden', { timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.lb-overlay')).toHaveAttribute('hidden');
  });

});
