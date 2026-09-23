const os = require('os');
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

// A SECOND server, same code and same database, running two-factor enrolment
// in its MANDATORY mode (security.mfa.enrolment = required). The main server
// runs the instance default, `optional` — what a real instance gets, and
// what e2e/mfa-reminder.spec.js needs (the reminder exists only there). The
// forced flow cannot share that server: the mode is per instance, and a
// per-request switch would be a test backdoor in production code. So
// e2e/admin-totp-enrolment.spec.js points at this one (test.use baseURL).
// Port = E2E_REQUIRED_PORT, else E2E_PORT + 1 (3001 on CI). Exported so the
// spec's worker reads the same value (mfa-reminder-2026-09-23).
const REQUIRED_PORT = process.env.E2E_REQUIRED_PORT || String(Number(PORT) + 1);
const REQUIRED_BASE_URL = `http://localhost:${REQUIRED_PORT}`;
process.env.E2E_REQUIRED_BASE_URL = REQUIRED_BASE_URL;

// Workers on CI = the runner's CPUs, not a fixed 4. This repo is private, so
// GitHub gives it the 2-vCPU Linux runner, and that one machine also carries
// Postgres and the Node server. Four Chromium workers on it did not finish the
// suite any sooner — they only stretched every test: the longest flows ran
// 30–37 s against the 30 s timeout and failed on almost every master run from
// 2026-09-08 (accounts.spec.js:46, leads.spec.js:26). Measured locally with
// the whole run pinned to one core: 4 workers → 1670 s of summed test time in
// 7.3 min, 2 workers → 822 s in 7.0 min. Same wall clock, half the time each
// test spends inside its budget. Locally the count stays 4.
const CI_WORKERS = Math.max(1, Math.min(4, os.availableParallelism()));

// The environment both e2e servers share (webServer below).
const SERVER_ENV = {
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
  // Two-factor enrolment: the instance default, `optional`
  // (security.mfa.enrolment; mfa-optional-2026-09-23), so every unenrolled
  // admin here — testadmin included — is an admin and sees the two-step
  // reminder atop /admin (mfa-reminder-2026-09-23). The MANDATORY mode
  // runs on the second server below.
  // Exercise the encrypted-at-rest path. 32 bytes, base64, e2e-only.
  TOTP_ENC_KEY: 'ZTJlLW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
};

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: process.env.CI ? CI_WORKERS : 4,
  retries: process.env.CI ? 1 : 0,
  // CI also gets the list reporter: every test's duration lands in the job
  // log, so the next test creeping toward the timeout is visible on a green
  // run instead of only in the report artifact of a red one.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['html', { open: 'never' }]],

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
  webServer: [{
    command: 'node e2e/global-setup.js && node server/server.js',
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: SERVER_ENV,
  }, {
    // The MANDATORY-enrolment server (see REQUIRED_PORT above). Starts after
    // the first, which has provisioned and migrated the shared database;
    // its own boot migrations are then no-ops under the advisory lock.
    command: 'node server/server.js',
    url: REQUIRED_BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...SERVER_ENV,
      PORT: REQUIRED_PORT,
      ALLOWED_ORIGINS: REQUIRED_BASE_URL,
      CLIENT_CONFIG_SECURITY_MFA_ENROLMENT: 'required',
      // Under `required`, admins must enrol a second factor before they hold
      // admin rights (server/auth/mfaPolicy.js). `testadmin` is exempt by
      // name, through a switch production ignores, in case a spec on this
      // server signs in as it; every other admin is under the real rule —
      // e2e/admin-totp-enrolment.spec.js walks `enroladmin` through it.
      ADMIN_TOTP_EXEMPT: 'testadmin',
    },
  }],
});
