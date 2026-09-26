'use strict';

// Product page colour names + variant picker aria-labels. Ported from
// icelandicstore #399/#400 (tests/unit/colorLabels.test.js): the engine's
// product page held English literals ({ black: 'Black' }, "Select Size") that
// leaked onto the Icelandic page, and "Veldu {axis}" read "Veldu litur" — the
// nominative after "velja", which takes the accusative ("Veldu lit").
const { colorLabelKey, chooseAxisKey, colorKey, COLOR_LABEL_KEYS } = require('../../public/js/utils/colorLabels.js');
const en = require('../../public/js/i18n/en.json');
const is = require('../../public/js/i18n/is.json');

const COLOURS = [
  'Black', 'White', 'Rust', 'Sage Green', 'Burgundy', 'French Navy', 'Red',
  'Blush Pink', 'Misty Pink', 'Slate Green', 'Sweet Pink', 'Natural', 'Grey',
  'Navy', 'Beige', 'Pink', 'Green',
];

describe('colour names on the product page', () => {
  test.each(COLOURS)('%s has its own key, in both locales, translated', (colour) => {
    const key = colorLabelKey(colour);
    expect(key).toBeTruthy();
    expect(en[key]).toBeTruthy();
    expect(is[key]).toBeTruthy();
    expect(is[key]).not.toBe(en[key]);
  });

  test('each listed colour names a DIFFERENT key', () => {
    expect(new Set(COLOURS.map(colorLabelKey)).size).toBe(COLOURS.length);
  });

  test('supplier codes, case and spelling do not matter; the exact name beats a partial match', () => {
    expect(colorKey('Sage Green (SAG)')).toBe('sage-green');
    expect(colorLabelKey('Blush Pink (BLP)')).toBe('shop.colorBlushPink');
    expect(colorLabelKey('SAGE GREEN (SAG)')).toBe('shop.colorSageGreen');
    expect(colorLabelKey('French Navy (FRNA)')).toBe('shop.colorFrenchNavy');
    expect(colorLabelKey('black')).toBe('shop.colorBlack');
    expect(colorLabelKey('Sage')).toBe('shop.colorSage');
    expect(colorLabelKey('Gray')).toBe('shop.colorGrey');
  });

  test('the bare family names match only exactly; real shades keep their own name', () => {
    expect(colorLabelKey('Forrest Green')).toBeNull();
    expect(colorLabelKey('Miami Pink (PR)')).toBeNull();
    expect(colorLabelKey('Hot Pink')).toBeNull();
    expect(colorLabelKey('Pink (PK)')).toBe('shop.colorPink');
    expect(colorLabelKey('green')).toBe('shop.colorGreen');
    expect(colorLabelKey('Chartreuse')).toBeNull();
    expect(colorLabelKey('')).toBeNull();
    expect(colorLabelKey(null)).toBeNull();
  });

  test('every key in the table exists in both locales', () => {
    for (const key of Object.values(COLOR_LABEL_KEYS)) {
      expect(en[key]).toBeTruthy();
      expect(is[key]).toBeTruthy();
    }
    expect(is['shop.colorBlack']).toBe('Svartur');
    expect(is['shop.colorNavy']).toBe('Dökkblár');
  });
});

describe('translateVariantLabel (cart and checkout lines)', () => {
  const { translateVariantLabel } = require('../../public/js/utils/colorLabels.js');
  const tIs = (k) => is[k];
  test('a stored "Black / M" reads in the page language; sizes and unknown values stay', () => {
    expect(translateVariantLabel('Black / M', tIs)).toBe('Svartur / M');
    expect(translateVariantLabel('M / Sage green (sag)', tIs)).toBe('M / Salvíugrænn');
    expect(translateVariantLabel('Chartreuse / XL', tIs)).toBe('Chartreuse / XL');
    expect(translateVariantLabel(null, tIs)).toBeNull();
  });
});

describe('variant picker aria-label', () => {
  test('colour and size have whole sentences, in the accusative', () => {
    expect(chooseAxisKey('Color')).toBe('shop.chooseColor');
    expect(chooseAxisKey(' size ')).toBe('shop.chooseSize');
    expect(is['shop.chooseColor']).toBe('Veldu lit');
    expect(is['shop.chooseSize']).toBe('Veldu stærð');
  });

  test('an unknown axis keeps the {axis} template', () => {
    expect(chooseAxisKey('material')).toBeNull();
    expect(is['shop.chooseAxis']).toContain('{axis}');
    expect(en['shop.chooseAxis']).toContain('{axis}');
  });
});

describe('the leak sites read the locale, not literals', () => {
  const fs = require('fs');
  const path = require('path');
  const src = (p) => fs.readFileSync(path.join(__dirname, '../../public/js', p), 'utf8');

  test('ProductView builds its default chrome through t(), not a module-level English object', () => {
    const pv = src('views/ProductView.js');
    expect(pv).not.toMatch(/DEFAULT_CHROME/);
    expect(pv).not.toMatch(/'← Back to shop'/);
    expect(pv).not.toMatch(/>No image</);
    expect(pv).not.toMatch(/aria-label="Select /);
    expect(pv).not.toMatch(/aria-label="Image \$/);
  });

  test('the nav landmark is labelled through t() and relabelled on a locale switch', () => {
    const nav = src('components/NavBar.js');
    expect(nav).not.toMatch(/'Main navigation'/);
    expect(nav.match(/t\('nav\.mainNavigation'\)/g)).toHaveLength(2);
  });

  test('the static skip link is re-translated on localechange', () => {
    expect(src('main.js')).toMatch(/addEventListener\('localechange', translateStaticChrome\)/);
  });
});
