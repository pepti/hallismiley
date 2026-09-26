// Tiny CSV builder + browser download. Standard comma CSV with RFC-4180
// quoting; the UTF-8 BOM makes Excel decode Icelandic characters correctly.

// A plain number, including a negative one. Accounting exports are full of these
// and they must stay numeric so a spreadsheet imports them as numbers, not text.
const PLAIN_NUMBER = /^-?[0-9]+([.][0-9]+)?$/;

export function toCsvString(header, rows) {
  const esc = (v) => {
    let s = String(v == null ? '' : v);
    // Neutralise spreadsheet formulas before quoting. Excel/LibreOffice/Sheets
    // evaluate any cell starting with = + - @ (or a tab/CR that leaves one of
    // those first), so an exported value like =HYPERLINK(...) built from customer
    // input becomes live in the recipient's spreadsheet. A leading apostrophe
    // forces literal text and is not itself displayed.
    // Mirrors server/utils/csv.js — keep the two in step.
    // A leading '-' on a plain number is a negative figure, not injection (Excel
    // evaluates =-500 to -500 anyway); prefixing it turned every negative balance
    // into the text '-500 and broke numeric import. '=', '+', '@' and control
    // chars are still neutralised whatever follows.
    if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
    return /[",;\n\r\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

// Save a Blob the page already holds (a built CSV, a fetched .xlsx) as a file.
// The object URL is revoked after a delay, not straight after click(): the
// download starts asynchronously, and Safari (and older Firefox) cancel it when
// the URL is already gone. Ported from icelandicstore #325 (38aa1ca).
export const REVOKE_AFTER_MS = 30_000;

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function downloadCsv(filename, header, rows) {
  const blob = new Blob([String.fromCharCode(0xFEFF) + toCsvString(header, rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(filename, blob);
}
