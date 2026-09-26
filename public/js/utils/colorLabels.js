// Shopper-facing colour names and the variant pickers' accessible names, as
// locale KEYS (resolved through t() by the caller). Pure module, no DOM, so a
// unit test can walk the whole colour list against both locale files.
//
// Ported from icelandicstore #399/#400 (2026-09-21/22): the product page held
// English literals ({ black: 'Black', white: 'White' }, 'Select Size') that
// leaked onto the Icelandic page. Trimmed for the engine: ice imports its
// colour normaliser from utils/variantAxis.js and utils/colorMatch.js, which the
// engine does not carry; the two helpers below are the same rules, inlined.

// Colour values arrive however the catalogue spelled them: "Sage Green (SAG)",
// "BLACK", "french_navy". Lower-case, shed a trailing supplier code in
// parentheses, and fold spaces/underscores to hyphens → "sage-green".
export function colorKey(value) {
  return String(value || '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

// Spelling variants of ONE colour name (not a synonym table).
const SPELLING_ALIASES = { gray: 'grey' };
const aliased = (key) => SPELLING_ALIASES[key] || key;
const tokensOf = (key) => key.split('-').filter(Boolean);
const contained = (inner, outer) => inner.length > 0 && inner.every((t) => outer.includes(t));

// The single entry of `known` naming the same colour as `value`, else null:
// exact first, then one key's words wholly inside the other's ("navy" ⊆
// "french-navy"). Two partial matches are ambiguous and return null.
function matchKnownKey(value, known) {
  const key = aliased(colorKey(value));
  if (!key) return null;
  if (known.includes(key)) return key;
  const kt = tokensOf(key);
  const near = known.filter((k) => {
    const t = tokensOf(aliased(k));
    return contained(t, kt) || contained(kt, t);
  });
  return near.length === 1 ? near[0] : null;
}

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

// "Veldu {axis}" put the axis in the nominative ("Veldu litur"); Icelandic wants
// the accusative after velja ("Veldu lit"), and the case differs per word — so
// the known axes get a whole sentence each. An unknown axis keeps the template.
const CHOOSE_AXIS_KEYS = { color: 'shop.chooseColor', colour: 'shop.chooseColor', size: 'shop.chooseSize' };

/** The locale key for a variant picker's aria-label, or null → use shop.chooseAxis. */
export function chooseAxisKey(axis) {
  return CHOOSE_AXIS_KEYS[String(axis || '').trim().toLowerCase()] || null;
}
