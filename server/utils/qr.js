'use strict';
/*
 * QR codes — currently only for TOTP enrolment (server/services/mfaService.js).
 *
 * Returns a **data: URI** rather than raw SVG markup, deliberately:
 *
 *   • the CSP allows `img-src 'self' data: https:`, so an <img src="data:…">
 *     renders with no policy change and no inline-style/script exemption;
 *   • the client sets an attribute instead of innerHTML-ing markup from an
 *     endpoint, so there is no path from "server response" to "parsed as HTML";
 *   • no QR library ships to the browser, which matters in a bundler-less SPA
 *     where every client dependency is a hand-vendored file.
 *
 * `qrcode-generator` is the mature kazuhikoarase implementation: zero runtime
 * dependencies, MIT, and adding it moved `npm audit` not at all (6 moderate
 * before and after — all pre-existing). QR encoding is Reed-Solomon plus mask
 * selection; hand-rolling it for one screen would be a poor trade.
 *
 * COLOURS ARE FIXED, NOT THEMED. The library emits an explicit white background
 * with black modules and that is left alone: this site ships dark themes, and a
 * dark-on-dark QR is simply unscannable. A code that inherits the page palette
 * looks tasteful and fails in the only way that matters.
 */

const qrcode = require('qrcode-generator');

// 'M' (~15% recovery) is the level authenticator apps are tuned for — enough
// tolerance for a phone camera at an angle without inflating the module count.
const ERROR_CORRECTION = 'M';
const CELL_SIZE = 4;   // SVG units per module; `scalable` means CSS sizes it anyway
const MARGIN    = 4;   // quiet zone in modules — REQUIRED by the spec; scanners
                       // fail without it, and the failure looks like a bad camera

/**
 * Encode text as an SVG QR code, returned as a data: URI.
 * @param {string} text
 * @returns {string} `data:image/svg+xml;base64,…`
 */
function svgDataUri(text) {
  const value = String(text || '');
  if (!value) throw new Error('qr: nothing to encode');

  // typeNumber 0 = pick the smallest version that fits the data.
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(value);
  qr.make();

  const svg = qr.createSvgTag({ cellSize: CELL_SIZE, margin: MARGIN, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * The raw module matrix — exposed for tests that assert structure without a decoder.
 * Guards empty input the same way svgDataUri() does: the two entry points should
 * not disagree about what counts as encodable, or a caller that pre-validates
 * with matrix() gets a confident answer for input svgDataUri() then rejects.
 */
function matrix(text) {
  const value = String(text || '');
  if (!value) throw new Error('qr: nothing to encode');

  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  return { size: n, isDark: (r, c) => qr.isDark(r, c) };
}

module.exports = { svgDataUri, matrix, ERROR_CORRECTION, MARGIN };
