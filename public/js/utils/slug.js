// ESM twin of server/utils/slug.js — keep the two in sync (ice #229).
//
// Folds Icelandic letters and diacritics before slugifying so a collection
// titled "Þórsmörk" proposes "thorsmork", not "rsm-rk". Output matches the
// server's collection slug validator ([a-z0-9-], ≤ 80 chars).

export const MAX_SLUG_LEN = 80;

export function foldIcelandic(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae').replace(/ö/g, 'o')
    .normalize('NFD').replace(/\p{M}/gu, '');
}

export function foldSlug(s) {
  return foldIcelandic(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/, '');
}
