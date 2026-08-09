// ESLint flat config. Replaces .eslintrc.json + .eslintignore, which ESLint 10
// no longer reads. The per-directory blocks mirror the `overrides` array the
// old config used, one for one.
//
// Two things that were implicit under eslintrc and have to be explicit here:
//  • Flat config defaults .js files to sourceType "module"; eslintrc defaulted
//    to "script". Every directory below therefore states its sourceType, and
//    anything not matched by a block would be treated as ESM — so new
//    top-level CommonJS files need adding to the commonjs block.
//  • `/* eslint-env node */` comments were removed in ESLint 9. babel.config.js
//    relied on one, so it is covered by the commonjs block explicitly.
const js = require('@eslint/js');
const globals = require('globals');

const ES = 2022;

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'keys/**',
      'public/assets/**',
      'public/js/vendor/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Parallel Claude worktrees are full checkouts; linting them would lint
      // the repo several times over and report on code that isn't ours.
      '.claude/**',
    ],
  },

  js.configs.recommended,

  {
    languageOptions: { ecmaVersion: ES },
    rules: {
      // caughtErrors defaulted to 'none' under ESLint 8 and to 'all' from 9
      // onwards, so an ignore pattern for catch bindings is needed to keep the
      // repo's existing "underscore prefix means deliberately unused" convention.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },

  // Server, plus the CommonJS config files at the repo root.
  {
    files: [
      'server/**/*.js',
      'jest.config.js',
      'babel.config.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: ES,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: ES,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
  },

  // This one test is authored as an ES module.
  {
    files: ['tests/unit/rateLimitDecide.test.js'],
    languageOptions: { ecmaVersion: ES, sourceType: 'module' },
  },

  // Browser SPA — ES modules, no Node globals.
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: ES,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },

  // Playwright specs run in Node but drive page code, so both global sets apply.
  {
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: ES,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: ES,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
