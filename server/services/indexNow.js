'use strict';
/*
 * IndexNow — Bing's instant content-discovery protocol.
 *
 * Whenever a publish/update action mutates an indexable URL we POST that URL
 * (or a small batch) to https://api.indexnow.org/IndexNow so Bing (and Yandex,
 * Seznam, Naver — all implement IndexNow) re-crawls within minutes instead of
 * waiting on the natural crawl cycle.
 *
 * Design:
 *   • Fire-and-forget — never blocks the response, never throws. Logged at
 *     warn level on failure so the regular publish flow stays unaffected
 *     when IndexNow is down or the env vars are misconfigured.
 *   • Silent no-op when INDEXNOW_KEY is unset (dev/preview environments)
 *     or when the URL list is empty.
 *   • Dedupe + cap to the IndexNow protocol limit of 10,000 URLs per call.
 *     A batch larger than the cap is split across multiple POSTs.
 *
 * Key hosting: Bing verifies ownership by fetching
 * `https://www.hallismiley.is/<INDEXNOW_KEY>.txt` and matching its body
 * against the `key` field in our POST body. That endpoint is served by
 * server/app.js — keep them in sync if either changes.
 */

const logger = require('../logger');

const APP_URL          = (process.env.APP_URL || 'https://www.hallismiley.is').replace(/\/$/, '');
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';
const MAX_BATCH         = 10000;

function getHostFromAppUrl() {
  try { return new URL(APP_URL).host; }
  catch { return 'www.hallismiley.is'; }
}

async function postBatch(host, key, batch) {
  const body = JSON.stringify({
    host,
    key,
    keyLocation: `${APP_URL}/${key}.txt`,
    urlList: batch,
  });
  const res = await fetch(INDEXNOW_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  // IndexNow returns 200 on accept, 202 when queued, 400 on bad request,
  // 403 on key mismatch, 422 on schema problems, 429 if rate-limited.
  // Treat <300 as success; log warn otherwise but don't throw.
  if (res.status >= 300) {
    logger.warn(
      { status: res.status, count: batch.length, sample: batch.slice(0, 3) },
      'indexNow.submit non-2xx response'
    );
  } else {
    logger.info(
      { status: res.status, count: batch.length },
      `submitted ${batch.length} URLs to IndexNow`
    );
  }
}

// Public: submit one or more URLs. Always returns immediately; the actual
// HTTP POST runs on the next tick.
function submitToIndexNow(urls) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return;                                    // dev / preview — silent skip
  if (!urls) return;
  const list = Array.isArray(urls) ? urls : [urls];

  // Filter to absolute URLs on our host. IndexNow rejects requests where
  // any urlList entry's host differs from `host`, so we'd lose the whole
  // batch over a single relative path slip.
  const host = getHostFromAppUrl();
  const clean = [...new Set(
    list
      .filter(u => typeof u === 'string' && u.length > 0)
      .map(u => u.trim())
      .filter(u => {
        try { return new URL(u).host === host; }
        catch { return false; }
      })
  )];
  if (clean.length === 0) return;

  setImmediate(async () => {
    try {
      for (let i = 0; i < clean.length; i += MAX_BATCH) {
        await postBatch(host, key, clean.slice(i, i + MAX_BATCH));
      }
    } catch (err) {
      logger.warn({ err }, 'indexNow.submit failed');
    }
  });
}

// Convenience: given a locale-agnostic path like `/news/my-slug`, expand
// to absolute EN + IS URLs and submit both. Useful from controllers that
// don't know the visitor's locale.
function submitLocalized(localePath) {
  if (!localePath || typeof localePath !== 'string') return;
  const suffix = localePath.startsWith('/') ? localePath : `/${localePath}`;
  submitToIndexNow([
    `${APP_URL}/en${suffix}`,
    `${APP_URL}/is${suffix}`,
  ]);
}

module.exports = { submitToIndexNow, submitLocalized };
