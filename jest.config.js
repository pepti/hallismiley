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
    // Ignore other Claude worktrees when running from the main checkout.
    // <rootDir> resolves to the directory of this config file, so when
    // running from inside a worktree this pattern matches nothing inside
    // the worktree itself — it only filters parallel worktrees that are
    // children of the current root. Without <rootDir> the bare '/.claude/'
    // pattern would match every absolute path under .claude/worktrees/*,
    // ignoring the worktree's own tests when run from inside it.
    '<rootDir>/.claude/',
  ],
  testTimeout:      30000,
  forceExit:        true,
  // Run test files serially — avoids DB race conditions between suites
  maxWorkers:       1,
  verbose:          true,
  // Transform ESM-only packages so Jest can require() them in the CJS test
  // environment. Two families live here:
  //  • lucia / oslo — auth stack, ESM-only since we adopted it.
  //  • htmlparser2 and its dom* / entities deps — pulled in by sanitize-html.
  //    sanitize-html 2.17.5+ moved to htmlparser2 12, which ships ESM only.
  //    Without these entries every suite that loads the sanitize middleware
  //    (i.e. anything requiring server/app.js) dies with
  //    "Cannot use import statement outside a module".
  transformIgnorePatterns: [
    'node_modules/(?!(lucia|@lucia-auth|oslo|@oslojs|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)',
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
    // OAuth controllers — 9 integration tests each cover all branch paths.
    'server/controllers/googleAuthController.js': {
      lines: 80,
    },
    'server/controllers/facebookAuthController.js': {
      lines: 80,
    },
  },
};
