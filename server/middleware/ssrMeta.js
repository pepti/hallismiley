'use strict';
/*
 * SSR meta-tag injection + crawler-content pre-rendering for the SPA
 * catch-all route.
 *
 * The SPA hydrates client-side into <div id="app">. But search-engine
 * crawlers and social preview bots vary wildly in JS support — Bing,
 * LinkedIn, Facebook, X, and Google's fast-track indexer often see only
 * the initial HTML. So for *every* request that reaches this middleware
 * we:
 *
 *   1. Rewrite the <head>: title, meta description, canonical, hreflang,
 *      og:* tags — all filled in per-route and per-locale.
 *   2. Inject JSON-LD structured data (Person on home; Article on news;
 *      Product on shop items; CreativeWork on projects; BreadcrumbList
 *      on all non-home pages).
 *   3. Inject a hidden <div id="crawler-content"> sibling to #app that
 *      contains real HTML headings, excerpts, and links for list and
 *      detail pages. The SPA ignores it; crawlers read it.
 *
 * Scale design:
 *   • Template is read once from disk at boot (cached) + a dev watcher.
 *   • Static routes hit DB only for admin-editable site_content meta
 *     overrides; detail routes hit DB once for the relevant row.
 *   • Responses tagged  Cache-Control: public, max-age=300,
 *     stale-while-revalidate=60  so a CDN can coalesce bot traffic.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');
const Inventory = require('../models/Inventory');
const ProductMerge = require('../models/ProductMerge');
const { DEFAULT_LOCALE, PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES, forcedLocaleFor } = require('../config/i18n');
const { isHiddenRoute } = require('../config/publicSurface');
const { clientAppEnv }  = require('../config/appEnv');
// The product's identity (config/client.json via clientConfig): brand, title
// suffix, theme trio, Organization record. Every brand-bearing literal this
// file used to carry now reads from it — see server/config/identity.js.
const {
  identity, htmlIdentityAttrs, identityScriptTag, composeTitle, organizationAlternateNames,
  productRoutes, organizationDescription,
} = require('../config/identity');
const { demoHtmlAttrs } = require('../config/demoInstance');
const { isDeindexedRoute } = require('../config/publicSurface');
const { isIndexableRequest } = require('../utils/indexability');
// The module switches' hand-off (R4) — rides next to the identity one.
const { modulesScriptTag, isDisabledRoute } = require('../config/modules');
// Release identity + release-stamped asset URLs + the SPA route list
// (icelandicstore #332/#399/#425, harvest-ice-e-2026-09-24).
const { buildTag } = require('../config/version');
const { assetPrefix } = require('./versionedStatic');
const { matchesSpaRoute } = require('../utils/spaRoutes');
// The page parts and descriptions are i18n keys (`meta.<key>.*`) resolved
// through the engine table + the product overlay — identity-seam-2.
const { t, has: hasText } = require('../i18n');

// Iceland scene hero preloads — the scene engine's LCP insurance. The JSON
// twin of public/js/scenes/manifest.js (both written by
// scripts/build-iceland-scenes.js). Absent manifest (fresh clone before a
// build) degrades to no preload, never an error.
let SCENE_MANIFEST = null;
try { SCENE_MANIFEST = require('../config/sceneManifest.json'); } catch { /* not built yet */ }
const { ROUTE_SCENE_IMAGES } = require('../config/sceneRoutes');
function scenePreloadTag(route) {
  const img = SCENE_MANIFEST && SCENE_MANIFEST[ROUTE_SCENE_IMAGES[route]];
  if (!img || !img.sources || !img.sources.avif || !img.sources.avif.length) return '';
  const srcset = img.sources.avif.map((x) => `${x.src} ${x.w}w`).join(', ');
  return `<link rel="preload" as="image" type="image/avif" imagesrcset="${srcset}" imagesizes="100vw" fetchpriority="high" id="ssr-scene-preload">`;
}

const APP_URL        = (process.env.APP_URL || 'https://www.orangesmiley.is').replace(/\/$/, '');
const INDEX_PATH     = path.join(__dirname, '..', '..', 'public', 'index.html');
// The og:image card every page falls back to — the product's
// (identity.organization.ogImage, identity-seam-3), not a literal.
const OG_IMAGE_PATH  = identity.organization.ogImage;

// Cached template (read once at boot) + stat watcher for dev hot-reload.
// index.html is baked with the production origin; swap it for APP_URL here so
// nothing baked (canonical, hreflang, og:url fallbacks) points at another
// host. The baked Organization JSON-LD is dropped at the same time: it is only
// the no-SSR fallback, and every SSR'd page gets the one built from
// `identity` (organizationSchema below) so a downstream never forks
// index.html to change its company record.
const BAKED_ORIGIN = 'https://www.orangesmiley.is';
const BAKED_ORG_RE = /[ \t]*<script type="application\/ld\+json">(?:(?!<\/script>)[\s\S])*"@type":\s*"Organization"(?:(?!<\/script>)[\s\S])*<\/script>\n?/;
// The shell's own code and stylesheets move under this release's prefix —
// /js/main.js → /js/_<tag>/main.js — so the whole module graph (imports are
// relative) and the @import chain resolve to URLs only this release serves,
// cached for a year (middleware/versionedStatic.js). No prefix without a real
// release (local checkout, Jest, e2e): the tags are then left exactly as
// written. theme-boot.js is the exception: it recovers a stamped file that
// fails to load, so it must exist on any instance (see the note at its top).
function stampAssetUrls(html, prefix = assetPrefix()) {
  if (!prefix) return html;
  return html.replace(/\b(src|href)="\/(js|css)\/(?!theme-boot\.js")/g, (_, attr, dir) => `${attr}="/${dir}/${prefix}/`);
}

// buildTag is frozen at boot, so the asset stamp is applied once here.
let _template = null;
function loadTemplate() {
  if (_template) return _template;
  _template = stampAssetUrls(fs.readFileSync(INDEX_PATH, 'utf8')
    .split(BAKED_ORIGIN).join(APP_URL)
    .replace(BAKED_ORG_RE, ''));
  return _template;
}
if (process.env.NODE_ENV !== 'production') {
  try {
    fs.watchFile(INDEX_PATH, { interval: 1000 }, () => { _template = null; });
  } catch { /* best-effort — watcher isn't critical */ }
}

