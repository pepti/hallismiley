module.exports = {
  testEnvironment:          'node',
  globalSetup:              './tests/globalSetup.js',
  globalTeardown:           './tests/globalTeardown.js',
  setupFiles:               ['./tests/env.js'],
  testMatch:                ['**/tests/**/*.test.js'],
  testTimeout:              15000,
  forceExit:                true,
  // Run test files serially — avoids DB race conditions between suites
  maxWorkers:               1,
  verbose:                  true,
};
