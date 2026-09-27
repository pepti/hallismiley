// Ported from icelandicstore #182/#265/#270 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26).
'use strict';

/**
 * Colour MATCHING — which photo a variant colour shows, and which palette entry
 * it renders as. Normalisation itself is variantAxis.colorKey's job and is
 * pinned by tests/unit/variantAxisParity.test.js; this file covers the layer
 * built on top of it.
 *
 * The bug this pins: the product page derived the match in the browser by
 * comparing colorKey(image.color) with colorKey(variantValue). TEST is seeded
 * with tidy names (demoData.js: "Navy", "Sage") so it matched perfectly, while
 * PROD carries Shopify's supplier spellings — "French Navy (FRNA)",
 * "Sage Green (SAG)" — against photos tagged `navy` and `sage`. Folding the
 * parenthetical away is not enough: `french-navy` !== `navy`, so 2 of the tee's
 * 5 colours silently showed the wrong garment (reported 2026-09-08).
 *
 * The browser keeps a mirror of the pure helpers for display use, so the parity
 * block below pins the two copies equal — a second matcher drifting from the
 * server's is the whole reason this defect existed.
 */
const {
  keysMatch, matchKnownKey, variantColorValues, resolveColorImages, normaliseColorTag,
} = require('../../server/utils/colorMatch');
const { colorKey } = require('../../server/utils/variantAxis');
// ESM, compiled to CJS by babel-jest — same trick as tests/unit/imageUrl.test.js.
const client = require('../../public/js/utils/colorMatch');

// The exact values live on PROD today (GET /api/v1/shop/products/reykjavik-iceland-classic-t-shirt).
const PROD_COLOR_VALUES = ['Black (BL)', 'White (WH)', 'French Navy (FRNA)', 'Red (RE)', 'Sage Green (SAG)'];
const PROD_IMAGES = [
  { id: 'img-navy',  color: 'navy'  },
  { id: 'img-grey',  color: 'grey'  }, // orphan: no variant is grey
  { id: 'img-sage',  color: 'sage'  },
  { id: 'img-black', color: 'black' },
  { id: 'img-red',   color: 'red'   },
  { id: 'img-white', color: 'white' },
];
const PALETTE = ['black', 'white', 'navy', 'grey', 'sage', 'red'];

describe('matchKnownKey', () => {
  // The palette (swatch fill + display label + sort order) is keyed on tidy
  // names. Without this the navy and sage swatches rendered as empty circles
  // next to a working black one — the same root cause as the photo miss.
  it('maps the supplier spellings onto the palette', () => {
    expect(matchKnownKey('French Navy (FRNA)', PALETTE)).toBe('navy');
    expect(matchKnownKey('Sage Green (SAG)', PALETTE)).toBe('sage');
    expect(matchKnownKey('Black (BL)', PALETTE)).toBe('black');
  });

  it('folds the one spelling variant that is the same word', () => {
    // variantAxis.colorKey is deliberately lossless about spelling, so the
    // gray/grey fold lives in the matching layer instead.
    expect(colorKey('Gray')).toBe('gray');
    expect(matchKnownKey('Gray', PALETTE)).toBe('grey');
    expect(matchKnownKey('GRAY', PALETTE)).toBe('grey');
  });

  it('returns null for a colour the palette does not know', () => {
    expect(matchKnownKey('Burgundy', PALETTE)).toBeNull();
    expect(matchKnownKey('Rust', PALETTE)).toBeNull();
    expect(matchKnownKey('', PALETTE)).toBeNull();
  });

  it('returns null rather than picking one of two candidates', () => {
    expect(matchKnownKey('Blue', ['light-blue', 'dark-blue'])).toBeNull();
  });

  // ProductView ranks the swatch row by looking each catalogue value up in
  // AXIS_ORDER.color through this function. A raw key comparison returned -1
  // for the supplier spellings and dropped Navy and Sage to the end of the row
  // — the same miss as the photo and the fill, one lookup further along. The
  // DOM ordering itself has no test harness (no jsdom, no view tests), so the
  // resolution it depends on is pinned here instead.
  it('ranks every live catalogue colour into the swatch order', () => {
    const ORDER = ['Black', 'Navy', 'Grey', 'Sage', 'Red', 'White'].map(colorKey);
    const ranked = PROD_COLOR_VALUES.map(v => ORDER.indexOf(matchKnownKey(v, ORDER)));
    expect(ranked).toEqual([0, 5, 1, 4, 3]);
    expect(ranked).not.toContain(-1); // -1 sorts to the end: the old behaviour
  });
});

