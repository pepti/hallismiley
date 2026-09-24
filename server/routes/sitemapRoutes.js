'use strict';
/*
 * Dynamic sitemap.xml — the PUBLIC surface only: home, the product's nav
 * routes and the legal pages (staticRoutes() below, derived from the identity
 * seam). Regenerated on each request; projected sitemap size stays well under
 * Google's 50,000-URL / 50 MiB limit for the foreseeable future.
 *
 * Hidden-but-functional surfaces (party, bio, news, shop, and the superseded
 * /projects · /contact · /privacy aliases — see server/config/publicSurface.js)
 * are deliberately ABSENT: they still render and still work, but the sitemap
 * must not advertise what ssrMeta marks noindex, or the two contradict.
 *
 * <lastmod> (rk-feed, 2026-09-23; born in rekstrarkerfid 0a928c9): the last
 * admin save of the site_content rows a page renders, either locale — the
 * engine's rows per route from ssrMeta.contentKeysForRoute, a product route's
 * from identity.routes[*].contentKeys. A page whose copy lives only in the
 * locale files gets none: search engines learn to ignore a sitemap whose
 * lastmod is not truthful, so a deploy timestamp would be worse than no value.
 * One query, cached in-process for the same 10 minutes as the response.
 *
 * /llms.txt (llmstxt.org; same origin): a plain-Markdown summary of the
 * product for AI assistants — brand, description, every advertised page with
 * its title and description per locale — built from the identity seam and the
 * same meta tables the pages read, so nothing is a second copy to keep in
 * sync. Gated on nothing: every product wants it.
 *
 * Responses are cached for 10 minutes (+ 5 min stale-while-revalidate)
 * so bot crawl spikes don't thrash the database.
 */

const express = require('express');
const db      = require('../config/database');
const { forcedLocaleFor, SUPPORTED_LOCALES, PUBLIC_DEFAULT_LOCALE } = require('../config/i18n');
const { publicNav, legalRoutes, NOINDEX_ROUTES } = require('../config/publicSurface');
const { identity, organizationDescription } = require('../config/identity');
const { t, has } = require('../i18n');

const APP_URL = (process.env.APP_URL || 'https://www.orangesmiley.is').replace(/\/$/, '');

// Static pages — one entry per locale. The list is the PRODUCT's public IA
// (identity-seam-2, 2026-09-23): the home page (with an extra x-default entry,
// it is the locale-selection landing), then the nav routes of
// `identity.surface.nav` in nav order, then the engine's legal pages — each
// list already minus `identity.surface.hiddenRoutes` (config/publicSurface.js)
// and minus any route the product marks `noindex` in `identity.routes`
// (identity-seam-3: a noindex page may be linked, never advertised).
// Nothing here is a route literal, so a downstream's sitemap is its own nav.
// Read per request since R5b: a module an admin switches off at run time
// leaves the sitemap at once (config/modules.js).
function staticRoutes() {
  return [
    { path: '', priority: '1.0', changefreq: 'monthly', includeXDefault: true },
    ...publicNav().map(e => ({ path: e.route, priority: '0.8', changefreq: 'monthly' })),
    ...legalRoutes().map(r => ({ path: r, priority: '0.3', changefreq: 'yearly' })),
  ].filter(r => !NOINDEX_ROUTES.includes(r.path || '/'));
}

