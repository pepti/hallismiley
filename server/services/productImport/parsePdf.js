// Harvested from icelandicstore salesReport/parsePdf.js (ice@4694289, harvest-ice-d-2026-09-24),
// moved under productImport/ because the engine has no salesReport/ folder.
// Parse an uploaded PDF sales report into the same grid shape as parseXlsxBuffer
// and the client's parseGrid: { headerRow, headers, rows:[[...]] }.
//
// A columnar report carries no delimiters — the columns are pure page geometry — so
// the whole job is turning "text at (x,y)" back into rows and cells. pdf-parse v2's
// getText() already rebuilds the LINES (it breaks on pdf.js's hasEOL / baseline
// jumps), but it joins a line's items with no separator, so a row would collapse to
// one blob ("Sala BSÍA little Trip to Iceland | Sticker1230ices1851").
//
// The CELL boundaries come out of pdf.js itself: when two text runs on one baseline
// are further apart than a space, pdf.js emits a synthetic whitespace-only item
// spanning the gap; runs that nearly touch are merged into a single item instead.
// So "a whitespace-only item" *is* the column separator. We ask pdf-parse to join
// items with a sentinel (itemJoiner), then rewrite each whitespace-only item as a TAB
// and each newline marker as a line break. The rest of the pipeline (delimiter
// detection → split → shared header-row detection) is unchanged, so the column mapper
// runs client-side exactly as for xlsx / pasted text.
//
// v1 → v2 note: pdf-parse 1.x exported a callable that took a `pagerender` hook, which
// let this file cluster raw text-item x-positions into column edges and snap every
// item to its nearest edge — that padded short rows so every row had the same cell
// count. v2 exports { PDFParse } and has NO raw-text-item accessor (getText is the
// only text API; getTable only finds tables drawn with vector rules, which these
// reports do not have), so the x-geometry is no longer reachable and the clustering is
// gone. Two consequences, both from the same root — a gap's WIDTH is not observable
// through the v2 API, only its existence:
//   • a row with a BLANK middle cell yields one cell fewer than the header instead of
//     an aligned empty string, so the cells after the hole read one column early;
//   • a wide gap *inside* one logical cell (a description drawn as two runs, say)
//     splits that cell in two, so the cells after it read one column late. v1's
//     nearestColumn snapped both runs back into their shared column.
// Neither is detectable here, so both surface in the merger's preview grid rather
// than being caught — the preview is the guard. Everything else is unchanged.
const path = require('path');
const { PDFParse } = require('pdf-parse');
const logger = require('../../logger');
const { findHeaderIndex } = require('./headerHints');

// ── pdf.js worker preload ────────────────────────────────────────────────────
// In Node, pdf.js runs its "worker" on the main thread and, on the first parse,
// `await import()`s ./pdf.worker.mjs (a 1 MB ES module beside pdf-parse's CJS
// entry). It memoises that promise on the PDFWorker class — a REJECTED one too —
// so one failed load poisons every later parse in the process. Under Jest the
// import goes through Jest's ESM linker, which needs --experimental-vm-modules;
// a Jest started without it (a bare `npx jest`, a stale git hook) failed there
// and the failure surfaced as "unreadable" on every PDF test.
//
// pdf.js checks `globalThis.pdfjsWorker.WorkerMessageHandler` BEFORE that import
// (PDFWorker.#mainThreadWorkerMessageHandler), so we load the same file ourselves,
// once, with a synchronous `require()` — Node ≥ 22.12 requires a TLA-free ES
// module directly (we run 24 everywhere; see Dockerfile / ci.yml). Nothing is
// memoised on failure, so a bad load is retried by the next parse. When the
// require runs inside a sandbox that cannot evaluate ES modules (Jest without
// the flag throws SyntaxError; some builds throw ERR_REQUIRE_ESM), Node's own
// loader is used instead via createRequire: the handler then lives in the outer
// realm, which is fine — it only exchanges structured-cloned messages with
// pdf.js's main thread. (Under Jest ≥ 30.5 that fallback no longer escapes the
// sandbox — Jest routes process.getBuiltinModule through its own registry — so
// run Jest through `npm test`, which passes --experimental-vm-modules.)
const WORKER_PATH = path.join(path.dirname(require.resolve('pdf-parse')), 'pdf.worker.mjs');

function isSandboxEsmFailure(err) {
  if (!err) return false;
  return err.name === 'SyntaxError'
    || err.code === 'ERR_REQUIRE_ESM'
    || err.code === 'ERR_REQUIRE_ASYNC_MODULE';
}

function requireWorker() {
  try {
    return require(WORKER_PATH);
  } catch (err) {
    if (!isSandboxEsmFailure(err)) throw err;
    const { createRequire } = process.getBuiltinModule('module');
    return createRequire(WORKER_PATH)(WORKER_PATH);
  }
}

/**
 * Install pdf.js's WorkerMessageHandler on globalThis (idempotent, synchronous).
 * Throws with the loader's own error when the worker cannot be loaded; nothing is
 * cached on failure, so the next call simply tries again.
 */
function isWorkerHandler(h) {
  return Boolean(h) && typeof h.setup === 'function';
}

