/**
 * The tracked source tree as a Set of repo-relative paths, shared by the
 * read-the-docs parity tests (architectureIndex, featureRegistry). Directories
 * end in `/`; root-level files are included by name. Extracted unchanged from
 * tests/unit/architectureIndex.test.js on 2026-09-22.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const TREE_ROOTS = ['server', 'public', 'tests', 'e2e', 'docs', 'scripts', 'config', '.github'];
const SKIP_DIRS = new Set(['node_modules', 'coverage', 'vendor']);

function walk(rel, out) {
  for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) { out.add(p + '/'); walk(p, out); }
    } else {
      out.add(p);
    }
  }
}

const tree = new Set();
for (const r of TREE_ROOTS) if (fs.existsSync(path.join(ROOT, r))) { tree.add(r + '/'); walk(r, tree); }
for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) if (ent.isFile()) tree.add(ent.name);

/** basename → every tree path with that basename */
const byBase = new Map();
for (const p of tree) {
  if (p.endsWith('/')) continue;
  const b = path.posix.basename(p);
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(p);
}

module.exports = { ROOT, TREE_ROOTS, SKIP_DIRS, walk, tree, byBase };
