const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Pre-dismiss the cookie consent banner so it never blocks test interactions
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:3000',
        localStorage: [{ name: 'cookie_consent', value: 'declined' }],
      }],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: './e2e/global-setup.js',

  webServer: {
    command: 'node server/server.js',
    url: 'http://localhost:3000',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // The dev server now hard-fails when CSRF_SECRET / NODE_ENV are unset
      // (see server/server.js REQUIRED_ENV). Provide ephemeral defaults so
      // both CI and local Playwright runs spin up cleanly. The secret here
      // has no security meaning — it just signs CSRF tokens for the
      // throwaway E2E server.
      CSRF_SECRET: process.env.CSRF_SECRET || 'e2e-only-csrf-secret-do-not-use-in-prod',
      NODE_ENV:    process.env.NODE_ENV    || 'test',
    },
  },
});