// Route → static meta-tag overrides. Content-driven pages set a `contentKey`
// which points at a site_content row whose JSON can supply `{meta_title,
// meta_description}` fields (populated by admins via the CMS).
//
// /shop/products, /shop/tech, /shop/carpentry are department sub-routes
// added in shop-redesign step 2. They share the shop_hero content key for
// admin-editable copy fallback but have their own DEFAULT_META titles so
// each section is independently SEO-indexable.
const ROUTE_META = {
  '/':                 { key: 'home',           contentKey: 'home_skills' },
  // ── Business IA (canonical Icelandic slugs) ──
  '/thjonusta':        { key: 'thjonusta' },
  '/verkefni':         { key: 'projects' },
  '/um-okkur':         { key: 'umOkkur' },
  '/hafa-samband':     { key: 'contact',        contentKey: 'contact_hero' },
  '/personuvernd':     { key: 'privacy' },
  // ── Legacy portfolio routes (functional, de-emphasized) ──
  '/projects':         { key: 'projects' },
  '/halli':            { key: 'halli',          contentKey: 'halli_bio' },
  '/about':            { key: 'halli',          contentKey: 'halli_bio' },
  '/shop':             { key: 'shop',           contentKey: 'shop_hero' },
  '/shop/products':    { key: 'shopProducts',   contentKey: 'shop_hero', section: 'shop' },
  '/shop/tech':        { key: 'shopTech',       contentKey: 'shop_hero', section: 'shop', categoryFilter: 'tech_service' },
  '/shop/carpentry':   { key: 'shopCarpentry',  contentKey: 'shop_hero', section: 'shop', categoryFilter: 'carpentry_service' },
  '/news':             { key: 'news' },
  '/contact':          { key: 'contact',        contentKey: 'contact_hero' },
  '/privacy':          { key: 'privacy' },
  '/terms':            { key: 'terms' },
  '/party':            { key: 'party' },
};

// Per static key: the i18n KEYS of the page part (`title`) and the
// description, plus the title mode. The human text lives in the engine i18n
// tables (server/i18n/<locale>.json, `meta.<key>.*`; identity-seam-2,
// 2026-09-23) so a product overrides a title or description in its
// product.<locale>.json without touching this file. The document title is
// composeTitle(part, mode) from server/config/identity.js — part +
// identity.brand.titleSuffix, or the part with `{brand}` substituted (home),
// or, for `titleMode: 'bare'`, the part as written (the hidden portfolio
// surfaces keep their own full titles — "Halli Smiley" there is the base's,
// on purpose). Keep the key order `title, titleMode, description`:
// tests/unit/pageTitle.test.js parses these lines to hold
// public/js/utils/pageTitle.js to the same keys and modes, and holds the
// client and server tables to the same text.
const DEFAULT_META = {
  home:           { title: 'meta.home.title', description: 'meta.home.description' },
  thjonusta:      { title: 'meta.thjonusta.title', description: 'meta.thjonusta.description' },
  umOkkur:        { title: 'meta.umOkkur.title', description: 'meta.umOkkur.description' },
  projects:       { title: 'meta.projects.title', description: 'meta.projects.description' },
  halli:          { title: 'meta.halli.title', titleMode: 'bare', description: 'meta.halli.description' },
  shop:           { title: 'meta.shop.title', titleMode: 'bare', description: 'meta.shop.description' },
  shopProducts:   { title: 'meta.shopProducts.title', titleMode: 'bare', description: 'meta.shopProducts.description' },
  shopTech:       { title: 'meta.shopTech.title', titleMode: 'bare', description: 'meta.shopTech.description' },
  shopCarpentry:  { title: 'meta.shopCarpentry.title', titleMode: 'bare', description: 'meta.shopCarpentry.description' },
  news:           { title: 'meta.news.title', titleMode: 'bare', description: 'meta.news.description' },
  contact:        { title: 'meta.contact.title', description: 'meta.contact.description' },
  privacy:        { title: 'meta.privacy.title' },
  terms:          { title: 'meta.terms.title' },
  party:          { title: 'meta.party.title', titleMode: 'bare', description: 'meta.party.description' },
};

// The product's OWN routes (identity.routes in config/client.json,
// identity-seam-3) merged over the two tables above: each entry becomes a
// ROUTE_META row keyed `product:<route>` and a DEFAULT_META entry naming its
// i18n keys and mode — so hallismiley's `/aron13ara` or LedgerLink's
// `/console` is titled and described from config, and an engine route the
// product re-describes (`/`) takes the product's entry whole (no site_content
// override, no shop section). public/js/utils/pageTitle.js merges the same
// entries client-side from the hand-off; tests/unit/pageTitle.test.js holds
// the engine tables here to the client's by parsing this file, so the merge
// happens AFTER the literal tables it parses.
const PRODUCT_ROUTES = productRoutes();
for (const [route, e] of Object.entries(PRODUCT_ROUTES)) {
  const key = `product:${route}`;
  ROUTE_META[route] = { key, product: true };
  DEFAULT_META[key] = {
    title: e.titleKey,
    titleMode: e.titleMode === 'bare' ? 'bare' : undefined,
    description: e.descriptionKey || undefined,
  };
}

// The document title + description for a static key in a locale, composed
// from the translated page part and the product's brand — the ONE place a
// title is assembled server-side. t() falls back through DEFAULT_LOCALE like
// content; a description key the tables do not carry (privacy, terms) is
// simply absent, never the key's name.
function metaFor(locale, key) {
  const entry = DEFAULT_META[key];
  if (!entry) return null;
  const description = entry.description && hasText(locale, entry.description) ? t(locale, entry.description) : undefined;
  return { title: composeTitle(t(locale, entry.title), entry.titleMode), description };
}

// Section labels for breadcrumbs (per locale).
const SECTION_LABELS = {
  en: { projects: 'Our work', news: 'News', shop: 'Shop' },
  is: { projects: 'Verkefni', news: 'Fréttir', shop: 'Verslun' },
};

// URL path segment per section — projects moved to the canonical Icelandic
// slug /verkefni (business IA); news/shop keep their legacy segments.
const SECTION_PATHS = { projects: 'verkefni', news: 'news', shop: 'shop' };

// Detail-route patterns. Order matters only because each returns on first match.
const DETAIL_PATTERNS = [
  { re: /^\/news\/([^/]+)$/,     type: 'news'    },
  { re: /^\/shop\/([^/]+)$/,     type: 'product' },
  { re: /^\/verkefni\/(\d+)$/,   type: 'project' },
  { re: /^\/projects\/(\d+)$/,   type: 'project' },
];

function extractDetail(route) {
  for (const p of DETAIL_PATTERNS) {
    const m = route.match(p.re);
    if (m) return { type: p.type, param: m[1], section: p.type === 'product' ? 'shop' : p.type + 's' };
  }
  return null;
}

function extractLocale(req) {
  const pathname = req.path || '/';
  const parts = pathname.split('/').filter(Boolean);
  const hasLocalePrefix = parts[0] && SUPPORTED_LOCALES.includes(parts[0]);
  const rest = hasLocalePrefix ? ('/' + parts.slice(1).join('/') || '/') : pathname;

  // Locale-locked routes (Icelandic-only party pages) ignore the URL prefix
  // entirely. app.js 301s /en/party → /is/party before we get here, so in
  // practice the prefix already agrees; this is the belt-and-braces half that
  // guarantees the SSR <head> can never advertise a language the page isn't
  // written in, however the request arrived.
  const forced = forcedLocaleFor(pathname);
  if (forced) return { locale: forced, rest };

  if (hasLocalePrefix) return { locale: parts[0], rest };

  // Unprefixed non-party path — render in the visitor-facing default so the
  // crawler-visible <head> for / etc. is Icelandic. Content lookups inside
  // still fall back through DEFAULT_LOCALE (the content dimension) when an
  // IS entry is missing.
  return { locale: PUBLIC_DEFAULT_LOCALE, rest: pathname };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function absUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `${APP_URL}${u.startsWith('/') ? '' : '/'}${u}`;
}

