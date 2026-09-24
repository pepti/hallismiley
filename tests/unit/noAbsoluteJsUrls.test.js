'use strict';

// Code under public/js must never name its own tree by an absolute /js/… or
// /css/… URL. The shell loads it from a release-stamped prefix (/js/_<tag>/,
// server/middleware/versionedStatic.js); an absolute URL escapes that prefix,
// so it can load another release's file next to this code — or, for a module,
// a second copy of it with its own state. Imports stay relative; fetches and
// classic <script src> go through utils/assetBase.js (jsUrl).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../public/js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p, out); } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// utils/assetBase.js is the one place that owns the unstamped fallback.
const ALLOWED = new Set([path.join('utils', 'assetBase.js')]);

// Comments may mention paths ("see /js/consent.js"); only code counts.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

test('no module names /js/ or /css/ by an absolute URL', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    if (ALLOWED.has(path.relative(ROOT, file))) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const re = /['"`]\/(js|css)\//g;
    let m;
    while ((m = re.exec(code))) {
      const line = code.slice(0, m.index).split('\n').length;
      offenders.push(`${path.relative(ROOT, file)}:${line}`);
    }
  }
  expect(offenders).toEqual([]);
});
