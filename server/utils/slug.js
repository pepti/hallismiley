// Slug helpers for machine-generated slugs (ice #229).
//
// Hand-written slugify()s that strip anything outside [a-z0-9] mangle
// Icelandic titles: "Lopapeysa Þórs" becomes "lopapeysa-rs". Fold the
// Icelandic letters and diacritics FIRST and the same title yields
// "lopapeysa-thors".
//
// Used only where a slug is GENERATED because the caller supplied none (news
// and sales-guide create paths, the party category key). Existing slugs are
// never rewritten — a live URL must not silently change shape — and a caller
// that supplies its own slug keeps it verbatim. The collections form has an
// ESM twin at public/js/utils/slug.js: keep the two in sync.

const MAX_SLUG_LEN = 80;

function foldIcelandic(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae').replace(/ö/g, 'o')
    .normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Fold, then slugify. Returns '' when nothing usable survives (e.g. a title
 * that is all punctuation or non-Latin script) — callers decide the fallback.
 * @param {string} s
 * @returns {string} lowercase [a-z0-9-], no leading/trailing '-', ≤ 80 chars, or ''
 */
function foldSlug(s) {
  return foldIcelandic(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/, ''); // a trailing '-' left behind by the length clamp
}

module.exports = { foldSlug, foldIcelandic, MAX_SLUG_LEN };