// ── DB lookups ───────────────────────────────────────────────────────────────

async function fetchContentMeta(contentKey, locale) {
  if (!contentKey) return null;
  try {
    const { rows } = await db.query(
      `SELECT value FROM site_content
        WHERE key = $1 AND locale = $2
        UNION ALL
       SELECT value FROM site_content
        WHERE key = $1 AND locale = $3
        LIMIT 1`,
      [contentKey, locale, DEFAULT_LOCALE]
    );
    const v = rows[0]?.value;
    if (!v || typeof v !== 'object') return null;
    return { title: v.meta_title, description: v.meta_description };
  } catch {
    return null;
  }
}

// Party link previews use the admin-uploaded cover photo as og:image so a
// shared /party link shows the party hero, not the generic site card. The
// cover path lives in a locale-neutral `party_cover_image` site_content row
// (written by partyController.uploadCoverImage) as a JSON string like
// `/assets/party/foo.jpg`. Returns an absolute URL, or null if unset.
async function fetchPartyOgImage() {
  try {
    const { rows } = await db.query(
      `SELECT value FROM site_content
        WHERE key = 'party_cover_image' AND locale = $1
        LIMIT 1`,
      [DEFAULT_LOCALE]
    );
    const v = rows[0]?.value;
    return typeof v === 'string' && v ? absUrl(v) : null;
  } catch {
    return null;
  }
}

// Like fetchContentMeta but returns the full `value` JSON, not just the
// title/description meta fields. Used by crawlerHomeHtml() to pull the
// hero/skills/stats payload that the SPA would otherwise render client-side.
async function fetchContentFull(contentKey, locale) {
  if (!contentKey) return null;
  try {
    const { rows } = await db.query(
      `SELECT value FROM site_content
        WHERE key = $1 AND locale = $2
        UNION ALL
       SELECT value FROM site_content
        WHERE key = $1 AND locale = $3
        LIMIT 1`,
      [contentKey, locale, DEFAULT_LOCALE]
    );
    const v = rows[0]?.value;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// Sentinel: the detail lookup FAILED (pool timeout, failover, a container
// warming up) — as opposed to answering "no such row". The two must not look
// alike: a miss is a 404, but a failed lookup says nothing about the page, and
// a 404 there would tell crawlers every live article/product/project is gone
// (icelandicstore #399 review).
const LOOKUP_FAILED = Symbol('lookupFailed');

// → the row, null (no such live row), or LOOKUP_FAILED.
async function fetchDetailRow(detail) {
  try {
    return await lookups.detail(detail);
  } catch {
    return LOOKUP_FAILED;
  }
}

// The detail queries, on an object so a test can swap in a failing lookup
// without mocking pg (tests/integration/spaStatus.test.js).
const lookups = { detail: queryDetailRow };

async function queryDetailRow(detail) {
  if (detail.type === 'news') {
    const { rows } = await db.query(
      `SELECT id, slug, title, title_is, summary, summary_is,
              body, body_is, cover_image, cover_image_is,
              published_at, updated_at
         FROM news_articles
        WHERE slug = $1 AND published = TRUE
        LIMIT 1`,
      [detail.param]
    );
    return rows[0] || null;
  }
  if (detail.type === 'product') {
    const { rows } = await db.query(
      `SELECT p.id, p.slug, p.name, p.name_is, p.description, p.description_is,
              p.price_isk, p.price_eur, p.active, p.updated_at,
              -- Available, not on hand (models/Inventory.js): what paid orders
              -- already hold is not InStock for the next visitor.
              (CASE WHEN p.variant_axes <> '[]'::jsonb
                    THEN (SELECT COALESCE(SUM(stock), 0)::int FROM product_variants
                           WHERE product_id = p.id AND active = TRUE)
                    ELSE p.stock END)
              - COALESCE((SELECT SUM(oi.quantity)::int
                            FROM order_items oi JOIN orders o ON o.id = oi.order_id
                           WHERE oi.product_id = p.id AND ${Inventory.OPEN_ORDER_SQL}
                             AND NOT (p.is_bookable AND oi.product_variant_id IS NULL)), 0) AS available,
              (SELECT url FROM product_images
                WHERE product_id = p.id
             ORDER BY position ASC, created_at ASC
                LIMIT 1) AS image_url
         FROM products p
        WHERE p.slug = $1 AND p.active = TRUE
        LIMIT 1`,
      [detail.param]
    );
    return rows[0] || null;
  }
  if (detail.type === 'project') {
    const id = Number(detail.param);
    if (!Number.isFinite(id)) return null;
    // Select title_is / description_is alongside the primary columns so
    // the caller can pick the locale-appropriate value when rendering
    // <title> + og:description for Icelandic crawlers.
    const { rows } = await db.query(
      `SELECT id, title, title_is, description, description_is,
              category, year, image_url, featured, created_at, updated_at
         FROM projects WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }
  return null;
}

async function fetchListRows(section, limit = 10, categoryFilter = null) {
  try {
    if (section === 'news') {
      const { rows } = await db.query(
        `SELECT slug, title, title_is, summary, summary_is, cover_image, published_at
           FROM news_articles
          WHERE published = TRUE
          ORDER BY published_at DESC NULLS LAST
          LIMIT $1`,
        [limit]
      );
      return rows;
    }
    if (section === 'shop') {
      // Shop-redesign sub-routes pass a categoryFilter so the crawler list
      // for /shop/tech only shows tech_service rows, etc. The /shop landing
      // (categoryFilter = null) keeps the old behavior of all active rows.
      const params = [limit];
      let extra = '';
      if (categoryFilter) {
        params.push(String(categoryFilter));
        extra = ` AND p.category = $${params.length}`;
      }
      const { rows } = await db.query(
        `SELECT p.slug, p.name, p.name_is, p.description, p.description_is,
                p.price_isk, p.updated_at,
                (SELECT url FROM product_images
                  WHERE product_id = p.id
               ORDER BY position ASC, created_at ASC
                  LIMIT 1) AS image_url
           FROM products p
          WHERE p.active = TRUE${extra}
          ORDER BY p.updated_at DESC
          LIMIT $1`,
        params
      );
      return rows;
    }
    if (section === 'projects') {
      const { rows } = await db.query(
        `SELECT id, title, title_is, description, description_is,
                category, year, image_url
           FROM projects
          ORDER BY featured DESC, year DESC, updated_at DESC
          LIMIT $1`,
        [limit]
      );
      return rows;
    }
  } catch {
    return [];
  }
  return [];
}

// Pick locale-matched text with English fallback.
function pickLocale(row, enCol, isCol, locale) {
  if (!row) return '';
  if (locale === 'is' && row[isCol]) return row[isCol];
  return row[enCol] || '';
}

// ── JSON-LD builders ─────────────────────────────────────────────────────────

function breadcrumbSchema({ section, detailName, localePath, locale }) {
  const home = { '@type': 'ListItem', position: 1, name: locale === 'is' ? 'Heim' : 'Home', item: `${APP_URL}/${locale}/` };
  const items = [home];
  if (section) {
    items.push({
      '@type': 'ListItem', position: 2,
      name: SECTION_LABELS[locale]?.[section] || SECTION_LABELS.en[section] || section,
      item: `${APP_URL}/${locale}/${SECTION_PATHS[section] || section}`,
    });
  }
  if (detailName) {
    items.push({
      '@type': 'ListItem', position: 3,
      name: detailName,
      item: `${APP_URL}/${locale}${localePath}`,
    });
  }
  if (items.length < 2) return null;
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

function articleSchema(row, locale, canonical) {
  const headline = pickLocale(row, 'title', 'title_is', locale);
  const desc     = pickLocale(row, 'summary', 'summary_is', locale);
  const image    = locale === 'is' && row.cover_image_is ? row.cover_image_is : row.cover_image;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description: desc,
    inLanguage: locale === 'is' ? 'is-IS' : 'en-US',
    datePublished: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    dateModified:  row.updated_at   ? new Date(row.updated_at).toISOString()   : undefined,
    image: image ? absUrl(image) : undefined,
    author:    { '@id': `${APP_URL}/#organization` },
    publisher: { '@id': `${APP_URL}/#organization` },
    mainEntityOfPage: canonical,
  };
}

function productSchema(row, locale, canonical) {
  const name = pickLocale(row, 'name', 'name_is', locale);
  const desc = pickLocale(row, 'description', 'description_is', locale);
  const availability = (row.available > 0)
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: desc,
    image: row.image_url ? absUrl(row.image_url) : `${APP_URL}${OG_IMAGE_PATH}`,
    sku: row.slug,
    // The shop's goods carry the product's brand (identity-seam-2) — the
    // company's, not one product's name.
    brand: { '@type': 'Brand', name: identity.brand.name },
    offers: {
      '@type': 'Offer',
      url: canonical,
      price: row.price_isk,
      priceCurrency: 'ISK',
      availability,
    },
  };
}

function websiteSchema() {
  // Emitted only on the home page. The alternateName array binds branded
  // search variants (one-word "Orangesmiley", the ehf. form) to the site so
  // knowledge graphs treat them as the same entity. The publisher reference
  // resolves to organizationSchema() below (same @id), emitted on every page.
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id':  `${APP_URL}/#website`,
    url:    APP_URL,
    name:   identity.brand.name,
    alternateName: identity.brand.alternateNames.slice(),
    inLanguage: SUPPORTED_LOCALES.slice(),
    publisher: { '@id': `${APP_URL}/#organization` },
  };
}

// The company itself, on EVERY page: the Article/Product/CreativeWork/Service
// schemas and the WebSite all reference `${APP_URL}/#organization`, and a
// dangling @id yields a broken knowledge graph. Built from
// identity.organization + identity.brand (config/client.json), which is how a
// downstream gets its own record without forking index.html — the baked copy
// there is stripped by loadTemplate() and only serves a shell that never
// passed through here.
function organizationSchema(locale) {
  const org = identity.organization;
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id':  `${APP_URL}/#organization`,
    name:   identity.brand.legalName,
    alternateName: organizationAlternateNames(),
    url:    APP_URL,
    logo:   absUrl(org.logo),
    image:  absUrl(org.image),
    email:  org.email,
    // A literal, or an i18n key the product carries per locale (identity-seam-3).
    description: organizationDescription(locale, { has: hasText, t }),
    address: (org.addressCountry || org.addressLocality) ? {
      '@type': 'PostalAddress',
      addressCountry: org.addressCountry,
      addressLocality: org.addressLocality,
    } : undefined,
    areaServed: org.areaServed ? { '@type': 'Country', name: org.areaServed } : undefined,
    knowsAbout: org.knowsAbout.length ? org.knowsAbout.slice() : undefined,
    sameAs: org.sameAs.length ? org.sameAs.slice() : undefined,
  };
}

