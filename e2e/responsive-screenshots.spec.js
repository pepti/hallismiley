/**
 * Responsive design screenshot capture.
 * Run with: npx playwright test e2e/responsive-screenshots.spec.js --headed
 * Screenshots saved to public/assets/responsive-screenshots/
 */
const { test } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const OUTPUT_DIR = path.join(__dirname, '../public/assets/responsive-screenshots');

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812 },
  { name: 'ipad',    width: 768,  height: 1024 },
];

const PAGES = [
  { name: 'homepage',       path: '/' },
  { name: 'projects',       path: '/projects' },
  { name: 'signup',         path: '/signup' },
];

test.beforeAll(() => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

for (const viewport of VIEWPORTS) {
  for (const page of PAGES) {
    test(`${viewport.name} — ${page.name}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
      });
      const browserPage = await context.newPage();

      await browserPage.goto(page.path, { waitUntil: 'networkidle' });

      // Wait for any JS-rendered content to settle
      await browserPage.waitForTimeout(500);

      const filename = `${viewport.name}-${page.name}.png`;
      await browserPage.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage: true,
      });

      console.log(`Saved: ${filename}`);
      await context.close();
    });
  }
}

// Project detail page — requires at least one project to exist
test('iphone — project-detail (first project)', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const browserPage = await context.newPage();

  // Navigate to projects and click the first card
  await browserPage.goto('/projects', { waitUntil: 'networkidle' });
  const firstCard = browserPage.locator('.project-card, [data-project-id]').first();
  const count = await firstCard.count();
  if (count > 0) {
    await firstCard.click();
    await browserPage.waitForTimeout(800);
    await browserPage.screenshot({
      path: path.join(OUTPUT_DIR, 'iphone-project-detail.png'),
      fullPage: true,
    });
    console.log('Saved: iphone-project-detail.png');
  } else {
    console.log('No project cards found — skipping project detail screenshot');
  }
  await context.close();
});

test('ipad — project-detail (first project)', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
  });
  const browserPage = await context.newPage();

  await browserPage.goto('/projects', { waitUntil: 'networkidle' });
  const firstCard = browserPage.locator('.project-card, [data-project-id]').first();
  const count = await firstCard.count();
  if (count > 0) {
    await firstCard.click();
    await browserPage.waitForTimeout(800);
    await browserPage.screenshot({
      path: path.join(OUTPUT_DIR, 'ipad-project-detail.png'),
      fullPage: true,
    });
    console.log('Saved: ipad-project-detail.png');
  } else {
    console.log('No project cards found — skipping project detail screenshot');
  }
  await context.close();
});
