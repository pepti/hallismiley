/**
 * Drift guard for .github/workflows/ci-skipped.yml.
 *
 * A protected branch requires three status checks BY NAME. ci.yml skips
 * docs-only PRs, so ci-skipped.yml reports those names for a PR that is
 * documentation only (and, in the engine, runs the unit tier — the docs are
 * tested content). Ported from icelandicstore #347 (harvest-ice-f-2026-09-24).
 * That only holds while (a) the docs list is the same in every place it is
 * written and (b) the shim's names equal the real job names. Neither is
 * checked by GitHub — a drift just leaves docs-only PRs unmergeable (or, worse,
 * lets the shim go green for a file CI would have tested).
 *
 * No YAML parser is a dependency, so this reads the files as text. Workflow
 * edits are not in paths-ignore, so a drifting PR runs this test.
 */
const fs = require('fs');
const path = require('path');

const WORKFLOWS = path.join(__dirname, '..', '..', '.github', 'workflows');
const ci = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
const shim = fs.readFileSync(path.join(WORKFLOWS, 'ci-skipped.yml'), 'utf8');

const REQUIRED = ['Lint + Integration tests', 'E2E tests (Playwright)', 'Docker build + boot smoke test'];

const lists = (text, key) =>
  [...text.matchAll(new RegExp(`^\\s+${key}:\\s*(\\[.*\\])\\s*$`, 'gm'))].map(m => m[1]);

describe('ci-skipped.yml stays in step with ci.yml', () => {
  test('the docs list is identical in ci.yml (pull_request only) and the shim', () => {
    const ignored = lists(ci, 'paths-ignore');
    // ONE list: the engine's push trigger deliberately has none — its docs are
    // tested content and master takes direct merges (see ci.yml).
    expect(ignored).toHaveLength(1);
    const pushBlock = ci.slice(ci.indexOf('\n  push:\n'), ci.indexOf('\n  pull_request:\n'));
    expect(pushBlock).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(lists(shim, 'paths')).toEqual([ignored[0]]);
  });

  test('a docs-only PR still runs the docs parity tests under the check name', () => {
    const step = shim.slice(shim.indexOf('- name: Docs parity (unit tier)'));
    expect(step).toMatch(/^\s+if: matrix\.check == 'Lint \+ Integration tests'$/m);
    expect(step).toContain('npm run test:unit');
  });

  test("the detector's case pattern is that same list as shell globs", () => {
    const globs = JSON.parse(lists(ci, 'paths-ignore')[0].replace(/'/g, '"'))
      .map(g => g.replace(/\*\*/g, '*'));
    expect(shim).toContain(`${globs.join('|')}) ;;`);
  });

  test('the three required check names are real ci.yml job names', () => {
    for (const name of REQUIRED) {
      expect(ci).toMatch(new RegExp(`^    name: ${name.replace(/[+()]/g, '\\$&')}$`, 'm'));
    }
  });

  test('the shim carries those names only as matrix data, behind the detector', () => {
    const matrix = [...shim.matchAll(/^ {10}- '(.+)'$/gm)].map(m => m[1]);
    expect(matrix).toEqual(REQUIRED);
    // A plain job named after a required check would publish that name even
    // when skipped, and "skipped" satisfies branch protection.
    const jobNames = [...shim.matchAll(/^ {4}name: (.+)$/gm)].map(m => m[1]);
    expect(jobNames).toEqual(['Docs-only detector', '${{ matrix.check }}']);
    expect(shim).toMatch(/^ {4}if: needs\.detect\.outputs\.docs_only == 'true'$/m);
  });

  test('the shim cannot be mistaken for CI or run on a push', () => {
    expect(shim).toMatch(/^name: (?!CI$).+$/m);
    expect(shim).not.toMatch(/^ {2}push:/m);
    expect(shim).not.toMatch(/^ {2}workflow_run:/m);
  });
});