// What the company sells, as an OfferCatalog. Emitted on / and /thjonusta.
// Halli (2026-09-13): Orange Smiley builds any software a small or medium
// business needs, so the catalogue lists the services and then Rekstrarkerfið
// as one product, pointing at its own site. No tiers and no prices here:
// those live on rekstrarkerfi.is (Halli, 2026-09-13), and an unconfirmed
// number in structured data reads as a commitment.
// Mirrors thjonusta.service.* in the locale files; change them together.
const SERVICE_OFFERINGS = [
  { en: 'Custom systems',             is: 'Sérsmíðuð kerfi' },
  { en: 'Websites and online stores', is: 'Vefir og vefverslanir' },
  { en: 'Integrations',               is: 'Tengingar milli kerfa' },
  { en: 'Automation and AI',          is: 'Sjálfvirkni og gervigreind' },
  { en: 'Moving off legacy systems',  is: 'Flutningur af eldri kerfum' },
  { en: 'Hosting and maintenance',    is: 'Hýsing og viðhald' },
];

function serviceSchema(locale) {
  const isIS = locale === 'is';
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${APP_URL}/#service`,
    serviceType: isIS ? 'Hugbúnaðargerð og vefþjónusta' : 'Software development and web services',
    provider: { '@id': `${APP_URL}/#organization` },
    areaServed: { '@type': 'Country', name: 'Iceland' },
    inLanguage: isIS ? 'is-IS' : 'en-US',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: isIS ? 'Þjónusta' : 'Services',
      itemListElement: [
        ...SERVICE_OFFERINGS.map(service => ({
          '@type': 'Offer',
          itemOffered: { '@type': 'Service', name: isIS ? service.is : service.en },
        })),
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Rekstrarkerfið',
            url: `https://rekstrarkerfi.is/${isIS ? 'is' : 'en'}/`,
          },
        },
      ],
    },
  };
}

function creativeWorkSchema(row, locale, canonical) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: row.title,
    description: row.description,
    dateCreated: row.year ? String(row.year) : undefined,
    dateModified: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    image: row.image_url ? absUrl(row.image_url) : undefined,
    creator: { '@id': `${APP_URL}/#organization` },
    inLanguage: locale === 'is' ? 'is-IS' : 'en-US',
    url: canonical,
    genre: row.category,
  };
}

// Strip undefined fields so the rendered JSON is clean.
function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const cv = clean(v);
      if (cv !== undefined && cv !== null && cv !== '') out[k] = cv;
    }
    return out;
  }
  return obj;
}

