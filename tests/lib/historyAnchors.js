/**
 * The history anchors, shared by the read-the-docs parity tests
 * (architectureIndex, featureRegistry, historyFragments).
 *
 * Since 2026-09-26 (harvest2-lane0-2026-09-26, ported from icelandicstore
 * #355) the dated write-ups live in two places: docs/HISTORY.md, the frozen
 * archive, and docs/history.d/*.md, one fragment per branch. Their `<a id>`
 * slugs are ONE namespace — a features/*.md `history:` entry names a bare
 * slug — so the union must be free of duplicates.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sourceTree');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const ARCHIVE_FILE = 'docs/HISTORY.md';
const FRAGMENT_DIR = 'docs/history.d';

/** Every `<a id="…"></a>` slug in a document, in order (duplicates kept). */
const anchorList = (md) => [...md.matchAll(/<a id="([\w-]+)"><\/a>/g)].map((m) => m[1]);

/** The fragment files (README excluded), sorted. */
function fragmentFiles() {
  const dir = path.join(ROOT, FRAGMENT_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
}

/** Map of repo-relative file → Set of its anchors, archive first. */
function anchorsByFile() {
  const out = new Map();
  out.set(ARCHIVE_FILE, new Set(anchorList(read(ARCHIVE_FILE))));
  for (const f of fragmentFiles()) out.set(`${FRAGMENT_DIR}/${f}`, new Set(anchorList(read(`${FRAGMENT_DIR}/${f}`))));
  return out;
}

/** The union of every archive and fragment anchor. */
function allAnchors() {
  const all = new Set();
  for (const set of anchorsByFile().values()) for (const a of set) all.add(a);
  return all;
}

/** Slugs that appear more than once across the archive and the fragments. */
function duplicateAnchors() {
  const seen = new Map();
  const lists = [anchorList(read(ARCHIVE_FILE)), ...fragmentFiles().map((f) => anchorList(read(`${FRAGMENT_DIR}/${f}`)))];
  for (const list of lists) for (const a of list) seen.set(a, (seen.get(a) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([a]) => a).sort();
}

module.exports = { ARCHIVE_FILE, FRAGMENT_DIR, read, anchorList, fragmentFiles, anchorsByFile, allAnchors, duplicateAnchors };
