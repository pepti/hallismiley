// Release-stamped URLs for the SPA's code: /js/_<buildTag>/… and /css/_<buildTag>/….
//
// The shell (server/middleware/ssrMeta.js) points its <script>/<link> tags at
// /js/_<tag>/main.js and /css/_<tag>/main.css. Every import inside the code is
// relative, so the whole module graph resolves under the same prefix and every
// file of one release lives at a URL no other release shares. That lets those
// files be cached for a year (`immutable`): a full page load then costs no
// request per module, where the plain /js/… URLs cost ~245 revalidations
// (measured 2026-09-23: 7–8 s before the app could boot).
//
// It also keeps the #332 guarantee — a tab never runs two releases at once —
// by construction instead of by revalidation: a page that booted on release A
// can only ever ask for /js/_A/…, and once B is serving, those URLs answer 404
// (below) instead of handing it B's modules. The tab then reloads onto B: the
// next API response carries B's X-App-Build, or a failed locale/view load asks
// the server directly (public/js/services/buildGuard.js recoverFromAssetFailure);
// a 404 of the shell's own files at boot is caught by public/js/theme-boot.js.
//
// A tag that is not this release's is a 404 with no-store, never this
// release's bytes: during a slot swap old and new instances serve at once,
// and handing out our file under someone else's immutable URL would poison
// that URL in every browser that got it.
//
// The unprefixed /js/… and /css/… keep working (no-cache, see
// utils/staticCacheControl.js) for tabs opened before this shipped, for a
// local checkout, and for anything that links a file directly.

const path = require('path');
const express = require('express');
const buildVersion = require('../config/version');

const PUBLIC_ROOT = path.join(__dirname, '..', '..', 'public');
const VERSIONED = /^\/(js|css)\/_([A-Za-z0-9]{1,64})(\/.*)$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

// 'dev' / 'unknown' are "no release" (server/config/version.js): a checkout's
// code changes under the same tag, so it is never served as immutable.
function isReleaseTag(tag) {
  return Boolean(tag) && tag !== 'dev' && tag !== 'unknown';
}

// The prefix the shell should use for this release, or '' when there is no
// real release to pin (local dev, Jest, an image built without its stamp).
function assetPrefix(tag = buildVersion.buildTag) {
  return isReleaseTag(tag) ? `_${tag}` : '';
}

function versionedStatic({ root = PUBLIC_ROOT, buildTag = buildVersion.buildTag } = {}) {
  // One static server per directory, each rooted AT that directory: a stamped
  // /css/_<tag>/… can only ever name a stylesheet, never climb to a sibling
  // (`/css/_<tag>/..%2Fjs%2Fmain.js` would otherwise be JS cached for a year
  // under a CSS URL) — anything that leaves the root is refused by `send`.
  const serveFrom = (dir) => express.static(path.join(root, dir), {
    etag: true,
    lastModified: true,
    index: false,
    redirect: false,
    fallthrough: false,         // a miss under a live prefix is a 404, not the SPA shell
    setHeaders(res) { res.setHeader('Cache-Control', IMMUTABLE); },
  });
  const servers = { js: serveFrom('js'), css: serveFrom('css') };
  const live = isReleaseTag(buildTag);
  const notFound = (res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Not found', code: 404 });
  };

  return function versionedStaticMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const m = VERSIONED.exec(req.path);
    if (!m) return next();
    const [, dir, tag, rest] = m;
    if (!live || tag !== buildTag) return notFound(res);
    const original = req.url;
    const query = original.includes('?') ? original.slice(original.indexOf('?')) : '';
    req.url = `${rest}${query}`;
    return servers[dir](req, res, (err) => {
      req.url = original;
      // setHeaders ran before send's own checks: an error (404, 403, a 412 or
      // 416 from conditional/Range headers) must not leave `immutable` behind.
      res.removeHeader('Cache-Control');
      if (err && (err.status === 404 || err.statusCode === 404)) return notFound(res);
      return next(err);
    });
  };
}

module.exports = { versionedStatic, assetPrefix, isReleaseTag, VERSIONED };
