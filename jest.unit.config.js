// Fast unit tier — no database, no global drop/recreate, parallel workers.
// Verified 2026-08-24: nothing under tests/unit/ touches pg or app.js, so the
// DB globalSetup and the maxWorkers:1 race guard (both needed by integration
// suites) are pure overhead here. Integration + full runs keep jest.config.js.
const {
  globalSetup: _gs,
  globalTeardown: _gt,
  maxWorkers: _mw,
  coverageThreshold: _ct,
  ...base
} = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/tests/unit/**/*.test.js'],
  verbose: false,
};