function jsonLdScript(schemas) {
  const blocks = schemas.filter(Boolean).map(s => JSON.stringify(clean(s)));
  if (!blocks.length) return '';
  return blocks
    .map(json => `<script type="application/ld+json">${json.replace(/</g, '\\u003c')}</script>`)
    .join('\n  ');
}

// ── Crawler-content HTML builders ────────────────────────────────────────────
// Hidden sibling to <div id="app">; not user-visible but present in DOM for
// non-JS crawlers. Contains an <h1>, excerpts, and real anchor links.

function crawlerListHtml(section, rows, locale) {
  const heading = metaFor(locale, section).title;
  const items = rows.map(row => {
    if (section === 'news') {
      const title   = pickLocale(row, 'title', 'title_is', locale);
      const summary = pickLocale(row, 'summary', 'summary_is', locale);
      const href    = `/${locale}/news/${row.slug}`;
      return `<li><a href="${esc(href)}"><h2>${esc(title)}</h2></a><p>${esc(summary)}</p></li>`;
    }
    if (section === 'shop') {
      const name = pickLocale(row, 'name', 'name_is', locale);
      const desc = pickLocale(row, 'description', 'description_is', locale);
      const href = `/${locale}/shop/${row.slug}`;
      return `<li><a href="${esc(href)}"><h2>${esc(name)}</h2></a><p>${esc(stripHtml(desc).slice(0, 200))}</p></li>`;
    }
    if (section === 'projects') {
      const title = pickLocale(row, 'title', 'title_is', locale);
      const desc  = pickLocale(row, 'description', 'description_is', locale);
      const href  = `/${locale}/verkefni/${row.id}`;
      return `<li><a href="${esc(href)}"><h2>${esc(title)}</h2></a><p>${esc(stripHtml(desc).slice(0, 200))}</p></li>`;
    }
    return '';
  }).filter(Boolean).join('');
  return `<h1>${esc(heading)}</h1><ul>${items}</ul>`;
}

function crawlerDetailHtml(type, row, locale) {
  if (type === 'news') {
    const title   = pickLocale(row, 'title', 'title_is', locale);
    const summary = pickLocale(row, 'summary', 'summary_is', locale);
    const body    = pickLocale(row, 'body', 'body_is', locale);
    return `<article><h1>${esc(title)}</h1><p><em>${esc(summary)}</em></p>${body}</article>`;
  }
  if (type === 'product') {
    const name = pickLocale(row, 'name', 'name_is', locale);
    const desc = pickLocale(row, 'description', 'description_is', locale);
    const priceLabel = locale === 'is' ? 'Verð' : 'Price';
    return `<article><h1>${esc(name)}</h1><p>${esc(desc)}</p><p>${esc(priceLabel)}: ${Number(row.price_isk).toLocaleString('is-IS')} ISK</p></article>`;
  }
  if (type === 'project') {
    const title = pickLocale(row, 'title', 'title_is', locale);
    const desc  = pickLocale(row, 'description', 'description_is', locale);
    return `<article><h1>${esc(title)}</h1><p><strong>${esc(row.category)} · ${esc(String(row.year))}</strong></p>${desc}</article>`;
  }
  return '';
}

// Crawler HTML for the home page. The SPA renders hero/skills/stats/news/projects
// client-side, so without this Bingbot would index a near-empty <div id="app">.
// We pull the same site_content rows the SPA would fetch and emit real H1/H2
// + anchor links. Resilient: any sub-query that fails just returns null and
// we fall back to hardcoded copy keyed off DEFAULT_META.
async function crawlerHomeHtml(locale) {
  let heroRow, skillsRow, statsRow, newsRows, projectRows;
  try {
    [heroRow, skillsRow, statsRow, newsRows, projectRows] = await Promise.all([
      fetchContentFull('home_hero',   locale),
      fetchContentFull('home_skills', locale),
      fetchContentFull('home_stats',  locale),
      fetchListRows('news', 3),
      fetchListRows('projects', 3),
    ]);
  } catch {
    return '';
  }
  const defaults = metaFor(locale, 'home');

  // Hero — heading + tagline. Field names match what HomeView reads (heading,
  // tagline, subheading). Fall back to the page-level meta defaults so the
  // H1 is never empty.
  const heroHeading = heroRow?.heading || heroRow?.title || defaults.title;
  const heroTagline = heroRow?.tagline || heroRow?.subheading || heroRow?.description || defaults.description;
  const parts = [];
  parts.push(`<h1>${esc(heroHeading)}</h1>`);
  if (heroTagline) parts.push(`<p>${esc(heroTagline)}</p>`);

  // Skills — eyebrow + title + description + list of {label, value}.
  if (skillsRow) {
    const eyebrow     = skillsRow.eyebrow || '';
    const skillsTitle = (skillsRow.title || '').replace(/\n/g, ' ');
    const heading     = [eyebrow, skillsTitle].filter(Boolean).join(' ');
    if (heading) parts.push(`<h2>${esc(heading)}</h2>`);
    if (skillsRow.description) parts.push(`<p>${esc(stripHtml(skillsRow.description))}</p>`);
    if (Array.isArray(skillsRow.items) && skillsRow.items.length) {
      const li = skillsRow.items
        .filter(i => i && (i.label || i.value))
        .map(i => `<li><strong>${esc(i.label || '')}</strong> — ${esc(i.value || '')}</li>`)
        .join('');
      if (li) parts.push(`<ul>${li}</ul>`);
    }
  }

  // Stats — array of {num, label}. Keep terse; H2 + list.
  if (Array.isArray(statsRow) || (statsRow && Array.isArray(statsRow.items))) {
    const items = Array.isArray(statsRow) ? statsRow : statsRow.items;
    const li = items
      .filter(s => s && (s.num || s.label))
      .map(s => `<li><strong>${esc(s.num || '')}</strong> ${esc(s.label || '')}</li>`)
      .join('');
    if (li) {
      const statsHeading = locale === 'is' ? 'Tölur' : 'By the numbers';
      parts.push(`<h2>${esc(statsHeading)}</h2><ul>${li}</ul>`);
    }
  }

  // Featured projects — top 3 with anchor links into /<locale>/verkefni/<id>.
  if (Array.isArray(projectRows) && projectRows.length) {
    const sectionHeading = locale === 'is' ? 'Valin verkefni' : 'Featured projects';
    const li = projectRows.map(row => {
      const title = pickLocale(row, 'title', 'title_is', locale);
      const desc  = pickLocale(row, 'description', 'description_is', locale);
      const href  = `/${locale}/verkefni/${row.id}`;
      return `<li><a href="${esc(href)}"><h3>${esc(title)}</h3></a><p>${esc(stripHtml(desc).slice(0, 200))}</p></li>`;
    }).join('');
    parts.push(`<h2>${esc(sectionHeading)}</h2><ul>${li}</ul>`);
  }

  // Latest news — top 3, same shape.
  if (Array.isArray(newsRows) && newsRows.length) {
    const sectionHeading = locale === 'is' ? 'Nýjustu fréttir' : 'Latest news';
    const li = newsRows.map(row => {
      const title   = pickLocale(row, 'title', 'title_is', locale);
      const summary = pickLocale(row, 'summary', 'summary_is', locale);
      const href    = `/${locale}/news/${row.slug}`;
      return `<li><a href="${esc(href)}"><h3>${esc(title)}</h3></a><p>${esc(summary)}</p></li>`;
    }).join('');
    parts.push(`<h2>${esc(sectionHeading)}</h2><ul>${li}</ul>`);
  }

  return parts.join('');
}

