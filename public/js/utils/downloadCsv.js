// Tiny CSV builder + browser download. Standard comma CSV with RFC-4180
// quoting; the UTF-8 BOM makes Excel decode Icelandic characters correctly.

export function toCsvString(header, rows) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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
