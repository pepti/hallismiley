'use strict';

// ── Product identity, resolved ───────────────────────────────────────────────
//
// `clientConfig.identity` is the seam (server/config/clientConfig.js: schema
// defaults < config/client.json < CLIENT_CONFIG_IDENTITY_* env). This module is
// its one server-side reader plus the pure helpers that turn it into the bits
// the SSR'd page carries — kept free of the database and of Express so the
// unit tier can exercise them (tests/unit/identityConfig.test.js).
//
// The client hand-off has two halves, because the theme has to be on <html>
// before first paint and theme-boot.js runs before any module can parse JSON:
//   • htmlIdentityAttrs()  → data-default-theme / data-theme-picker /
//                            data-root-theme on <html>, read by theme-boot.js;
//   • identityScriptTag()  → <script id="identity" type="application/json">,
//                            parsed once by public/js/utils/identity.js for
//                            everything else (brand, locale, hero, surfaces).

const { clientConfig } = require('./clientConfig');

/** The resolved identity for this instance (deep-frozen with the config). */
const identity = clientConfig.identity;

/**
 * Attributes for the <html> element, as one string ready to splice after
 * `lang="…"`. theme-boot.js reads them with the engine defaults as fallback,
 * so a shell served without SSR still boots.
 */
function htmlIdentityAttrs(id = identity) {
  const t = id.theme;
  return `data-default-theme="${escAttr(t.default)}" data-theme-picker="${escAttr(t.picker.join(' '))}" data-root-theme="${escAttr(t.root)}"`;
}

/**
 * The JSON hand-off. `</` is escaped as `<\/` (a legal JSON escape) so no
 * value can close the script element early; `<!--` likewise, so an HTML
 * comment opener inside a value cannot swallow the rest of the head.
 */
function identityScriptTag(id = identity) {
  const json = JSON.stringify(id)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '\\u003c!--');
  return `<script id="identity" type="application/json">${json}</script>`;
}

/**
 * Compose a document title from a page part.
 *   • `mode === 'bare'`          → the part as written (the hidden portfolio
 *                                  surfaces keep their own full titles);
 *   • a part carrying `{brand}`  → the placeholder substituted, no suffix
 *                                  (the home page: "Orange Smiley — …");
 *   • otherwise                  → part + brand.titleSuffix.
 * public/js/utils/pageTitle.js composes exactly the same way for client-side
 * navigation; tests/unit/pageTitle.test.js and identityConfig.test.js hold
 * the two together.
 */
function composeTitle(part, mode, id = identity) {
  const s = String(part ?? '');
  if (mode === 'bare') return s;
  if (s.includes('{brand}')) return s.split('{brand}').join(id.brand.name);
  return s + id.brand.titleSuffix;
}

/** Organization alternateName: the brand plus its variants, minus the legal
 *  name that is already `name`. Order preserved, duplicates dropped. */
function organizationAlternateNames(id = identity) {
  const out = [];
  for (const n of [id.brand.name, ...id.brand.alternateNames]) {
    if (n && n !== id.brand.legalName && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * `identity.routes` normalised (identity-seam-3): every optional field
 * present with its default, so a reader never tests for `undefined`.
 *   { '/console': { titleKey, descriptionKey: string|null,
 *                   titleMode: 'suffix'|'bare', noindex: boolean,
 *                   locale: string|null } }
 * The validated shape is clientConfig.js's (validateRouteMeta); the readers
 * are ssrMeta.js (ROUTE_META/DEFAULT_META), config/i18n.js (the locale
 * lock), config/publicSurface.js (noindex) and, on the client,
 * utils/pageTitle.js + i18n/i18n.js from the hand-off.
 */
function productRoutes(id = identity) {
  const out = {};
  for (const [route, e] of Object.entries(id.routes || {})) {
    out[route] = {
      titleKey: e.titleKey,
      descriptionKey: typeof e.descriptionKey === 'string' ? e.descriptionKey : null,
      titleMode: e.titleMode === 'bare' ? 'bare' : 'suffix',
      noindex: e.noindex === true,
      locale: typeof e.locale === 'string' && e.locale ? e.locale : null,
      // The site_content rows the page renders — the sitemap's <lastmod>
      // source for a product route (rk-feed, 2026-09-23).
      contentKeys: Array.isArray(e.contentKeys) ? e.contentKeys.filter(k => typeof k === 'string') : [],
    };
  }
  return out;
}

// An i18n key looks like `org.description`: dotted, no spaces. The same shape
// clientConfig.js accepts for a nav labelKey.
const I18N_KEY_RE = /^[a-z0-9_$]+(?:\.[a-z0-9_$-]+)+$/i;

/**
 * The Organization description for `locale`: `identity.organization
 * .description` as written, unless it is an i18n key the tables carry (a
 * product with a per-locale description puts `org.description` in its
 * `product.<locale>.json` overlay and names the key here). `has`/`t` are
 * passed in so this module stays free of server/i18n (which requires it).
 */
function organizationDescription(locale, { has, t }, id = identity) {
  const d = id.organization.description;
  return I18N_KEY_RE.test(d) && has(locale, d) ? t(locale, d) : d;
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

module.exports = {
  identity,
  htmlIdentityAttrs,
  identityScriptTag,
  composeTitle,
  organizationAlternateNames,
  productRoutes,
  organizationDescription,
};
