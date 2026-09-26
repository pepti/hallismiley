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

/** Every `<a id="…"></a>` (or single-quoted `<a id='…'></a>`) slug in a
 *  document, in order (duplicates kept). */
const anchorList = (md) => [...md.matchAll(/<a id=(["'])([\w-]+)\1><\/a>/g)].map((m) => m[2]);

// A candidate target: any relative `.md` path (`./`, `../`, folders) with a
// `#slug`. Whether it is a HISTORY link is decided after resolving it, so a
// fragment linking a sibling fragment (`./2026-…md#x`) is caught too.
const TARGET = String.raw`((?:[\w.-]+\/)*[\w.-]+\.md)#([\w-]+)`;
const isHistoryFile = (p) => p === ARCHIVE_FILE || (p.startsWith(`${FRAGMENT_DIR}/`) && p !== `${FRAGMENT_DIR}/README.md`);
const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;
const INLINE = new RegExp(String.raw`\]\(\s*<?${TARGET}>?${TITLE}\s*\)`, 'g');
const REFERENCE = new RegExp(String.raw`^[ ]{0,3}\[[^\]]+\]:\s*<?${TARGET}>?${TITLE}\s*$`, 'gm');

/** Every history link in a markdown document, resolved relative to the file
 *  that holds it (`fromFile`, repo-relative). Inline and reference-style
 *  links, with or without a title; code (fenced blocks and inline spans) is
 *  prose about links, not a link, and is skipped. Returns [{ file, id, raw }]. */
function historyLinks(md, fromFile) {
  const body = md.replace(/\r\n/g, '\n').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const dir = path.posix.dirname(fromFile);
  const out = [];
  for (const re of [INLINE, REFERENCE]) {
    for (const m of body.matchAll(re)) {
      const file = path.posix.normalize(path.posix.join(dir, m[1]));
      if (isHistoryFile(file)) out.push({ file, id: m[2], raw: `${m[1]}#${m[2]}` });
    }
  }
  return out;
}

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

module.exports = { ARCHIVE_FILE, FRAGMENT_DIR, read, anchorList, historyLinks, fragmentFiles, anchorsByFile, allAnchors, duplicateAnchors };
