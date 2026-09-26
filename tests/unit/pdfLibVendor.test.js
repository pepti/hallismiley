'use strict';

// public/js/vendor/pdf-lib.esm.min.js is a VERBATIM copy of the exact-pinned
// devDependency pdf-lib (the SPA has no bundler — invariant 1 — so the browser
// loads the vendored file; harvest 2 lane 6b, as icelandicstore #306 did). This
// keeps the two from drifting: a dependabot bump of pdf-lib fails here until
// the file is re-copied, and the licence ships beside it. Line endings are
// normalised (a Windows checkout may hold CRLF).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('vendored pdf-lib', () => {
  test('is exact-pinned and a byte-for-byte copy of the package dist', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.devDependencies['pdf-lib']).toMatch(/^\d+\.\d+\.\d+$/);
    const installed = JSON.parse(read('node_modules/pdf-lib/package.json')).version;
    expect(installed).toBe(pkg.devDependencies['pdf-lib']);
    expect(sha(read('public/js/vendor/pdf-lib.esm.min.js'))).toBe(sha(read('node_modules/pdf-lib/dist/pdf-lib.esm.min.js')));
  });

  test('ships its MIT licence', () => {
    expect(read('public/js/vendor/pdf-lib.LICENSE.md')).toMatch(/MIT License/);
  });
});
