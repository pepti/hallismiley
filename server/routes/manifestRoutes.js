'use strict';
/*
 * GET /manifest.json — the PWA manifest, named after the product.
 *
 * public/manifest.json stays as the ENGINE default (colours, icons, display
 * mode) and is what a shell served without this route would get. This route
 * is mounted before the static mount and wins: it reads that file once and
 * fills the brand-bearing fields from the identity seam (identity-seam-2,
 * 2026-09-23) — `name` and `short_name` are identity.brand.name, and
 * `description` is the home page's meta description in the visitor-default
 * locale (`meta.home.description`, engine table + product overlay). So a
 * downstream never edits the static file to be itself.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { identity, productRoutes } = require('../config/identity');
const { PUBLIC_DEFAULT_LOCALE } = require('../config/i18n');
const { t } = require('../i18n');

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'public', 'manifest.json');

let _base = null;
function baseManifest() {
  if (_base) return _base;
  try {
    _base = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    // A missing or corrupt engine default still yields a valid manifest.
    _base = { start_url: '/', display: 'standalone', icons: [] };
  }
  return _base;
}

/** The manifest for this product — pure over the identity, for the tests.
 *  The description is the landing page's: `identity.routes['/']
 *  .descriptionKey` when the product re-describes its landing
 *  (identity-seam-3), else the engine's `meta.home.description`. */
function buildManifest(id = identity, locale = PUBLIC_DEFAULT_LOCALE) {
  const landing = productRoutes(id)['/'];
  return {
    ...baseManifest(),
    name: id.brand.name,
    short_name: id.brand.name,
    description: t(locale, (landing && landing.descriptionKey) || 'meta.home.description'),
  };
}

const router = express.Router();

router.get('/manifest.json', (req, res) => {
  res.set('Content-Type', 'application/manifest+json; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).json(buildManifest());
});

module.exports = { router, buildManifest };
