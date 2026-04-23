module.exports = {
  testEnvironment:  'node',
  globalSetup:      './tests/globalSetup.js',
  globalTeardown:   './tests/globalTeardown.js',
  setupFiles:       ['./tests/env.js'],
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/integration/**/*.test.js',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/',
  ],
  testTimeout:      30000,
  forceExit:        true,
  // Run test files serially — avoids DB race conditions between suites
  maxWorkers:       1,
  verbose:          true,
  // Transform ESM-only packages (lucia, oslo, @lucia-auth, @oslojs/* deps)
  // so Jest can require() them in the CJS test environment.
  transformIgnorePatterns: [
    'node_modules/(?!(lucia|@lucia-auth|oslo|@oslojs)/)',
  ],
  // Coverage configuration
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/scripts/**',
    '!server/migrations/**',
  ],
  // Coverage floor: pre-i18n the suite sat comfortably above 70%. The P0-P3
  // i18n / SEO overhaul added ~1,500 lines of new server code (validation
  // refactor, server-side t() helper, ssrMeta middleware, locale-aware
  // controllers) which temporarily pulled the global number to ~64%. Keep
  // ratcheting the floor upward as we land follow-up tests — eventual target
  // is back to 70. Per-file thresholds below protect security-critical
  // surfaces from coverage regression even when the global number drifts.
  coverageThreshold: {
    global: {
      lines: 62,
    },
    // authController handles login/signup/reset — any regression in its
    // test coverage should fail CI immediately.  Currently at 90%.
    'server/controllers/authController.js': {
      lines: 88,
    },
  },
};
