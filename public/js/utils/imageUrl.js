// Product image URL helpers (harvested from icelandicstore #240 —
// harvest-ice-d-2026-09-24; ice's press-room `.card.webp` is not taken).
//
// thumbUrl(): the small-grid variant of a stored product image. The server
// generates `<original>.thumb.webp` on first request (see
// server/services/productImages.js) and serves it statically from then on, so
// the admin product list stops downloading the full-size original for every
// row. Only locally stored product images qualify — anything else (an external
// URL, null) is returned as-is.

const LOCAL_PRODUCT_IMAGE = /^\/assets\/products\/[^/?#]+\/[^/?#]+\.(jpe?g|png|webp)$/i;

export const THUMB_SUFFIX = '.thumb.webp';

export function thumbUrl(url) {
  if (typeof url !== 'string' || !url) return url || null;
  if (url.endsWith(THUMB_SUFFIX)) return url; // already a thumbnail
  return LOCAL_PRODUCT_IMAGE.test(url) ? `${url}${THUMB_SUFFIX}` : url;
}

/** Inverse of thumbUrl() — the original for a thumbnail URL (or the input). */
export function originalUrl(url) {
  if (typeof url !== 'string') return url || null;
  return url.endsWith(THUMB_SUFFIX) ? url.slice(0, -THUMB_SUFFIX.length) : url;
}

// Thumbnail fallback: when a `.thumb.webp` fails to load (the server skips a
// source sharp cannot decode), swap the <img> back to the original so the row
// still shows a picture. Image `error` events don't bubble, but they do pass
// through the capture phase, so one document-level listener covers every grid.
if (typeof document !== 'undefined' && !document.__thumbFallbackInstalled) {
  document.__thumbFallbackInstalled = true;
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const src = img.getAttribute('src') || '';
    if (!src.endsWith(THUMB_SUFFIX) || img.dataset.thumbFallback) return;
    img.dataset.thumbFallback = '1';
    img.setAttribute('src', originalUrl(src));
  }, true);
}