// XML escaping — URLs can contain &, <, > via slugs in principle even
// though the DB constraints should forbid it. Cheap safety net.
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Build a <url> entry with both locales linked via hreflang.
// `localePath` is the per-locale suffix applied after /en or /is
// (e.g. '/news/my-slug' — does NOT include the locale prefix).
//
// `onlyLocale` marks a locale-locked route (the Icelandic-only party pages):
// it emits a single <url> for that locale with no hreflang alternates at all.
// The other-locale URL 301s away, so listing it here would hand crawlers a
// sitemap entry that contradicts both the redirect and the page's canonical.
function urlEntry({ localePath, lastmod, priority = '0.5', changefreq = 'monthly', includeXDefault = false, onlyLocale = null }) {
  // Home (empty path) renders as /en/ with trailing slash to match the
  // locale-prefix convention used everywhere else in the app; deep paths
  // (/projects, /news/slug, …) concatenate directly.
  const suffix = localePath === '' ? '/' : localePath;

  if (onlyLocale) {
    const loc = localePath === '' ? `${APP_URL}/${onlyLocale}/` : `${APP_URL}/${onlyLocale}${suffix}`;
    const only = ['  <url>', `    <loc>${xmlEscape(loc)}</loc>`];
    if (lastmod) only.push(`    <lastmod>${lastmod}</lastmod>`);
    only.push(`    <changefreq>${changefreq}</changefreq>`);
    only.push(`    <priority>${priority}</priority>`);
    only.push('  </url>');
    return only.join('\n');
  }

  const en = localePath === '' ? `${APP_URL}/en/` : `${APP_URL}/en${suffix}`;
  const is = localePath === '' ? `${APP_URL}/is/` : `${APP_URL}/is${suffix}`;
  const lines = [
    '  <url>',
    `    <loc>${xmlEscape(en)}</loc>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${xmlEscape(en)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="is" href="${xmlEscape(is)}"/>`,
  ];
  if (includeXDefault) {
    const def = `${APP_URL}${localePath || '/'}`;
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(def)}"/>`);
  }
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>${changefreq}</changefreq>`);
  lines.push(`    <priority>${priority}</priority>`);
  lines.push('  </url>');

  // Also emit the Icelandic alternate as its own <url> entry with the
  // same hreflang set — Google requires each alternate URL to be a
  // discoverable entry in the sitemap, not just referenced from the en one.
  const isLines = [
    '  <url>',
    `    <loc>${xmlEscape(is)}</loc>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${xmlEscape(en)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="is" href="${xmlEscape(is)}"/>`,
  ];
  if (includeXDefault) {
    const def = `${APP_URL}${localePath || '/'}`;
    isLines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(def)}"/>`);
  }
  if (lastmod) isLines.push(`    <lastmod>${lastmod}</lastmod>`);
  isLines.push(`    <changefreq>${changefreq}</changefreq>`);
  isLines.push(`    <priority>${priority}</priority>`);
  isLines.push('  </url>');

  return lines.concat(isLines).join('\n');
}

// ── <lastmod> ──────────────────────────────────────────────────────────────
// Lazy: ssrMeta reads router.js + the locale files at load, and app.js loads
// it anyway; requiring it here at module top would only reorder that.
function ssrMeta() { return require('../middleware/ssrMeta'); }

/** route → site_content keys, for every advertised route that has any. */
function lastmodKeys() {
  const out = {};
  for (const r of staticRoutes()) {
    const keys = ssrMeta().contentKeysForRoute(r.path || '/');
    if (keys.length) out[r.path] = keys;
  }
  return out;
}

const LASTMOD_TTL_MS = 10 * 60 * 1000;
let lastmodCache = { at: 0, value: null };

/** route → 'YYYY-MM-DD' of the newest row among its keys (either locale). */
async function fetchLastmods() {
  if (lastmodCache.value && Date.now() - lastmodCache.at < LASTMOD_TTL_MS) return lastmodCache.value;
  const out = {};
  const byRoute = lastmodKeys();
  const keys = [...new Set(Object.values(byRoute).flat())];
  if (keys.length) {
    try {
      const { rows } = await db.query(
        'SELECT key, MAX(updated_at) AS updated_at FROM site_content WHERE key = ANY($1) GROUP BY key',
        [keys]
      );
      const byKey = Object.fromEntries(rows.map(r => [r.key, new Date(r.updated_at).getTime()]));
      for (const [p, ks] of Object.entries(byRoute)) {
        const times = ks.map(k => byKey[k]).filter(Number.isFinite);
        if (times.length) out[p] = new Date(Math.max(...times)).toISOString().slice(0, 10);
      }
    } catch {
      /* a sitemap without lastmod is still a valid sitemap */
    }
  }
  lastmodCache = { at: Date.now(), value: out };
  return out;
}

