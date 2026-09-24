// Harvested from icelandicstore goodsReceipt/parseXlsx.js (ice@4694289, harvest-ice-d-2026-09-24),
// moved under productImport/ because the engine has no goodsReceipt/ folder.
// Parse an uploaded .xlsx (supplier invoice / packing list / POS sales report)
// into the SAME grid shape the client's parseSalesReport.parseGrid produces —
// { headerRow, headers, rows:[[...]] } — so the column-map + preview path works
// identically for pasted text and uploaded spreadsheets.
// Reads ALL sheets and concatenates their rows (duplicate header rows on
// subsequent sheets are dropped), so POS reports that split categories across
// tabs are handled transparently. The client does the field mapping + fuzzy match.
const ExcelJS = require('exceljs');
const { findHeaderIndex } = require('./headerHints');

// Flatten an ExcelJS cell value (string / number / date / rich text / hyperlink /
// formula result / shared formula) to a trimmed string.
function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim();             // hyperlink
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text || '').join('').trim();
    if (value.result != null) return cellText(value.result);                  // formula
    if (value.hyperlink && value.text == null) return String(value.hyperlink).trim();
  }
  return String(value).trim();
}

// Parse one worksheet into a dense grid, dropping fully-blank rows.
// `rowNumbers[i]` is the spreadsheet row grid[i] came from — the grid index is
// not, once a blank row has been dropped above it.
function readSheet(ws) {
  const grid = [];
  const rowNumbers = [];
  let maxCols = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell) => { vals.push(cellText(cell.value)); });
    if (vals.some((v) => v !== '')) { grid.push(vals); rowNumbers.push(row.number); maxCols = Math.max(maxCols, vals.length); }
  });
  for (const r of grid) while (r.length < maxCols) r.push('');
  return { grid, maxCols, rowNumbers };
}

// buffer → [{ name, grid, rowNumbers }] — every worksheet as its own dense grid, nothing
// merged and no header guessed. For a caller that must pick ONE sheet (a supplier
// count workbook carries working sheets beside the one to load); parseXlsxBuffer
// below concatenates instead, which is right for a report split across tabs.
async function readWorkbookSheets(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.filter(Boolean).map((ws) => {
    const { grid, rowNumbers } = readSheet(ws);
    return { name: String(ws.name || ''), grid, rowNumbers };
  });
}

// buffer (Node Buffer of the .xlsx) → { headerRow, headers, rows }.
// Reads ALL sheets and concatenates their rows. On the FIRST sheet a leading
// title/banner row (+ blank row) above the column header is skipped via
// findHeaderIndex. On SUBSEQUENT sheets only a repeated title or an exact copy of the
// captured header is stripped (never a data row), so a product-category-per-sheet POS
// report merges cleanly without dropping lines from a header-less continuation sheet.
async function parseXlsxBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  if (!wb.worksheets.length) return { headerRow: false, headers: [], rows: [] };

  let headerRow = false;
  let headers = [];
  let globalMaxCols = 0;
  const allRows = [];

  for (let si = 0; si < wb.worksheets.length; si++) {
    const ws = wb.worksheets[si];
    if (!ws) continue;
    const { grid, maxCols } = readSheet(ws);
    if (!grid.length) continue;
    globalMaxCols = Math.max(globalMaxCols, maxCols);

    const hIdx = findHeaderIndex(grid);
    if (si === 0) {
      // First sheet: the header row defines the columns; rows above it are preamble.
      headerRow = hIdx >= 0;
      headers = headerRow ? grid[hIdx].slice() : grid[0].map((_, i) => `Column ${i + 1}`);
      const start = headerRow ? hIdx + 1 : 0;
      for (let ri = start; ri < grid.length; ri++) allRows.push(grid[ri].slice());
    } else {
      // Subsequent sheets: strip ONLY a leading title/banner (a single distinct
      // value) or a row that exactly repeats the captured header — never a data row.
      // (Re-running findHeaderIndex here could pick a high-scoring DATA row as the
      // "header" and silently drop every line above it on a header-less continuation
      // sheet.)
      const hdrKey = headers.map((c) => String(c).toLowerCase().trim()).join('\t');
      let start = 0;
      while (start < grid.length) {
        const cells = grid[start].map((c) => String(c).trim());
        const distinct = new Set(cells.filter(Boolean)).size;
        const isHeaderDup = headerRow && cells.length >= headers.length
          && cells.slice(0, headers.length).map((c) => c.toLowerCase()).join('\t') === hdrKey;
        if (distinct < 2 || isHeaderDup) start += 1; else break;
      }
      for (let ri = start; ri < grid.length; ri++) allRows.push(grid[ri].slice());
    }
  }

  if (!allRows.length) return { headerRow, headers, rows: [] };
  // Pad headers and all rows to the widest column count across all sheets.
  while (headers.length < globalMaxCols) headers.push(`Column ${headers.length + 1}`);
  for (const r of allRows) while (r.length < globalMaxCols) r.push('');
  return { headerRow, headers, rows: allRows };
}

module.exports = { parseXlsxBuffer, readWorkbookSheets, cellText };