// ── HTML rewriting ───────────────────────────────────────────────────────────

function replaceById(html, id, attrs, innerText) {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');
  const selfRe = new RegExp(`<(?:link|meta)\\b[^>]*\\bid="${id}"[^>]*\\/?\\s*>`, 'i');
  const pairedRe = new RegExp(`<(title|meta|link)\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</\\1>`, 'i');
  if (selfRe.test(html)) {
    return html.replace(selfRe, (match) => {
      const tag = /^<link/i.test(match) ? 'link' : 'meta';
      return `<${tag} ${attrStr} id="${id}" />`;
    });
  }
  if (pairedRe.test(html)) {
    return html.replace(pairedRe, (_m, tag) => `<${tag} ${attrStr} id="${id}">${esc(innerText || '')}</${tag}>`);
  }
  return html;
}

// Delete a placeholder <link>/<meta> from the template by id. Used for the
// hreflang alternates a locale-locked route has no counterpart for — leaving
// the baked-in tag would advertise a language the page isn't served in.
function removeById(html, id) {
  const selfRe = new RegExp(`[ \\t]*<(?:link|meta)\\b[^>]*\\bid="${id}"[^>]*\\/?\\s*>\\n?`, 'i');
  return html.replace(selfRe, '');
}

function rewriteHead(html, { title, description, canonical, hreflang, ogLocale, ogImage, jsonLd, robots, scenePreload }) {
  if (/<title\b/i.test(html)) {
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => `<title id="ssr-title">${esc(title)}</title>`);
  }
  html = html.replace(
    /<meta\s+name="description"[^>]*>/i,
    () => `<meta name="description" content="${esc(description)}" id="ssr-description" />`
  );
  // Hidden-but-functional surfaces (config/publicSurface.js) are de-indexed;
  // everything else keeps the template's index,follow.
  html = html.replace(
    /<meta\s+name="robots"[^>]*>/i,
    () => `<meta name="robots" content="${esc(robots || 'index, follow')}" id="ssr-robots" />`
  );
  // App environment for the client (drives the in-app feedback widget + TEST
  // chrome). Stamped from config/appEnv.js — the same predicate the change-
  // request gate opens on decides what is stamped as "test", so the widget can
  // never mount on a stack whose submits the gate would 404. (This used to
  // stamp any non-production NODE_ENV as "test" on its own; a NODE_ENV=staging
  // stack then showed the widget to everyone while the gate treated it as live.)
  const appEnv = clientAppEnv();
  html = html.replace(
    /<meta\s+name="app-env"[^>]*>/i,
    () => `<meta name="app-env" content="${esc(appEnv)}" id="ssr-app-env" />`
  );
  // The release this shell belongs to — the baseline services/buildGuard.js
  // compares every response's X-App-Build against. The public tag, never the
  // commit (server/config/version.js).
  html = html.replace(
    /<meta\s+name="app-build"[^>]*>/i,
    () => `<meta name="app-build" content="${esc(buildTag)}" id="ssr-app-build" />`
  );
  // Search-engine ownership verification — populated from env vars set in
  // Azure App Service after the respective Webmaster Tools / Search Console
  // accounts issue the token. Unset env vars leave the empty placeholder
  // alone (harmless — Bing/Google ignore empty content).
  const bingToken   = process.env.BING_VERIFICATION_TOKEN || '';
  const googleToken = process.env.GOOGLE_VERIFICATION_TOKEN || '';
  if (bingToken) {
    html = html.replace(
      /<meta\s+name="msvalidate\.01"[^>]*>/i,
      () => `<meta name="msvalidate.01" content="${esc(bingToken)}" />`
    );
  }
  if (googleToken) {
    html = html.replace(
      /<meta\s+name="google-site-verification"[^>]*>/i,
      () => `<meta name="google-site-verification" content="${esc(googleToken)}" />`
    );
  }
  html = html.replace(
    /<meta\s+property="og:title"[^>]*>/i,
    () => `<meta property="og:title" content="${esc(title)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:description"[^>]*>/i,
    () => `<meta property="og:description" content="${esc(description)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:url"[^>]*>/i,
    () => `<meta property="og:url" content="${esc(canonical)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:locale"[^>]*>/i,
    () => `<meta property="og:locale" content="${esc(ogLocale)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:image"[^>]*>/i,
    () => `<meta property="og:image" content="${esc(ogImage)}" data-base-href="${OG_IMAGE_PATH}" />`
  );
  html = replaceById(html, 'ssr-canonical', { rel: 'canonical', href: canonical });
  // Emit an alternate per locale the caller supplied; drop the placeholder tag
  // for any locale it omitted (locale-locked routes supply only their own).
  for (const lc of SUPPORTED_LOCALES) {
    html = hreflang[lc]
      ? replaceById(html, `ssr-hreflang-${lc}`, { rel: 'alternate', hreflang: lc, href: hreflang[lc] })
      : removeById(html, `ssr-hreflang-${lc}`);
  }
  html = hreflang['x-default']
    ? replaceById(html, 'ssr-hreflang-default', { rel: 'alternate', hreflang: 'x-default', href: hreflang['x-default'] })
    : removeById(html, 'ssr-hreflang-default');
  // The product identity rides the shell in two places (server/config/
  // identity.js): the theme trio as <html data-*-theme> attributes, which the
  // render-blocking theme-boot.js reads before any module runs, and the whole
  // record as <script id="identity"> for public/js/utils/identity.js.
  html = html.replace(
    /<html\b[^>]*\blang="[^"]*"/i,
    // + data-demo-instance on a demo instance (config/demoInstance.js): the banner reads it.
    () => `<html lang="${esc(ogLocale.split('_')[0])}" ${htmlIdentityAttrs()}${demoHtmlAttrs()}`
  );
  // The brand-bearing static tags: og:site_name is the brand, author the
  // registered company. Baked in index.html for the no-SSR case only.
  html = html.replace(
    /<meta\s+property="og:site_name"[^>]*>/i,
    () => `<meta property="og:site_name" content="${esc(identity.brand.name)}" />`
  );
  html = html.replace(
    /<meta\s+name="author"[^>]*>/i,
    () => `<meta name="author" content="${esc(identity.brand.legalName)}" />`
  );

  // Hero-image preload for scene routes — ahead of the main stylesheet so
  // the LCP fetch starts before CSS parse blocks anything.
  if (scenePreload) {
    html = html.replace(/<link rel="stylesheet" href="\/css\/main\.css"/i,
      () => `${scenePreload}\n  <link rel="stylesheet" href="/css/main.css"`);
  }
  // Inject the identity + module hand-offs and the per-route JSON-LD just
  // before </head>. The Organization is part of jsonLd on every page.
  const tail = [identityScriptTag(), modulesScriptTag(), jsonLd].filter(Boolean).join('\n  ');
  html = html.replace(/<\/head>/i, () => `  ${tail}\n</head>`);
  return html;
}