/** Drops the cached lastmods — for the tests and for an admin save. */
function invalidateLastmodCache() {
  lastmodCache = { at: 0, value: null };
}

async function buildSitemap() {
  // No detail routes are advertised. Projects (case studies) were the one
  // surface listed here until 2026-09-03, when /verkefni joined the hidden
  // list (Halli); linking its details now would contradict the noindex
  // ssrMeta emits, same as news and products before it.
  const urls = [];
  const lastmods = await fetchLastmods();

  // Static pages. Locale-locked routes are derived from config/i18n rather than
  // flagged in the table above, so the lock has exactly one source of truth.
  for (const r of staticRoutes()) {
    urls.push(urlEntry({
      localePath: r.path,
      lastmod: lastmods[r.path],
      priority: r.priority,
      changefreq: r.changefreq,
      includeXDefault: !!r.includeXDefault,
      onlyLocale: forcedLocaleFor(r.path || '/'),
    }));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls.join('\n'),
    '</urlset>',
    '',
  ].join('\n');
}

// ── /llms.txt ──────────────────────────────────────────────────────────────
// The page name is the translated PART: the brand suffix a <title> carries is
// stripped, and the home title's leading "Brand — " becomes "Brand: …" so the
// list reads as pages, not as tabs.
function pageName(title) {
  const { name, titleSuffix } = identity.brand;
  if (titleSuffix && title.endsWith(titleSuffix)) return title.slice(0, -titleSuffix.length);
  if (title.startsWith(`${name} — `)) return `${name}: ${title.slice(name.length + 3)}`;
  return title;
}

function llmsPageLine(locale, route) {
  const m = ssrMeta().metaForRoute(locale, route);
  if (!m) return null;
  const url = route === '/' ? `${APP_URL}/${locale}/` : `${APP_URL}/${locale}${route}`;
  return `- [${pageName(m.title)}](${url})${m.description ? `: ${m.description}` : ''}`;
}

function buildLlmsTxt() {
  const { brand, organization } = identity;
  const locales = [PUBLIC_DEFAULT_LOCALE, ...SUPPORTED_LOCALES.filter(lc => lc !== PUBLIC_DEFAULT_LOCALE)];
  const advertised = staticRoutes().map(r => r.path || '/');
  const description = organizationDescription(PUBLIC_DEFAULT_LOCALE, { has, t });
  const place = [organization.addressLocality, organization.areaServed].filter(Boolean).join(', ');
  const lines = [
    `# ${brand.name}`,
    '',
    `> ${description}`,
    '',
    `${brand.legalName}${place ? `, ${place}` : ''}. Default language: ${PUBLIC_DEFAULT_LOCALE}; also: ${SUPPORTED_LOCALES.filter(lc => lc !== PUBLIC_DEFAULT_LOCALE).join(', ') || 'none'}. Every page below exists under each locale prefix unless listed once.`,
  ];
  for (const locale of locales) {
    const items = advertised
      .filter(route => { const lock = forcedLocaleFor(route); return !lock || lock === locale; })
      .map(route => llmsPageLine(locale, route))
      .filter(Boolean);
    if (!items.length) continue;
    lines.push('', `## Pages (${locale})`, '', ...items);
  }
  lines.push('', '## Optional', '', `- [Sitemap](${APP_URL}/sitemap.xml)`, '');
  return lines.join('\n');
}

const router = express.Router();

router.get('/llms.txt', (req, res, next) => {
  try {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=300');
    res.status(200).send(buildLlmsTxt());
  } catch (err) {
    next(err);
  }
});

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const xml = await buildSitemap();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=300');
    res.status(200).send(xml);
  } catch (err) {
    next(err);
  }
});

module.exports = { router, buildSitemap, buildLlmsTxt, lastmodKeys, invalidateLastmodCache };
