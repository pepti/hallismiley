// Parse CSV text into records (each an array of cell strings). Single-pass, so a
// newline INSIDE a "double-quoted" field (RFC-4180; Excel emits these when a cell
// contains a line break) never splits a record. Handles escaped quotes (""), a
// leading UTF-8 BOM, and both \n and \r\n line endings. Fully-blank records are
// dropped so a trailing newline doesn't yield an empty row.
export function parseCsvRecords(text) {
  let raw = String(text || '');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip a leading BOM

  const records = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { cur += '"'; i += 1; } else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && raw[i + 1] === '\n') i += 1; // swallow the \n of a \r\n pair
      row.push(cur); cur = '';
      records.push(row); row = [];
    } else {
      cur += ch;
    }
  }
  // Flush a trailing record that has no final newline.
  if (cur !== '' || row.length) { row.push(cur); records.push(row); }

  return records.filter(r => r.some(c => c.trim() !== ''));
}
