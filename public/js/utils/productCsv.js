// Parse a products CSV (the file the admin Products EXPORT produces) into row
// objects keyed by internal field name. Uses the shared RFC-4180 record parser
// (quoted fields + embedded newlines). Row 0 is the header. Only columns whose
// header matches an IMPORTABLE field are emitted; blank cells are omitted so
// "blank = no change" holds on import. SKU is always carried (even when blank) so
// the server can report the row.
import { parseCsvRecords } from './csv.js';

// header (lowercased) → internal field. Name / Variant / Barcode are export-only
// context columns and are intentionally absent here, so they're never imported.
const HEADER_TO_FIELD = {
  'sku':       'sku',
  'bin':       'bin',
  'price isk': 'price_isk',
  'price eur': 'price_eur',
  'stock':     'stock',
  'active':    'active',
};

// → { rows: [{ sku, ...changedFields }], headers: [...], hasSku: bool }
export function parseProductsCsv(text) {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [], headers: [], hasSku: false };

  const headerCells = records[0].map(h => h.trim());
  const fieldByCol  = headerCells.map(h => HEADER_TO_FIELD[h.toLowerCase()] || null);
  const hasSku = fieldByCol.includes('sku');

  const rows = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i];
    const row = {};
    fieldByCol.forEach((field, idx) => {
      if (!field) return;
      const cell = cells[idx] != null ? String(cells[idx]).trim() : '';
      if (field === 'sku') { row.sku = cell; return; }
      if (cell === '') return; // blank ⇒ no change
      row[field] = cell;
    });
    if (row.sku || Object.keys(row).length) rows.push(row);
  }
  return { rows, headers: headerCells, hasSku };
}
