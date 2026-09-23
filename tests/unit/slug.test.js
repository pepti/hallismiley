// server/utils/slug.js — Icelandic-aware slug generation (ice #229).
const { foldSlug, foldIcelandic, MAX_SLUG_LEN } = require('../../server/utils/slug');

describe('foldIcelandic', () => {
  test('folds ð þ æ ö and strips diacritics', () => {
    expect(foldIcelandic('Þórður Ægir Öskudóttir')).toBe('thordur aegir oskudottir');
  });
  test('trims and lowercases', () => {
    expect(foldIcelandic('  ÁSGEIR ')).toBe('asgeir');
  });
  test('null / undefined → empty string', () => {
    expect(foldIcelandic(null)).toBe('');
    expect(foldIcelandic(undefined)).toBe('');
  });
});

describe('foldSlug', () => {
  test('"Lopapeysa Þórs" → "lopapeysa-thors" (the hand-written slugify gave "lopapeysa-rs")', () => {
    expect(foldSlug('Lopapeysa Þórs')).toBe('lopapeysa-thors');
  });
  test('collapses runs of separators and trims edge hyphens', () => {
    expect(foldSlug('  Hello,   World! — Post  ')).toBe('hello-world-post');
  });
  test('ö → o (sales-guide fixture)', () => {
    expect(foldSlug('Sölusagan')).toBe('solusagan');
  });
  test('clamps to MAX_SLUG_LEN without a trailing hyphen', () => {
    const long = Array.from({ length: 30 }, (_, i) => `ab${i}`).join(' ');
    const slug = foldSlug(long);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LEN);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
  test('all punctuation or non-Latin script → "" so the caller can fall back', () => {
    expect(foldSlug('!!! ???')).toBe('');
    expect(foldSlug('日本語')).toBe('');
  });
  test('output satisfies the collection slug validator', () => {
    const re = /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/;
    for (const s of ['Þórsmörk', 'Ný vara 2026', 'Jólagjafir – börn']) {
      expect(foldSlug(s)).toMatch(re);
    }
  });
});
