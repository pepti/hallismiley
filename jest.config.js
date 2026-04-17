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
  // Coverage thresholds are a floor, not a target. Current full-suite coverage
  // sits at ~75% lines / 74% statements — the gap is mostly in email/token/
  // securityLogger/circuit-breaker plumbing that needs its own focused tests.
  // Thresholds are set just under today's numbers so the CI guard catches
  // real regressions; bump these incrementally as new tests land.
  coverageThreshold: {
    global: {
      lines:      72,
      statements: 72,
      branches:   60,
      functions:  68,
    },
  },
};
