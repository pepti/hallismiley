'use strict';
/*
 * Dynamic sitemap.xml — the PUBLIC BUSINESS surface only: the six business
 * routes plus every project (case study). Regenerated on each request from
 * DB state; projected sitemap size stays well under Google's 50,000-URL /
 * 50 MiB limit for the foreseeable future, so a single SELECT is plenty.
 *
 * Hidden-but-functional surfaces (party, bio, news, shop, and the superseded
 * /projects · /contact · /privacy aliases — see server/config/publicSurface.js)
 * are deliberately ABSENT: they still render and still work, but the sitemap
 * must not advertise what ssrMeta marks noindex, or the two contradict.
 *
 * Response is cached for 10 minutes (+ 5 min stale-while-revalidate)
 * so bot crawl spikes don't thrash the database.
 */

const express = require('express');
const { forcedLocaleFor } = require('../config/i18n');

const APP_URL = (process.env.APP_URL || 'https://www.orangesmiley.is').replace(/\/$/, '');

// Static business pages — one entry per locale. The home page gets an extra
// x-default entry because it's the locale-selection landing.
const STATIC_ROUTES = [
  { path: '',                 priority: '1.0', changefreq: 'monthly', includeXDefault: true  },
  { path: '/thjonusta',       priority: '0.9', changefreq: 'monthly'                         },
  { path: '/um-okkur',        priority: '0.7', changefreq: 'monthly'                         },
  { path: '/hafa-samband',    priority: '0.7', changefreq: 'monthly'                         },
  { path: '/personuvernd',    priority: '0.3', changefreq: 'yearly'                          },
  { path: '/terms',           priority: '0.3', changefreq: 'yearly'                          },
];

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

async function buildSitemap() {
  // No detail routes are advertised. Projects (case studies) were the one
  // surface listed here until 2026-09-03, when /verkefni joined the hidden
  // list (Halli); linking its details now would contradict the noindex
  // ssrMeta emits, same as news and products before it.
  const urls = [];

  // Static pages. Locale-locked routes are derived from config/i18n rather than
  // flagged in the table above, so the lock has exactly one source of truth.
  for (const r of STATIC_ROUTES) {
    urls.push(urlEntry({
      localePath: r.path,
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

const router = express.Router();

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

module.exports = { router, buildSitemap };
