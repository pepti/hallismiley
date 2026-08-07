// Tiny CSV builder + browser download. Standard comma CSV with RFC-4180
// quoting; the UTF-8 BOM makes Excel decode Icelandic characters correctly.

export function toCsvString(header, rows) {
  const esc = (v) => {
    let s = String(v == null ? '' : v);
    // Neutralise spreadsheet formulas before quoting. Excel/LibreOffice/Sheets
    // evaluate any cell starting with = + - @ (or a tab/CR that leaves one of
    // those first), so an exported value like =HYPERLINK(...) built from customer
    // input becomes live in the recipient's spreadsheet. A leading apostrophe
    // forces literal text and is not itself displayed.
    // Mirrors server/utils/csv.js — keep the two in step.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",;\n\r\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

export function downloadCsv(filename, header, rows) {
  const blob = new Blob([String.fromCharCode(0xFEFF) + toCsvString(header, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
