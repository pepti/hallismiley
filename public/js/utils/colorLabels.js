// Shopper-facing colour names and the variant pickers' accessible names, as
// locale KEYS (resolved through t() by the caller). Pure module, no DOM, so a
// unit test can walk the whole colour list against both locale files.
//
// Ported from icelandicstore #399/#400 (2026-09-21/22): the product page held
// English literals ({ black: 'Black', white: 'White' }, 'Select Size') that
// leaked onto the Icelandic page. Lane 4b inlined ice's colour normaliser here
// because the engine did not carry utils/variantAxis.js + utils/colorMatch.js;
// lane 6c (2026-09-26) ported those, so this module imports them again as ice
// does — one definition of "how a colour value folds to a key".
//
// Colour values arrive however the catalogue spelled them: "Sage Green (SAG)",
// "BLACK", "french_navy" → colorKey → "sage-green". Re-exported for callers
// (and tests) that import it from here.
import { colorKey } from './variantAxis.js';
import { matchKnownKey } from './colorMatch.js';

export { colorKey };

// Keyed by colorKey(). The exact key wins before any partial match, so
// "Blush Pink" finds blush-pink and never the plain pink.
export const COLOR_LABEL_KEYS = {
  black: 'shop.colorBlack',
  white: 'shop.colorWhite',
  navy: 'shop.colorNavy',
  'french-navy': 'shop.colorFrenchNavy',
  grey: 'shop.colorGrey',
  sage: 'shop.colorSage',
  'sage-green': 'shop.colorSageGreen',
  'slate-green': 'shop.colorSlateGreen',
  green: 'shop.colorGreen',
  red: 'shop.colorRed',
  rust: 'shop.colorRust',
  burgundy: 'shop.colorBurgundy',
  pink: 'shop.colorPink',
  'blush-pink': 'shop.colorBlushPink',
  'misty-pink': 'shop.colorMistyPink',
  'sweet-pink': 'shop.colorSweetPink',
  natural: 'shop.colorNatural',
  beige: 'shop.colorBeige',
};

// Bare family names: matched only when the value IS that name. As a partial
// match they swallowed real shades ("Forrest Green" read "Grænn"), which throws
// away the one thing that tells two garments apart. An unlisted shade keeps
// its own name instead.
const EXACT_ONLY = new Set(['pink', 'green']);

const LABEL_KEYS = Object.keys(COLOR_LABEL_KEYS);
const PARTIAL_KEYS = LABEL_KEYS.filter((k) => !EXACT_ONLY.has(k));

/** The locale key naming `value` for a shopper, or null for an unlisted colour. */
export function colorLabelKey(value) {
  const key = colorKey(value);
  if (EXACT_ONLY.has(key)) return COLOR_LABEL_KEYS[key];
  const known = matchKnownKey(value, PARTIAL_KEYS);
  return known ? COLOR_LABEL_KEYS[known] : null;
}

// A basket line's stored variant label ("Black / M", built from the raw
// catalogue values when the line was added) in the reader's language: each
// " / " part that names a known colour is swapped for its label; sizes and
// unlisted values stay as stored. `t` is the i18n function (passed in so this
// module stays pure). Used by the cart and checkout at render time, so a
// locale switch re-labels an existing basket.
export function translateVariantLabel(label, t) {
  if (!label) return label;
  return String(label).split(' / ').map((part) => {
    const key = colorLabelKey(part);
    return key ? t(key) : part;
  }).join(' / ');
}

// "Veldu {axis}" put the axis in the nominative ("Veldu litur"); Icelandic wants
// the accusative after velja ("Veldu lit"), and the case differs per word — so
// the known axes get a whole sentence each. An unknown axis keeps the template.
const CHOOSE_AXIS_KEYS = { color: 'shop.chooseColor', colour: 'shop.chooseColor', size: 'shop.chooseSize' };

/** The locale key for a variant picker's aria-label, or null → use shop.chooseAxis. */
export function chooseAxisKey(axis) {
  return CHOOSE_AXIS_KEYS[String(axis || '').trim().toLowerCase()] || null;
}
