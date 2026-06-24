// Parse a products CSV (the file the admin Products EXPORT produces) into row
// objects keyed by internal field name. Self-contained: a small comma-delimited
// RFC-4180-style splitter (double-quote escaping), no external parser dependency.
// Row 0 is the header. Only columns whose header matches an IMPORTABLE field are
// emitted; blank cells are omitted so "blank = no change" holds on import. SKU is
// always carried (even when blank) so the server can report the row.

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

// Split one CSV line into cells, honouring "double-quoted" fields (a quote inside
// a quoted field is written as ""). Good enough for the export's flat columns.
function splitLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else inQuotes = false;
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// → { rows: [{ sku, ...changedFields }], headers: [...], hasSku: bool }
export function parseProductsCsv(text) {
  let raw = String(text || '');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip a leading UTF-8 BOM
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { rows: [], headers: [], hasSku: false };

  const headerCells = splitLine(lines[0]).map(h => h.trim());
  const fieldByCol  = headerCells.map(h => HEADER_TO_FIELD[h.toLowerCase()] || null);
  const hasSku = fieldByCol.includes('sku');

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]);
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