// Insert a hidden crawler-content sibling right after <div id="app">.
// Kept in DOM but hidden from users via the `hidden` attribute; crawlers
// treat it as regular content.
function injectCrawlerContent(html, innerHtml) {
  if (!innerHtml) return html;
  const block = `<div id="crawler-content" hidden aria-hidden="true">${innerHtml}</div>`;
  return html.replace(
    /<div id="app"><\/div>/,
    () => `<div id="app"></div>\n  ${block}`
  );
}

// ── Middleware ───────────────────────────────────────────────────────────────

module.exports = async function ssrMetaMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  const accept = req.headers['accept'] || '';
  if (!accept.includes('text/html') && accept !== '*/*' && accept !== '') return next();
  if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next();

  const { locale, rest } = extractLocale(req);
  const route = (rest === '' ? '/' : rest).replace(/\/+$/, '') || '/';

  // Static + section routes take precedence over detail patterns so that
  // /shop/products etc. don't accidentally match the /shop/:slug product
  // regex (which would try to fetch a product with slug='products').
  //
  // A route of a module this instance does not have (R4) is served exactly
  // like a path nobody knows: the default head, no detail row fetched, no
  // crawler list — a 404 page must not publish the switched-off module's
  // products or articles. app.js has already set the 404 status.
  const disabledRoute = isDisabledRoute(route);
  const staticMeta = disabledRoute ? null : (ROUTE_META[route] || null);
  const detail = (staticMeta || disabledRoute) ? null : extractDetail(route);

  let title, description, ogImage;
  let schemas = [];
  let detailRow = null;
  let lookupFailed = false;

  if (detail) {
    // ── Detail page (news article / product / project) ─────────────────
    detailRow = await fetchDetailRow(detail);
    if (detailRow === LOOKUP_FAILED) { lookupFailed = true; detailRow = null; }
    // A product merged into another (migration 120) moves permanently to the
    // survivor's page: 301, never cached (the survivor may be switched off or
    // merged again). The locale prefix and query string are kept.
    if (!detailRow && !lookupFailed && detail.type === 'product') {
      const moved = await ProductMerge.movedTo(detail.param).catch(() => null);
      if (moved) {
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(301, req.path.replace(/\/shop\/[^/]+\/?$/, `/shop/${encodeURIComponent(moved.slug)}`) + qs);
      }
    }
    if (!detailRow) {
      // Not found — fall back to section defaults so the SPA can render
      // its own 404 and we still serve *something* sensible to crawlers.
      const sectionKey = detail.section === 'shop' ? 'shop'
                       : detail.section === 'news' ? 'news'
                       : 'projects';
      const d = metaFor(locale, sectionKey);
      title       = d.title;
      description = d.description;
      ogImage     = `${APP_URL}${OG_IMAGE_PATH}`;
    } else {
      const canonical = `${APP_URL}${req.path}`;
      if (detail.type === 'news') {
        title       = pickLocale(detailRow, 'title', 'title_is', locale);
        description = pickLocale(detailRow, 'summary', 'summary_is', locale);
        const img   = locale === 'is' && detailRow.cover_image_is ? detailRow.cover_image_is : detailRow.cover_image;
        ogImage     = img ? absUrl(img) : `${APP_URL}${OG_IMAGE_PATH}`;
        schemas.push(articleSchema(detailRow, locale, canonical));
        schemas.push(breadcrumbSchema({ section: 'news', detailName: title, localePath: `/news/${detailRow.slug}`, locale }));
      } else if (detail.type === 'product') {
        title       = pickLocale(detailRow, 'name', 'name_is', locale);
        description = stripHtml(pickLocale(detailRow, 'description', 'description_is', locale)).slice(0, 200);
        ogImage     = detailRow.image_url ? absUrl(detailRow.image_url) : `${APP_URL}${OG_IMAGE_PATH}`;
        schemas.push(productSchema(detailRow, locale, canonical));
        schemas.push(breadcrumbSchema({ section: 'shop', detailName: title, localePath: `/shop/${detailRow.slug}`, locale }));
      } else if (detail.type === 'project') {
        title       = pickLocale(detailRow, 'title', 'title_is', locale);
        description = stripHtml(pickLocale(detailRow, 'description', 'description_is', locale)).slice(0, 200);
        ogImage     = detailRow.image_url ? absUrl(detailRow.image_url) : `${APP_URL}${OG_IMAGE_PATH}`;
        schemas.push(creativeWorkSchema(detailRow, locale, canonical));
        schemas.push(breadcrumbSchema({ section: 'projects', detailName: title, localePath: `/verkefni/${detailRow.id}`, locale }));
      }
    }
  } else {
    // ── List / static page ──────────────────────────────────────────────
    const meta = staticMeta;
    const key  = meta?.key;
    const defaults = metaFor(locale, key) || {};
    const home     = metaFor(DEFAULT_LOCALE, 'home');
    // For shop section sub-routes we deliberately do NOT pull meta_title /
    // meta_description from shop_hero — the shared hero copy applies to the
    // landing only. Per-section pages get the DEFAULT_META titles so each
    // route stays independently SEO-indexable.
    const override = (meta?.contentKey && !meta.section) ? await fetchContentMeta(meta.contentKey, locale) : null;

    title       = override?.title       || defaults.title       || home.title;
    description = override?.description || defaults.description || home.description;
    ogImage     = `${APP_URL}${OG_IMAGE_PATH}`;

    // Party links share the admin-uploaded cover photo instead of the generic
    // site card. Falls back to OG_IMAGE_PATH above when no cover is uploaded.
    if (key === 'party') {
      const partyOg = await fetchPartyOgImage();
      if (partyOg) ogImage = partyOg;
    }

    // Breadcrumbs on any non-home page.
    if (route !== '/') {
      // The services page is the one non-home route that carries the offering
      // itself, so the Service catalog belongs on it as well as on /.
      if (route === '/thjonusta' && !isHiddenRoute('/thjonusta')) schemas.push(serviceSchema(locale));

      let section = null;
      let detailName = null;
      if (route === '/verkefni' || route === '/projects' || route === '/news' || route === '/shop') {
        section = route === '/verkefni' ? 'projects' : route.slice(1);
      } else if (meta?.section) {
        // Shop sub-route — breadcrumb is Home › Shop › <Section title>
        section = meta.section;
        detailName = title;
      }
      const bc = breadcrumbSchema({
        section,
        detailName: detailName ?? (section ? null : title),
        localePath: route,
        locale,
      });
      if (bc) schemas.push(bc);
    } else {
      // Home page — WebSite (brand-name variants for knowledge-graph matching)
      // plus the Service catalog, both resolving to the Organization schema
      // baked into public/index.html.
      schemas.push(websiteSchema());
      // The Service catalogue is the company's offering (SERVICE_OFFERINGS +
      // the product entry): only while the services page is public.
      if (!isHiddenRoute('/thjonusta')) schemas.push(serviceSchema(locale));
    }
  }

  const routePath = route === '/' ? '/' : route;

  // Locale-locked routes (Icelandic-only party pages) publish exactly one URL:
  // canonical points at it, x-default falls back to it, and the alternates for
  // every other language are omitted entirely (rewriteHead drops the tags).
  // Claiming an hreflang="en" alternate that 301s to Icelandic is a
  // contradiction crawlers resolve by discarding the whole cluster.
  const forcedLocale = forcedLocaleFor(req.path);
  const canonical = forcedLocale
    ? `${APP_URL}/${forcedLocale}${routePath}`
    : `${APP_URL}${req.path}`;
  const hreflang = forcedLocale
    ? {
      [forcedLocale]: `${APP_URL}/${forcedLocale}${routePath}`,
      'x-default':    `${APP_URL}/${forcedLocale}${routePath}`,
    }
    : {
      en:           `${APP_URL}/en${routePath}`,
      is:           `${APP_URL}/is${routePath}`,
      'x-default':  `${APP_URL}${routePath}`,
    };
  const ogLocale = locale === 'is' ? 'is_IS' : 'en_IS';

  // The Organization leads on every page — everything above references it.
  const jsonLdHtml = jsonLdScript([organizationSchema(locale), ...schemas]);

  // Crawler body content — covers the home page, list pages, and detail
  // pages. Bing and other non-JS crawlers index the initial HTML response,
  // so anything the SPA would render client-side has to be mirrored here.
  // Other static pages (halli, contact, privacy, terms) still rely on the
  // SPA — their <head> meta plus JSON-LD give crawlers enough signal and
  // the content there changes too rarely to be worth pre-rendering.
  let crawlerHtml = '';
  if (disabledRoute) {
    // Nothing: see `disabledRoute` above.
  } else if (detail) {
    if (detailRow) crawlerHtml = crawlerDetailHtml(detail.type, detailRow, locale);
  } else if (route === '/news' || route === '/shop' || route === '/projects') {
    const section = route.slice(1);
    const rows    = await fetchListRows(section, 10);
    if (rows.length) crawlerHtml = crawlerListHtml(section, rows, locale);
  } else if (staticMeta?.section === 'shop' && staticMeta.categoryFilter) {
    // Shop section sub-route — same crawler list shape as /shop but filtered.
    const rows = await fetchListRows('shop', 10, staticMeta.categoryFilter);
    if (rows.length) crawlerHtml = crawlerListHtml('shop', rows, locale);
  } else if (route === '/') {
    try {
      crawlerHtml = await crawlerHomeHtml(locale);
    } catch {
      // Silent fallback — homepage must still render even if every
      // sub-query fails. Crawlers just lose the body hint for this request.
      crawlerHtml = '';
    }
  }

  // A real 404 status (icelandicstore #399): a path no SPA route matches, or a
  // detail URL (article, product, project) with no live row. Same shell, so the
  // router still renders NotFoundView; only crawlers and monitors see the
  // difference — a soft 404 (200 + "not found" page) gets indexed and hides
  // dead links. A FAILED lookup keeps 200 (never cached) rather than claiming
  // the page does not exist. A switched-off module's route was already set to
  // 404 by app.js. The route list is public/js/routePatterns.json (kept equal
  // to router.js by tests/unit/routePatterns.test.js); a product's own routes
  // are in ROUTE_META via identity.routes.
  const missedDetail = Boolean(detail && !detailRow);
  const unknownRoute = !disabledRoute && !detail && !staticMeta && !matchesSpaRoute(route);
  const notFound = (missedDetail && !lookupFailed) || unknownRoute;
  if (notFound) res.status(404);

  let html = rewriteHead(loadTemplate(), {
    title, description, canonical, hreflang, ogLocale, ogImage,
    jsonLd: jsonLdHtml,
    // Hidden surfaces (by prefix) and the product's own noindex routes
    // (identity.routes[*].noindex) are de-indexed; everything else is indexable
    // — but only on an indexable instance: a non-production stack, or any stack
    // reached on an infrastructure host, is noindex on every route
    // (utils/indexability.js, ported from icelandicstore #123; robots.txt and
    // the sitemap apply the same rule).
    robots: (notFound || isDeindexedRoute(route) || !isIndexableRequest(req)) ? 'noindex, nofollow' : 'index, follow',
    scenePreload: scenePreloadTag(route),
  });
  html = injectCrawlerContent(html, crawlerHtml);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The shell revalidates on every load (ETag → a cheap 304). It used to be
  // `public, max-age=300`, but the shell now carries <meta name="app-build">: a
  // cached copy names the PREVIOUS release, so a page that reloaded because a
  // deploy happened would boot from that stale shell, see the mismatch again
  // and reload again, for up to five minutes (services/buildGuard.js). A
  // detail URL that found no row is never cached: the row may be published a
  // minute later (icelandicstore #332).
  res.setHeader('Cache-Control', missedDetail ? 'no-store' : 'public, no-cache');
  // Host: the robots meta tag depends on it (utils/indexability.js).
  res.setHeader('Vary', 'Accept-Language, Cookie, Host');
  res.send(html);
};

