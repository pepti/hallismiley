module.exports = {
  testEnvironment:  'node',
  globalSetup:      './tests/globalSetup.js',
  globalTeardown:   './tests/globalTeardown.js',
  setupFiles:       ['./tests/env.js'],
  testMatch:        ['**/tests/**/*.test.js'],
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
};
