// Ported from icelandicstore #306/#314 (public/js/utils/aiPdfChunks.js),
// unchanged but for this header and the engine's busy reason (AI_BUSY, from
// services/aiGate.js — still retried: only `pageBudget` is final).
//
// Read a long PDF with AI one small chunk at a time — the loop behind
// "Lesa með gervigreind" in the products import. Pure: the caller injects the
// function that sends one chunk (splitting the PDF with pdf-lib and POSTing it),
// so this is testable without a browser, a PDF or a server.
//
// Why chunks: the server caps a request at a few pages and one model call per
// request, so a 15-page price list is five requests. Why sequential: the server
// also lets the products import hold only two of the shared AI slots, and a
// parallel burst would just earn 429s.
//
// Rules the admin can rely on:
//  - rows from every chunk that finished are kept, even when a later one fails;
//  - a failed chunk is retried ONCE, after the server's Retry-After when it
//    gave one (capped), for the failures a retry can fix: busy (429 "busy"),
//    503, 502 and a dropped connection. A spent page budget (429 "pageBudget")
//    and every other 4xx stop at once — retrying them only spends more;
//  - cancelling (the AbortSignal) stops before the next chunk and aborts the
//    one in flight;
//  - progress is reported per chunk boundary, not per row, so a screen reader
//    hears "pages 4–6 of 15", not a stream.

const DEFAULT_RETRY_MS = 2000;
const MAX_RETRY_WAIT_MS = 30000;

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

// Pages 1..pageCount → [{ from, to }], `chunkPages` at a time.
export function chunkRanges(pageCount, chunkPages) {
  const n = Math.max(0, Math.floor(Number(pageCount) || 0));
  const size = Math.max(1, Math.floor(Number(chunkPages) || 1));
  const out = [];
  for (let from = 1; from <= n; from += size) out.push({ from, to: Math.min(n, from + size - 1) });
  return out;
}

// Can a second try plausibly succeed?
export function isRetryable(err) {
  if (!err || err.name === 'AbortError') return false;
  if (err.status == null) return true;                 // network / dropped connection
  if (err.status === 429) return err.reason !== 'pageBudget';
  return err.status === 502 || err.status === 503;
}

// What the status line says when a run ended with no rows. "The AI found no
// product lines in this PDF" is only true of a read that FINISHED: after Stop,
// or a failed chunk, nothing was concluded about the PDF and the note above
// already says what happened (QA 2026-09-13 C). → an i18n key, or null.
export function emptyRunStatusKey(result) {
  if (!result || result.aborted || result.failed) return null;
  return Array.isArray(result.rows) && result.rows.length ? null : 'adminProducts.importAiNothing';
}

/**
 * @param {object} o
 * @param {number} o.pageCount
 * @param {number} o.chunkPages
 * @param {(from:number, to:number, signal?:AbortSignal) => Promise<{rows:object[], truncated?:boolean}>} o.extractChunk
 *        throws an Error carrying .status / .reason / .retryAfter (seconds) on failure
 * @param {(event:object) => void} [o.onProgress]  { type: 'start'|'retry'|'done', from, to, index, total, pageCount, rows? }
 * @param {AbortSignal} [o.signal]
 * @param {(ms:number, signal?:AbortSignal) => Promise<void>} [o.sleep]
 * @returns {Promise<{rows:object[], chunks:object[], failed:object|null, aborted:boolean}>}
 */
export async function runAiChunks({ pageCount, chunkPages, extractChunk, onProgress = () => {}, signal, sleep = defaultSleep }) {
  const ranges = chunkRanges(pageCount, chunkPages);
  const rows = [];
  const chunks = [];
  const total = ranges.length;

  for (let index = 0; index < total; index += 1) {
    const { from, to } = ranges[index];
    if (signal && signal.aborted) return { rows, chunks, failed: null, aborted: true };
    onProgress({ type: 'start', from, to, index, total, pageCount });

    let attempt = 0;
    for (;;) {
      try {
        const result = await extractChunk(from, to, signal);
        const got = Array.isArray(result && result.rows) ? result.rows : [];
        rows.push(...got);
        chunks.push({ from, to, rows: got.length, truncated: Boolean(result && result.truncated) });
        onProgress({ type: 'done', from, to, index, total, pageCount, rows: got.length });
        break;
      } catch (err) {
        if ((signal && signal.aborted) || (err && err.name === 'AbortError')) {
          return { rows, chunks, failed: null, aborted: true };
        }
        if (attempt === 0 && isRetryable(err)) {
          attempt += 1;
          // null/undefined means "no Retry-After header" — the default wait, not 0 ms
          // (Number(null) is 0, which made a 502 retry instantly; review of #306).
          const wait = err.retryAfter != null && Number.isFinite(Number(err.retryAfter)) && Number(err.retryAfter) >= 0
            ? Math.min(Number(err.retryAfter) * 1000, MAX_RETRY_WAIT_MS)
            : DEFAULT_RETRY_MS;
          onProgress({ type: 'retry', from, to, index, total, pageCount, waitMs: wait });
          try { await sleep(wait, signal); } catch { return { rows, chunks, failed: null, aborted: true }; }
          continue;
        }
        return {
          rows, chunks, aborted: false,
          failed: { from, to, status: err && err.status != null ? err.status : null, reason: (err && err.reason) || null, message: (err && err.message) || '' },
        };
      }
    }
  }
  return { rows, chunks, failed: null, aborted: false };
}
