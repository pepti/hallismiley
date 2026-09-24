// @ts-check
// The module switches card on /admin/general (R5b, 2026-09-24): an admin sees
// the modules this instance's contract includes, switches one off — its API
// answers 404 at once — and back on. The same rule as the MCP `set_module`
// tool, so whatever Claude switched off, a person can switch back here.
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// On the SECOND e2e server (playwright.config.js, E2E_REQUIRED_BASE_URL): a
// switch lives in the server process's memory, and the main server's other
// workers must never meet a module switched off mid-spec (news-editor.spec.js
// loads /news). testadmin is exempt from the enrolment rule there.
test.use({ baseURL: process.env.E2E_REQUIRED_BASE_URL });

test('an admin switches News off and back on from the general settings screen', async ({ page, request }) => {
  await loginAsAdmin(page);
  await page.goto('/is/admin/general');
  const news = page.getByTestId('module-news');
  await expect(news).toBeVisible();
  await expect(news).toBeChecked();

  try {
    await news.uncheck();
    await expect(news).not.toBeChecked();
    await expect(news).toBeEnabled(); // saved (disabled while in flight)
    expect((await page.request.get('/api/v1/news')).status()).toBe(404);
    expect((await request.get('/api/v1/news')).status()).toBe(404);

    await page.reload();
    await expect(page.getByTestId('module-news')).not.toBeChecked();
  } finally {
    // Never leave the shared e2e server with a module off.
    const box = page.getByTestId('module-news');
    if (!(await box.isChecked())) await box.check();
    // The box is disabled while its PATCH is in flight: enabled again = saved.
    await expect(box).toBeEnabled();
  }
  await expect(page.getByTestId('module-news')).toBeChecked();
  expect((await request.get('/api/v1/news')).status()).toBe(200);
});
