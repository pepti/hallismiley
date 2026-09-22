---
description: Run the inherited Playwright e2e suite and triage failures
allowed-tools: Read, Edit, Bash, Glob, Grep
---

Run the project's end-to-end tests.

1. Run the Playwright suite: `npm run test:e2e` (check `package.json` for the exact script — it may be `test:e2e`, `e2e`, or `npx playwright test`). If `/test-plan` has been run, `npm run test:walkthrough` is the fuller role × route sweep — prefer it.
2. If the dev server / DB must be up first, start what's needed (see `package.json` scripts and `playwright.config`).
3. Triage each failure: name the spec + the likely cause — selector drift after the re-skin, missing seed data, or a route removed by `/strip-base`. Fix selectors/flakes the re-skin broke; flag genuine regressions rather than masking them.
4. Report pass/fail counts and what you changed. Don't declare done while specs are red without an explicit, stated reason.