// For routes/sitemapRoutes.js (/llms.txt, rk-feed 2026-09-23): the composed
// title + description of a static route in a locale, from the same tables a
// page load reads — so the crawler summary and the <title> can never say two
// different things. Null for a route the tables do not know.
// Test seam: swap lookups.detail for a failing function (no pg mock).
module.exports.lookups = lookups;
module.exports.stampAssetUrls = stampAssetUrls;

module.exports.metaForRoute = function metaForRoute(locale, route) {
  const entry = ROUTE_META[route];
  return entry ? metaFor(locale, entry.key) : null;
};
// The site_content rows an ENGINE static route renders (the sitemap's
// <lastmod> source): the meta-override row of ROUTE_META plus what the
// crawler/SPA render for the page. A product route's list is
// identity.routes[*].contentKeys (config/identity.js productRoutes).
module.exports.contentKeysForRoute = function contentKeysForRoute(route) {
  const entry = ROUTE_META[route];
  if (!entry) return [];
  if (entry.product) return (PRODUCT_ROUTES[route] && PRODUCT_ROUTES[route].contentKeys) || [];
  const extra = {
    '/':             ['home_hero', 'home_skills', 'home_stats'],
    '/hafa-samband': ['contact_hero', 'contact_card', 'contact_form', 'contact_availability', 'contact_footer'],
    '/contact':      ['contact_hero', 'contact_card', 'contact_form', 'contact_availability', 'contact_footer'],
  }[route] || [];
  return [...new Set([entry.contentKey, ...extra].filter(Boolean))];
};
