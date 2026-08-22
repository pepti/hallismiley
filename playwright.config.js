const { defineConfig, devices } = require('@playwright/test');
const { e2eDatabaseUrl } = require('./e2e/lib/dbUrl');

// Pin the whole run to an isolated, throwaway _test database — never the dev
// DB, never Jest's (see e2e/lib/dbUrl.js). Exported into the env so every
// child this config spawns agrees on the target.
const E2E_DATABASE_URL = e2eDatabaseUrl();
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;

// Port is configurable so a second checkout (a parallel worktree, another
// session) can run the suite without either colliding on 3000 or — worse —
// silently REUSING the other one's server and testing the wrong code against
// the wrong database. Default 3000 keeps CI and everyday local runs unchanged.
const PORT = process.env.E2E_PORT || '3000';
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Pre-dismiss the cookie consent banner so it never blocks test interactions
    storageState: {
      cookies: [],
      origins: [{
        origin: BASE_URL,
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

  // NOTE: no `globalSetup` here — provisioning runs as the webServer command
  // prefix below. Playwright starts the webServer BEFORE globalSetup, so a
  // globalSetup that creates the database would be too late on a fresh
  // machine (ice #197).
  webServer: {
    command: 'node e2e/global-setup.js && node server/server.js',
    url: BASE_URL,
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
      // Always 'test' (NOT `process.env.NODE_ENV || 'test'`): the provision
      // steps and the server must agree, and a shell with NODE_ENV=production
      // exported would otherwise boot the e2e server in production mode.
      NODE_ENV:    'test',
      // The isolated per-branch database — the server must never fall back to
      // the .env dev DATABASE_URL (that was the pre-harvest behaviour, and it
      // meant every local e2e run wrote into the dev database).
      DATABASE_URL: E2E_DATABASE_URL,
      DB_SSL:       'false',
      PORT,
      // Must match the origin the browser actually uses, or every state-changing
      // request fails CORS the moment E2E_PORT is set.
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || BASE_URL,
    },
  },
});