function ensurePdfWorker() {
  // A partial global (anything without a callable setup) would make pdf.js
  // throw inside its memoised fake-worker setup, so it does not count as installed.
  if (globalThis.pdfjsWorker && isWorkerHandler(globalThis.pdfjsWorker.WorkerMessageHandler)) return;
  const mod = requireWorker();
  const handler = mod && (mod.WorkerMessageHandler || (mod.default && mod.default.WorkerMessageHandler));
  if (!isWorkerHandler(handler)) {
    throw new Error(`pdf.js worker at ${WORKER_PATH} did not export WorkerMessageHandler`);
  }
  globalThis.pdfjsWorker = { WorkerMessageHandler: handler };
}

// Joins pdf.js text items in getText() output so we can tell them apart again. A NUL
// does not survive pdf.js's text normalisation, so it will not collide with report
// content (and a stray one would only split a cell, never throw).
const ITEM_SEP = '\u0000';

// Pick the best delimiter from the first few lines.
function detectDelimiter(lines) {
  const candidates = ['\t', ';', ','];
  const counts = Object.fromEntries(candidates.map((d) => [d, 0]));
  for (const line of lines.slice(0, 15)) {
    for (const d of candidates) counts[d] += (line.split(d).length - 1);
  }
  const [best, score] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return score > 0 ? best : null;
}

// Split one line by delimiter, trimming each cell. If no structural delimiter
// was found, fall back to collapsing 2+ consecutive whitespace chars.
function splitRow(line, delim) {
  if (delim) return line.split(delim).map((c) => c.trim());
  return line.trim().split(/\s{2,}/).map((c) => c.trim());
}

// Sentinel-joined getText() output → TAB-delimited, newline-separated text.
// Item kinds, in the order they are tested:
//   ''            — pdf.js emits empty items around line ends; drop them.
//   whitespace + newline — pdf-parse's own line marker; emit the break.
//   whitespace only      — a column gap wide enough that pdf.js spelled it out; TAB.
//   anything else        — cell text, kept verbatim (a stray newline inside it still
//                          breaks the line, which is what we want).
// A single-column PDF simply produces no gap items, so no TABs — detectDelimiter
// then falls through to the whitespace split exactly as before.
function itemsToText(raw) {
  let out = '';
  for (const item of raw.split(ITEM_SEP)) {
    if (item === '') continue;
    if (item.trim() === '') { out += item.includes('\n') ? '\n' : '\t'; continue; }
    out += item;
  }
  return out;
}

// buffer (Node Buffer of the .pdf) → { headerRow, headers, rows }.
// (ice's { documents: true } mode — the Invoice Merger's line-item document
// readers — is ice-only and not harvested; the products import reads labels
// itself, in parseFile.js.)
async function parsePdfBuffer(buffer) {
  // Before the first PDFParse is constructed in this process — see the preload
  // note above. A preload failure (e.g. a pdf-parse layout change moving the
  // worker) is logged, not fatal: pdf.js then falls back to its own loader.
  try {
    ensurePdfWorker();
  } catch (err) {
    logger.warn({ err, workerPath: WORKER_PATH }, 'pdf: worker preload failed, pdf.js will load its own');
  }
  // verbosity 0 = errors only (pdf.js otherwise warns to console about missing
  // standard-font data); isEvalSupported false stops pdf.js compiling PDF functions
  // with `new Function` while parsing an uploaded file.
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    verbosity: 0,
    isEvalSupported: false,
  });
  let text;
  try {
    // pageJoiner '' drops the default "-- 1 of 2 --" page banner, which would
    // otherwise land in the grid as a data row.
    const result = await parser.getText({ itemJoiner: ITEM_SEP, pageJoiner: '' });
    text = itemsToText(result.text || '');
  } finally {
    // A destroy() failure must not replace the parse error the caller reports,
    // but it is a leaked document/transport, so it is logged rather than dropped.
    try { await parser.destroy(); } catch (err) { logger.warn({ err }, 'pdf: parser.destroy() failed'); }
  }

  const rawLines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!rawLines.length) return { headerRow: false, headers: [], rows: [] };

  const delim = detectDelimiter(rawLines);
  const grid = rawLines
    .map((l) => splitRow(l, delim))
    .filter((r) => r.some((c) => c.length));
  if (!grid.length) return { headerRow: false, headers: [], rows: [] };

  // Skip a leading title/banner row and pick the real header (shared with parseXlsx).
  const hIdx = findHeaderIndex(grid);
  const headerRow = hIdx >= 0;
  const headers = headerRow ? grid[hIdx] : grid[0].map((_, i) => `Column ${i + 1}`);
  let rows = headerRow ? grid.slice(hIdx + 1) : grid;

  // A paginated report reprints the column header at the top of every page, and
  // findHeaderIndex only ever consumes the first one — so drop later rows that repeat
  // it verbatim, or each page break leaves a header line sitting in the data.
  // parseXlsxBuffer does the same for continuation sheets. Matching on the exact
  // header text (never a numeric/data row) keeps it from eating real lines.
  if (headerRow) {
    const key = (r) => r.map((c) => String(c).toLowerCase().trim()).join('\t');
    const hdrKey = key(headers);
    rows = rows.filter((r) => key(r) !== hdrKey);
  }
  return { headerRow, headers, rows };
}

module.exports = { parsePdfBuffer, ensurePdfWorker, WORKER_PATH };
