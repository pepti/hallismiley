'use strict';

// public/js/utils/aiPdfChunks.js — the chunk loop behind "Read with AI"
// (ported from icelandicstore #306/#314). Pure: extractChunk and sleep are
// injected, so no browser, PDF or server is involved.
const { chunkRanges, isRetryable, emptyRunStatusKey, runAiChunks } = require('../../public/js/utils/aiPdfChunks.js');

const err = (status, reason = null, retryAfter = null) => Object.assign(new Error('x'), { status, reason, retryAfter });
const noSleep = async () => {};

describe('chunkRanges / isRetryable / emptyRunStatusKey', () => {
  test('pages split into chunks', () => {
    expect(chunkRanges(7, 3)).toEqual([{ from: 1, to: 3 }, { from: 4, to: 6 }, { from: 7, to: 7 }]);
    expect(chunkRanges(0, 3)).toEqual([]);
  });
  test('busy, 502, 503 and a dropped connection retry; a spent budget and other 4xx do not', () => {
    expect(isRetryable(err(429, 'AI_BUSY'))).toBe(true);
    expect(isRetryable(err(502))).toBe(true);
    expect(isRetryable(err(503))).toBe(true);
    expect(isRetryable(new Error('network'))).toBe(true);
    expect(isRetryable(err(429, 'pageBudget'))).toBe(false);
    expect(isRetryable(err(422))).toBe(false);
    expect(isRetryable(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(false);
  });
  test('"no product lines" only for a run that finished', () => {
    expect(emptyRunStatusKey({ rows: [], aborted: false, failed: null })).toBe('adminProducts.importAiNothing');
    expect(emptyRunStatusKey({ rows: [], aborted: true })).toBeNull();
    expect(emptyRunStatusKey({ rows: [{}], aborted: false, failed: null })).toBeNull();
  });
});

describe('runAiChunks', () => {
  test('sequential chunks, rows concatenated in order', async () => {
    const seen = [];
    const out = await runAiChunks({
      pageCount: 7, chunkPages: 3, sleep: noSleep,
      extractChunk: async (from, to) => { seen.push([from, to]); return { rows: [{ from }] }; },
    });
    expect(seen).toEqual([[1, 3], [4, 6], [7, 7]]);
    expect(out.rows.map(r => r.from)).toEqual([1, 4, 7]);
    expect(out).toMatchObject({ failed: null, aborted: false });
  });

  test('one retry honours Retry-After (capped); a second failure stops and keeps earlier rows', async () => {
    const waits = [];
    let n = 0;
    const out = await runAiChunks({
      pageCount: 6, chunkPages: 3, sleep: async (ms) => { waits.push(ms); },
      extractChunk: async (from) => {
        n += 1;
        if (from === 1) return { rows: [{ a: 1 }] };
        throw err(429, 'AI_BUSY', 90);
      },
    });
    expect(waits).toEqual([30000]);
    expect(n).toBe(3);
    expect(out.rows).toEqual([{ a: 1 }]);
    expect(out.failed).toMatchObject({ from: 4, to: 6, status: 429 });
  });

  test('a spent budget stops at once, no retry', async () => {
    let n = 0;
    const out = await runAiChunks({
      pageCount: 3, chunkPages: 3, sleep: noSleep,
      extractChunk: async () => { n += 1; throw err(429, 'pageBudget'); },
    });
    expect(n).toBe(1);
    expect(out.failed.reason).toBe('pageBudget');
  });

  test('Stop aborts before the next chunk and keeps what was read', async () => {
    const ac = new AbortController();
    const out = await runAiChunks({
      pageCount: 9, chunkPages: 3, signal: ac.signal, sleep: noSleep,
      extractChunk: async () => { ac.abort(); return { rows: [{ x: 1 }] }; },
    });
    expect(out).toMatchObject({ aborted: true, rows: [{ x: 1 }] });
  });
});
