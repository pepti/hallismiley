'use strict';
/*
 * Dynamic sitemap.xml — covers the 13 static list pages plus every
 * published news article, active product, and project. Regenerated
 * on each request from DB state; projected sitemap size stays
 * well under Google's 50,000-URL / 50 MiB limit for the foreseeable
 * future, so a single SELECT per table is plenty.
 *
 * Response is cached for 10 minutes (+ 5 min stale-while-revalidate)
 * so bot crawl spikes don't thrash the database.
 */

const express = require('express');
const { query } = require('../config/database');

const APP_URL = (process.env.APP_URL || 'https://www.hallismiley.is').replace(/\/$/, '');

// Static list pages — one entry per locale. The home page gets an extra
// x-default entry because it's the locale-selection landing.
const STATIC_ROUTES = [
  { path: '',          priority: '1.0', changefreq: 'monthly', includeXDefault: true  },
  { path: '/projects', priority: '0.9', changefreq: 'weekly'                          },
  { path: '/halli',    priority: '0.8', changefreq: 'monthly'                         },
  { path: '/shop',     priority: '0.8', changefreq: 'weekly'                          },
  { path: '/news',     priority: '0.7', changefreq: 'weekly'                          },
  { path: '/contact',  priority: '0.6', changefreq: 'monthly'                         },
  { path: '/privacy',  priority: '0.3', changefreq: 'yearly'                          },
  { path: '/terms',    priority: '0.3', changefreq: 'yearly'                          },
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

function isoDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// Build a <url> entry with both locales linked via hreflang.
// `localePath` is the per-locale suffix applied after /en or /is
// (e.g. '/news/my-slug' — does NOT include the locale prefix).
function urlEntry({ localePath, lastmod, priority = '0.5', changefreq = 'monthly', includeXDefault = false }) {
  // Home (empty path) renders as /en/ with trailing slash to match the
  // locale-prefix convention used everywhere else in the app; deep paths
  // (/projects, /news/slug, …) concatenate directly.
  const suffix = localePath === '' ? '/' : localePath;
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
  // Run all three content queries in parallel. These are small indexed
  // scans — hundreds of microseconds each on a healthy pool.
  const [projectsRes, newsRes, productsRes] = await Promise.all([
    query('SELECT id, updated_at FROM projects ORDER BY updated_at DESC'),
    query(
      `SELECT slug, published_at, updated_at
         FROM news_articles
        WHERE published = TRUE
        ORDER BY published_at DESC NULLS LAST`
    ),
    query(
      `SELECT slug, updated_at
         FROM products
        WHERE active = TRUE
        ORDER BY updated_at DESC`
    ),
  ]);

  const urls = [];

  // Static pages
  for (const r of STATIC_ROUTES) {
    urls.push(urlEntry({
      localePath: r.path,
      priority: r.priority,
      changefreq: r.changefreq,
      includeXDefault: !!r.includeXDefault,
    }));
  }

  // Projects — ID-based routes
  for (const row of projectsRes.rows) {
    urls.push(urlEntry({
      localePath: `/projects/${row.id}`,
      lastmod: isoDate(row.updated_at),
      priority: '0.7',
      changefreq: 'monthly',
    }));
  }

  // News articles — slug-based routes
  for (const row of newsRes.rows) {
    urls.push(urlEntry({
      localePath: `/news/${row.slug}`,
      lastmod: isoDate(row.updated_at || row.published_at),
      priority: '0.6',
      changefreq: 'monthly',
    }));
  }

  // Products — slug-based routes
  for (const row of productsRes.rows) {
    urls.push(urlEntry({
      localePath: `/shop/${row.slug}`,
      lastmod: isoDate(row.updated_at),
      priority: '0.7',
      changefreq: 'weekly',
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
