/**
 * docs/history.d/ holds one dated write-up per branch (see its README for why:
 * the single append-only docs/HISTORY.md made every open branch conflict at its
 * tail on every merge). Ported from icelandicstore #355 (2026-09-18) in
 * harvest2-lane0-2026-09-26; the engine's fragments also carry the `<a id>`
 * anchor that ARCHITECTURE / PLAN / features link to, so it is checked here.
 *
 * Filenames sort chronologically and are the only index, so a stray name
 * silently falls out of `ls` order — keep them to the pattern. Slug uniqueness
 * across the archive and the fragments is architectureIndex.test.js's.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/sourceTree');
const { FRAGMENT_DIR, fragmentFiles } = require('../lib/historyAnchors');

const DIR = path.join(ROOT, FRAGMENT_DIR);
// The README says "use the branch name, with / written as -", so this must not
// be stricter than the branch names the estate actually uses (`_` and capitals
// are both legal in git and both appear in dependabot / older branches).
const PATTERN = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const ANCHOR_LINE = /^<a id="[\w-]+"><\/a>$/;
const HEADING_LINE = /^## (\d{4}-\d{2}-\d{2}) — \S/;

const lines = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n').split('\n');

describe('docs/history.d fragments', () => {
  const files = fragmentFiles();
  const all = fs.readdirSync(DIR).filter((f) => f !== 'README.md');

  test('the folder has its README and at least one fragment (guard)', () => {
    expect(fs.existsSync(path.join(DIR, 'README.md'))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  test('every fragment is named YYYY-MM-DD-<branch-name>.md', () => {
    expect(all.filter((f) => !PATTERN.test(f))).toEqual([]);
  });

  test('every fragment carries a real calendar date', () => {
    const bad = files.filter((f) => {
      const iso = f.slice(0, 10);
      const d = new Date(`${iso}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso;
    });
    expect(bad).toEqual([]);
  });

  test('the first line is the <a id> anchor', () => {
    expect(files.filter((f) => !ANCHOR_LINE.test(lines(f)[0]))).toEqual([]);
  });

  test('the next non-empty line is the `## YYYY-MM-DD — <title>` heading', () => {
    const bad = files.filter((f) => {
      const next = lines(f).slice(1).find((l) => l.trim() !== '');
      return !next || !HEADING_LINE.test(next);
    });
    expect(bad).toEqual([]);
  });

  test('the patterns reject what they should (self-check)', () => {
    expect(PATTERN.test('2026-09-26-harvest2-lane0-history.md')).toBe(true);
    expect(PATTERN.test('2026-09-26-dependabot-npm_and_yarn-X.md')).toBe(true);
    expect(PATTERN.test('harvest2-lane0-history.md')).toBe(false);
    expect(PATTERN.test('2026-09-26-.md')).toBe(false);
    expect(ANCHOR_LINE.test('<a id="harvest2-lane0-2026-09-26"></a>')).toBe(true);
    expect(ANCHOR_LINE.test('## 2026-09-26 — x')).toBe(false);
    expect(HEADING_LINE.test('## 2026-09-26 — Harvest 2, lane 0')).toBe(true);
    expect(HEADING_LINE.test('## 2026-09-26 - hyphen, not an em dash')).toBe(false);
  });
});
