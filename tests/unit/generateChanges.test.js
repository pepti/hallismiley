// server/scripts/generate-changes.js — the pure parts of the build-host stamp:
// PR-number extraction from a squash-merge subject, and the per-PR opt-out.
// The opt-out is OFF by default: a PR is hidden from the customer-facing list
// only when the developer marks it, by title tag or by body trailer.
const { parsePr, isHidden } = require('../../server/scripts/generate-changes');

describe('parsePr', () => {
  test('reads the "(#NNN)" suffix GitHub appends on squash-merge', () => {
    expect(parsePr('fix(pos): VAT rate (#203)')).toBe(203);
    expect(parsePr('chore: merge open PRs #198, #205, #174 as one (#206)')).toBe(206);
  });

  test('returns null when there is no suffix — never guesses from an inline #', () => {
    expect(parsePr('fix: follow-up to #12 without a merge suffix')).toBeNull();
    expect(parsePr('')).toBeNull();
    expect(parsePr(undefined)).toBeNull();
  });
});

describe('isHidden', () => {
  test('is off by default — an unmarked PR is published', () => {
    expect(isHidden('feat(admin): latest updates card (#210)', 'Adds a card.\n\nCo-Authored-By: x')).toBe(false);
    expect(isHidden('feat: x', '')).toBe(false);
    expect(isHidden('feat: x', 'Customer-visible: yes')).toBe(false);
  });

  test('"[internal]" anywhere in the title hides it, any case', () => {
    expect(isHidden('chore: bump deps [internal] (#211)', '')).toBe(true);
    expect(isHidden('[INTERNAL] refactor importer (#212)', '')).toBe(true);
  });

  test('a "Customer-visible: no" line in the body hides it', () => {
    expect(isHidden('fix: quiet thing (#213)', 'Some context.\n\ncustomer-visible: no\n')).toBe(true);
    expect(isHidden('fix: quiet thing (#213)', 'Customer-Visible:   false')).toBe(true);
  });

  test('the trailer must be a whole line — prose mentioning it does not count', () => {
    expect(isHidden('fix: x', 'We discussed whether customer-visible: no should apply here, and it should not.')).toBe(false);
  });
});
