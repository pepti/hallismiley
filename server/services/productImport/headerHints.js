// Harvested from icelandicstore salesReport/headerHints.js (ice@4694289, harvest-ice-d-2026-09-24),
// moved under productImport/ because the engine has no salesReport/ folder.
// Shared header-row detection for the consignment/goods-receipt parsers.
// Real-world POS / supplier exports often carry a title or banner row (and a blank
// row) *above* the column headers — e.g. a POS sales report whose first row is
// "POS söluskýrsla: Icelandic Store (15-Jun til 21-Jun)". A naive "row 1 is the
// header" rule then mistakes that banner for the header (it even contains the hint
// word "store"), pushing the real header down into the data. findHeaderIndex scans
// the first few rows and picks the one that looks most like a header — the row
// matching the most distinct field GROUPS (≥2) — so a banner that only hits one
// group (outlet, via "store") is skipped in favour of the real outlet/product/ref/qty
// header. Both parseXlsx.js and parsePdf.js share this so the behaviour can't drift.

// Categorised header vocabulary (EN + IS + supplier + POS outlet terms). Grouped so
// we can count *distinct* roles a candidate header row covers rather than raw keyword
// hits. Hints are matched as substrings (so a compound like "Vörunúmer" hits
// "vörunúmer"); the numeric-cell guard in findHeaderIndex — not short tokens — is what
// keeps data rows from being mistaken for headers, so deliberately-risky 2-3 char
// tokens ("no", "art") that collide with ordinary words ("Nordic", "Postcard") are
// intentionally absent.
const HINT_GROUPS = [
  ['product', 'description', 'desc', 'item', 'name', 'vara', 'lýsing', 'lysing', 'heiti'],
  ['ref', 'sku', 'code', 'model', 'number', 'vörunúmer', 'vorunumer', 'artno'],
  ['barcode', 'ean', 'gtin', 'upc', 'strikamerki', 'strik'],
  ['qty', 'quantity', 'pcs', 'ctn', 'units', 'magn', 'fjöldi', 'fjoldi', 'seld', 'sold', 'selt'],
  ['price', 'fob', 'amount', 'unit', 'verð', 'verd', 'total', 'upphæð'],
  ['outlet', 'store', 'shop', 'location', 'verslun', 'utibu', 'útibú', 'sala', 'bud', 'búð'],
];

// A cell that is purely a number (qty / SKU / price / barcode), tolerant of Icelandic
// formatting ("-2.276,", "1133", "10"). The hallmark of a DATA row — a header row is
// all text labels — so it lets us reject data rows that would otherwise score on
// incidental substring hits (e.g. "Sala …"→outlet, "…Magnet"→magn).
function isNumericCell(c) { return /^\s*-?\d[\d.,\s]*$/.test(String(c == null ? '' : c).trim()); }

// How many distinct field groups a row's cells collectively match.
function headerScore(row) {
  const cells = row.map((c) => String(c == null ? '' : c).toLowerCase());
  let groups = 0;
  for (const g of HINT_GROUPS) {
    if (cells.some((c) => g.some((w) => c.includes(w)))) groups += 1;
  }
  return groups;
}

// Index of the header row within the first `scan` rows: the highest-scoring ELIGIBLE
// row (most distinct field groups), earliest wins on a tie. A row is eligible only if
// it has ≥2 distinct non-empty cells (rejects a lone/repeated title banner) AND no
// purely-numeric cell (rejects a data row — this is what stops a "Sala …/…Magnet/
// 1133/3" line being read as a header and consuming the rows above it). It need only
// match ≥1 field group: the structural guards above — not the group count — separate
// header from banner/data, so a single-group header (e.g. customer-import's
// "Email | Name | Company", where only "Name" is a hint) still resolves. Returns -1
// when nothing qualifies (caller keeps all rows / synthesizes Column N).
function findHeaderIndex(grid, scan = 10) {
  let bestIdx = -1;
  let bestScore = 0; // strictly-greater test below ⇒ a header must match ≥1 field group
  const limit = Math.min(grid.length, scan);
  for (let i = 0; i < limit; i += 1) {
    const cells = grid[i].map((c) => String(c == null ? '' : c).trim());
    const distinct = new Set(cells.filter(Boolean)).size;
    if (distinct < 2) continue;
    if (cells.some(isNumericCell)) continue;
    const score = headerScore(grid[i]);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

module.exports = { HINT_GROUPS, headerScore, findHeaderIndex };