describe('keysMatch', () => {
  it('is symmetric', () => {
    expect(keysMatch('navy', 'french-navy')).toBe(true);
    expect(keysMatch('french-navy', 'navy')).toBe(true);
  });

  it('does not match unrelated colours that share no token', () => {
    expect(keysMatch('navy', 'black')).toBe(false);
    expect(keysMatch('sage', 'forest-green')).toBe(false);
  });

  it('is false on empty input', () => {
    expect(keysMatch('', 'navy')).toBe(false);
    expect(keysMatch('navy', '')).toBe(false);
  });
});

describe('parity between the server and browser copies', () => {
  test.each([
    'French Navy (FRNA)', 'Sage Green (SAG)', 'Black (BL)', 'Burgundy',
    'Light Olive', 'Gray', 'Sweet Pink (SL)', '',
  ])('both copies resolve %p to the same palette entry', (input) => {
    expect(client.matchKnownKey(input, PALETTE)).toBe(matchKnownKey(input, PALETTE));
  });

  test.each([
    ['navy', 'french-navy'], ['sage', 'sage-green'], ['navy', 'black'],
    ['gray', 'grey'], ['', 'navy'],
  ])('both copies agree whether %p matches %p', (a, b) => {
    expect(client.keysMatch(a, b)).toBe(keysMatch(a, b));
  });
});

describe('colorOptions (admin per-photo colour picker)', () => {
  // Found by hand on TEST, 2026-09-09. The tee there carries a live demo grid
  // ("Navy", "Sage") on top of the retired import spellings ("French Navy
  // (FRNA)", "Sage Green (SAG)"), which are INACTIVE. Listing the inactive ones
  // made the `navy` tag match two options, so _matchedColorKey declined to
  // guess and the admin showed "not colour-specific" for a photo the storefront
  // was swapping correctly — the storefront resolves activeOnly variants.
  const TEST_TEE_VARIANTS = [
    { active: false, attributes: { Color: 'Black (BL)', Size: 'M' } },
    { active: false, attributes: { Color: 'French Navy (FRNA)', Size: 'M' } },
    { active: false, attributes: { Color: 'Sage Green (SAG)', Size: 'M' } },
    { active: true,  attributes: { Color: 'Black', Size: 'M' } },
    { active: true,  attributes: { Color: 'Navy',  Size: 'M' } },
    { active: true,  attributes: { Color: 'Sage',  Size: 'M' } },
  ];

  it('offers only the colours a shopper can actually select', () => {
    expect(client.colorOptions(TEST_TEE_VARIANTS, 'Color').map(c => c.key))
      .toEqual(['black', 'navy', 'sage']);
  });

  it('leaves the navy tag unambiguous once the retired spelling is excluded', () => {
    const opts = client.colorOptions(TEST_TEE_VARIANTS, 'Color');
    const hits = opts.filter(c => client.keysMatch('navy', c.key));
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('navy');
  });

  it('keeps the raw value as the label, and dedupes by key', () => {
    expect(client.colorOptions([
      { active: true, attributes: { Color: 'French Navy (FRNA)', Size: 'S' } },
      { active: true, attributes: { Color: 'French Navy (FRNA)', Size: 'M' } },
    ], 'Color')).toEqual([{ key: 'french-navy', label: 'French Navy (FRNA)' }]);
  });

  it('folds the attribute key case against the declared axis name', () => {
    // variant_axes may say "Color" while the row was written with "color".
    expect(client.colorOptions([{ active: true, attributes: { color: 'Red (RE)' } }], 'Color'))
      .toEqual([{ key: 'red', label: 'Red (RE)' }]);
  });

  it('skips a row that carries the axis twice in different cases', () => {
    expect(client.colorOptions([
      { active: true, attributes: { Color: 'Red', color: 'Blue' } },
      { active: true, attributes: { Color: 'Black' } },
    ], 'Color')).toEqual([{ key: 'black', label: 'Black' }]);
  });

  it('treats a row with no active flag as active', () => {
    // The staged rows in the new-product form have no `active` yet.
    expect(client.colorOptions([{ attributes: { Color: 'Black' } }], 'Color'))
      .toEqual([{ key: 'black', label: 'Black' }]);
  });

  it('is empty for junk input', () => {
    expect(client.colorOptions([], 'Color')).toEqual([]);
    expect(client.colorOptions(null, 'Color')).toEqual([]);
    expect(client.colorOptions([{ active: true, attributes: { Size: 'M' } }], 'Color')).toEqual([]);
  });
});

describe('prettyColor (browser display fallback)', () => {
  it('drops the supplier code a shopper should never see', () => {
    expect(client.prettyColor('French Navy (FRNA)')).toBe('French Navy');
    expect(client.prettyColor('Sweet Pink (SL)')).toBe('Sweet Pink');
  });

  it('is empty for empty input, so callers can fall back', () => {
    expect(client.prettyColor('')).toBe('');
    expect(client.prettyColor(null)).toBe('');
  });
});

