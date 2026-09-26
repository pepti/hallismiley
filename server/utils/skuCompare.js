// Ported from icelandicstore #8 (ice@941cf51d; harvest 2 lane 6c, 2026-09-26)
// — the file as ice ships it. Engine user: services/pdfService.js (the
// delivery note walks the shelves: bin, then SKU).
//
// Natural-order comparator. Used for both SKUs (product numbers) and BIN ids
// (the warehouse shelf location). "Walking order" needs numeric runs compared as
// numbers ("B-2" before "B-10"), not lexicographically. Case-insensitive;
// missing/empty values sort last.

// Split into alternating digit / non-digit runs: "AB12-3" → ["AB", "12", "-", "3"]
function tokenize(sku) {
  return String(sku).match(/\d+|\D+/g) || [];
}

function compareSku(a, b) {
  const aEmpty = a == null || String(a).trim() === '';
  const bEmpty = b == null || String(b).trim() === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const ta = tokenize(String(a).trim());
  const tb = tokenize(String(b).trim());
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const x = ta[i];
    const y = tb[i];
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      // Same value, different padding ("007" vs "7") — shorter first, stable.
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    } else if (xNum !== yNum) {
      // Digits sort before letters so "A1" precedes "AA".
      return xNum ? -1 : 1;
    } else {
      const diff = x.toLowerCase().localeCompare(y.toLowerCase(), 'en');
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
  }
  if (ta.length !== tb.length) return ta.length < tb.length ? -1 : 1;
  return 0;
}

// compareBin / naturalCompare are aliases — the algorithm is value-neutral, so
// BIN ids (e.g. "F-77" before "F-100") sort the same way SKUs do.
module.exports = { compareSku, compareBin: compareSku, naturalCompare: compareSku };
