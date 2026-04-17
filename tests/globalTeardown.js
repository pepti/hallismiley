// Runs once after all test suites complete.
//
// With `forceExit: true` set in jest.config.js the process will terminate
// regardless, but that hides leaked handles. This teardown closes the shared
// pg pool explicitly so open-handle diagnostics are clean when forceExit is
// temporarily flipped off during test debugging.
module.exports = async function globalTeardown() {
  try {
    const { pool } = require('../server/config/database');
    await pool.end();
  } catch {
    // Pool may never have been created (e.g. unit-only runs). Safe to ignore.
  }
};