describe('normaliseColorTag', () => {
  it('stores the folded key so a tag and a variant value compare equal', () => {
    expect(normaliseColorTag('French Navy (FRNA)')).toBe('french-navy');
  });

  it('treats blank as "not colour-specific"', () => {
    expect(normaliseColorTag('')).toBeNull();
    expect(normaliseColorTag('   ')).toBeNull();
    expect(normaliseColorTag(null)).toBeNull();
  });
});

describe('variantColorValues', () => {
  it('reads the colour axis whatever case the source spelled it', () => {
    expect(variantColorValues([
      { attributes: { Color: 'Black (BL)', Size: 'M' } },
      { attributes: { color: 'White (WH)', size: 'L' } },
    ])).toEqual(['Black (BL)', 'White (WH)']);
  });

  it('de-duplicates by normalised key and keeps first-seen order', () => {
    expect(variantColorValues([
      { attributes: { Color: 'Black (BL)', Size: 'S' } },
      { attributes: { Color: 'Black (BL)', Size: 'M' } },
      { attributes: { Color: 'Red (RE)',   Size: 'S' } },
    ])).toEqual(['Black (BL)', 'Red (RE)']);
  });

  it('ignores products with no colour axis', () => {
    expect(variantColorValues([{ attributes: { Size: 'M' } }])).toEqual([]);
    expect(variantColorValues([])).toEqual([]);
    expect(variantColorValues(null)).toEqual([]);
  });
});

describe('resolveColorImages', () => {
  it("matches every one of PROD's real colour spellings — the reported bug", () => {
    expect(resolveColorImages(PROD_IMAGES, PROD_COLOR_VALUES)).toEqual({
      black: 'img-black',
      white: 'img-white',
      red: 'img-red',
      'french-navy': 'img-navy',
      'sage-green': 'img-sage',
    });
  });

  it('leaves a photo that no variant colour claims out of the map', () => {
    const map = resolveColorImages(PROD_IMAGES, PROD_COLOR_VALUES);
    expect(Object.values(map)).not.toContain('img-grey');
  });

  it('matches on exact equality first', () => {
    expect(resolveColorImages([{ id: 'a', color: 'navy' }], ['Navy'])).toEqual({ navy: 'a' });
  });

  it('matches by token containment in either direction', () => {
    expect(resolveColorImages([{ id: 'a', color: 'navy' }], ['French Navy (FRNA)']))
      .toEqual({ 'french-navy': 'a' });
    expect(resolveColorImages([{ id: 'a', color: 'french-navy' }], ['Navy']))
      .toEqual({ navy: 'a' });
  });

  it('refuses to guess when one photo could serve two colours', () => {
    // A single "green" photo cannot stand for both. Showing the same garment
    // for two different swatches reads as a broken page.
    expect(resolveColorImages([{ id: 'g', color: 'green' }], ['Sage Green (SAG)', 'Forest Green']))
      .toEqual({});
  });

  it('refuses to hand one photo to both its exact colour and a near one', () => {
    // "navy" is exactly the Navy photo. It must not ALSO be served for
    // "French Navy (FRNA)" just because navy ⊆ french-navy. This is the
    // exact+fuzzy collision; the fuzzy+fuzzy case is covered above.
    expect(resolveColorImages([{ id: 'a', color: 'navy' }], ['Navy', 'French Navy (FRNA)']))
      .toEqual({ navy: 'a' });
    // Order of the colour values must not change the outcome.
    expect(resolveColorImages([{ id: 'a', color: 'navy' }], ['French Navy (FRNA)', 'Navy']))
      .toEqual({ navy: 'a' });
  });

  it('refuses to guess when one colour could take two photos', () => {
    expect(resolveColorImages(
      [{ id: 'a', color: 'light-blue' }, { id: 'b', color: 'dark-blue' }],
      ['Blue']
    )).toEqual({});
  });

  it('still resolves the unambiguous colours when a sibling is ambiguous', () => {
    expect(resolveColorImages(
      [{ id: 'g', color: 'green' }, { id: 'k', color: 'black' }],
      ['Sage Green (SAG)', 'Forest Green', 'Black (BL)']
    )).toEqual({ black: 'k' });
  });

  it('returns an empty map when nothing is tagged, so the gallery is left alone', () => {
    expect(resolveColorImages([{ id: 'a', color: null }, { id: 'b' }], ['Black (BL)'])).toEqual({});
    expect(resolveColorImages([], ['Black (BL)'])).toEqual({});
    expect(resolveColorImages(null, null)).toEqual({});
  });

  it('ignores a colour with no photo rather than falling back to the first', () => {
    expect(resolveColorImages([{ id: 'a', color: 'black' }], ['Black (BL)', 'Red (RE)']))
      .toEqual({ black: 'a' });
  });
});
