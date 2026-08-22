const PORT = process.env.E2E_PORT || '3000';
const { defineConfig, devices } = require('@playwright/test');
const { e2eDatabaseUrl } = require('./e2e/lib/dbUrl');

// Pin the whole run to an isolated, throwaway _test database — never the dev
// DB, never Jest's (see e2e/lib/dbUrl.js). Ported from icelandicstore #197.
const E2E_DATABASE_URL = e2eDatabaseUrl();
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Pre-dismiss the cookie consent banner so it never blocks test interactions
    storageState: {
      cookies: [],
      origins: [{
        origin: `http://localhost:${PORT}`,
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

  // NOTE: no globalSetup here — provisioning runs as the webServer command
  // prefix below. Playwright starts the webServer BEFORE globalSetup, so a
  // globalSetup that creates the database would be too late on a fresh
  // machine (ice #197).
  webServer: {
    command: 'node e2e/global-setup.js && node server/server.js',
    url: `http://localhost:${PORT}`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Must reach the server or the webServer listens on 3000 while tests aim at E2E_PORT.
      PORT,
      // The dev server now hard-fails when CSRF_SECRET / NODE_ENV are unset
      // (see server/server.js REQUIRED_ENV). Provide ephemeral defaults so
      // both CI and local Playwright runs spin up cleanly. The secret here
      // has no security meaning — it just signs CSRF tokens for the
      // throwaway E2E server.
      CSRF_SECRET: process.env.CSRF_SECRET || 'e2e-only-csrf-secret-do-not-use-in-prod',
      // Always 'test': the provision steps and the server must agree, and a
      // shell exporting NODE_ENV=production must not leak into the e2e server.
      NODE_ENV:    'test',
      // The isolated per-branch database — never the .env dev DATABASE_URL.
      DATABASE_URL: E2E_DATABASE_URL,
      DB_SSL:       'false',
    },
  },
});
