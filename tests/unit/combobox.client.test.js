'use strict';

/**
 * public/js/components/Combobox.js — the pure ranking/labelling helpers behind the
 * searchable dropdown. The component itself needs a DOM, but these three do not,
 * and they carry the bug that made the product-components picker unusable: an
 * object entry ({ value, label }) rendered as "[object Object]" because the render
 * path was the one place that skipped labelOf(). Pure module — no window — compiled
 * from ESM by babel-jest.
 */
const { rank, labelOf, highlight, metaOf, optionHtml } = require('../../public/js/components/Combobox.js');

describe('meta — the quiet right-hand note of an object entry', () => {
  test('metaOf: only object entries with a meta have one', () => {
    expect(metaOf({ value: 'c1', label: 'Clippers ehf', meta: 'Umboðssala · 3 verslanir' })).toBe('Umboðssala · 3 verslanir');
    expect(metaOf({ value: 'c1', label: 'Clippers ehf' })).toBe('');
    expect(metaOf('Keychain')).toBe('');
    expect(metaOf(null)).toBe('');
  });

  test('a plain row keeps its bare markup (no wrapper spans)', () => {
    expect(optionHtml('Keychain', 0, 'key')).toBe('<li class="combobox__opt" role="option" id="cb-opt-0" data-i="0"><mark>Key</mark>chain</li>');
  });

  test('a row with meta wraps the label and appends the escaped note', () => {
    const html = optionHtml({ value: 'c1', label: 'Clippers ehf', meta: 'A & B <x>' }, 2, 'cli');
    expect(html).toContain('class="combobox__opt combobox__opt--meta"');
    expect(html).toContain('id="cb-opt-2" data-i="2"');
    expect(html).toContain('<span class="combobox__label"><mark>Cli</mark>ppers ehf</span>');
    expect(html).toContain('<span class="combobox__meta">A &amp; B &lt;x&gt;</span>');
  });

  test('typing never matches the meta — rank looks at the label only', () => {
    const entries = [{ value: 'c1', label: 'Clippers ehf', meta: 'Umboðssala' }, { value: 'c2', label: 'Perlan', meta: '' }];
    expect(rank(entries, 'umbo')).toEqual([]);
    expect(rank(entries, 'perl').map((e) => e.value)).toEqual(['c2']);
  });
});

describe('labelOf', () => {
  test('a string entry is its own label', () => {
    expect(labelOf('Keychain')).toBe('Keychain');
  });

  test('an object entry shows its label, not its value', () => {
    expect(labelOf({ value: 'p1', label: 'Blank Tee — BLK-1' })).toBe('Blank Tee — BLK-1');
  });

  test('an object with no label falls back to the value', () => {
    expect(labelOf({ value: 'p1' })).toBe('p1');
  });

  test('null and undefined do not throw', () => {
    expect(labelOf(null)).toBe('null');
    expect(labelOf(undefined)).toBe('undefined');
  });
});

describe('rank', () => {
  test('an empty query returns every entry, as a copy', () => {
    const src = ['Mug', 'Keychain'];
    const out = rank(src, '');
    expect(out).toEqual(src);
    // A copy, not the caller's array — the component slices it to `max` afterwards.
    expect(out).not.toBe(src);
  });

  test('prefix matches rank before substring matches', () => {
    expect(rank(['Keychain', 'Chain Mug'], 'chain')).toEqual(['Chain Mug', 'Keychain']);
  });

  test('matching is case-insensitive both ways', () => {
    expect(rank(['KEYCHAIN'], 'key')).toEqual(['KEYCHAIN']);
    expect(rank(['keychain'], 'KEY')).toEqual(['keychain']);
  });

  test('non-matching entries are dropped', () => {
    expect(rank(['Mug', 'Keychain'], 'zzz')).toEqual([]);
  });

  test('object entries rank on their label, not on String(entry)', () => {
    const tee = { value: 'p1', label: 'Blank Tee' };
    const mug = { value: 'p2', label: 'Mug' };
    // Were this String(entry), both would be "[object Object]" and 'tee' would match neither.
    expect(rank([mug, tee], 'tee')).toEqual([tee]);
  });
});

describe('highlight', () => {
  test('wraps the matched run in <mark>', () => {
    expect(highlight('Keychain', 'key')).toBe('<mark>Key</mark>chain');
  });

  test('an empty query returns the escaped text unchanged', () => {
    expect(highlight('Mug & Co', '')).toBe('Mug &amp; Co');
  });

  test('a non-match returns the escaped text unchanged', () => {
    expect(highlight('Mug', 'zzz')).toBe('Mug');
  });

  test('REGRESSION: an object entry, labelled first, never renders [object Object]', () => {
    const entry = { value: 'p1', label: 'Blank Tee — BLK-1' };
    const out = highlight(labelOf(entry), 'tee');
    expect(out).not.toContain('object Object');
    expect(out).toBe('Blank <mark>Tee</mark> — BLK-1');
  });

  test('markup in a label is escaped on both sides of the match', () => {
    const out = highlight('<script>alert(1)</script>', 'alert');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<mark>alert</mark>');
    expect(out).not.toContain('<script>');
  });
});

// Engine addition (harvest 2 lane 4a): ice #398 added hidden `keywords` without a
// unit test. The engine's member search (AdminRolesView) depends on them — the
// server matches on email and username, and without keywords the client re-rank
// would drop an email-only hit.
describe('keywords — hidden match text of an object entry', () => {
  const { keywordsOf } = require('../../public/js/components/Combobox.js');

  test('keywordsOf: string or array, lowercased, never spanning two keywords', () => {
    expect(keywordsOf({ value: 'u1', label: 'Jón', keywords: 'JON@Example.is' })).toBe('jon@example.is');
    expect(keywordsOf({ value: 'u1', label: 'Jón', keywords: ['jon', null, 'jon@x.is'] })).toBe('jon | jon@x.is');
    expect(keywordsOf({ value: 'u1', label: 'Jón' })).toBe('');
    expect(keywordsOf('Jón')).toBe('');
  });

  test('a keyword-only hit is kept, and ranks after every label match', () => {
    const byEmail = { value: 'u1', label: 'Jón Jónsson', keywords: ['jj', 'anna.admin@x.is'] };
    const byName = { value: 'u2', label: 'Anna', keywords: ['anna'] };
    expect(rank([byEmail, byName], 'anna').map((e) => e.value)).toEqual(['u2', 'u1']);
  });

  test('option ids take a per-instance prefix (engine delta: no duplicate ids across comboboxes)', () => {
    expect(optionHtml('Jón', 3, '', 'cb7-opt')).toContain('id="cb7-opt-3"');
    // The default keeps ice's shape, so the ported assertions above still hold.
    expect(optionHtml('Jón', 3, '')).toContain('id="cb-opt-3"');
  });

  test('keywords are never shown — the row renders the label only', () => {
    const html = optionHtml({ value: 'u1', label: 'Jón', keywords: 'secret@x.is' }, 0, 'secret');
    expect(html).not.toContain('secret@x.is');
  });
});
