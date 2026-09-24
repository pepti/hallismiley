'use strict';

const { generatePassword, ALPHABET } = require('../../server/utils/generatePassword');

describe('generatePassword', () => {
  test('is 4 groups of 5 symbols from the no-lookalike alphabet', () => {
    const pw = generatePassword();
    const groups = pw.split('-');
    expect(groups).toHaveLength(4);
    for (const g of groups) {
      expect(g).toHaveLength(5);
      for (const ch of g) expect(ALPHABET).toContain(ch);
    }
  });

  test('carries no character that gets misread off a handwritten note', () => {
    // 0/O, 1/I/L and U (reads as V) are the pairs a warehouse actually confuses.
    const many = Array.from({ length: 200 }, generatePassword).join('');
    expect(many).not.toMatch(/[01OILU]/);
  });

  test('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, generatePassword));
    expect(seen.size).toBe(500);
  });

  test('draws uniformly — deleting the rejection step fails this', () => {
    // The naive `byte % 30` does not STARVE anything (every symbol still
    // appears), it over-weights: 256 = 8×30 + 16, so the first 16 symbols get
    // nine chances each and the last 14 get eight. So counting distinct symbols
    // proves nothing — the split between those two groups is what moves.
    //   unbiased  16/30      = 0.5333
    //   biased    (16×9)/256 = 0.5625   ← +2.9 points
    // At 100k symbols one standard deviation of that proportion is 0.0016, so
    // the tolerance below sits ~3σ from honest and ~18σ from biased.
    const head = new Set(ALPHABET.slice(0, 16));
    const symbols = Array.from({ length: 5000 }, generatePassword).join('').replace(/-/g, '');
    expect(symbols).toHaveLength(100_000);

    const share = [...symbols].filter((c) => head.has(c)).length / symbols.length;
    expect(share).toBeGreaterThan(16 / 30 - 0.006);
    expect(share).toBeLessThan(16 / 30 + 0.006);

    // And nothing is missing either, which a narrower alphabet would show.
    const drawn = new Set(symbols);
    for (const ch of ALPHABET) expect(drawn.has(ch)).toBe(true);
  });
});
