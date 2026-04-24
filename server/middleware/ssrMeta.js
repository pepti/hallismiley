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
const { DEFAULT_LOCALE, SUPPORTED_LOCALES } = require('../config/i18n');

const APP_URL        = (process.env.APP_URL || 'https://www.hallismiley.is').replace(/\/$/, '');
const INDEX_PATH     = path.join(__dirname, '..', '..', 'public', 'index.html');
const OG_IMAGE_PATH  = '/og-image.jpg';

// Cached template (read once at boot) + stat watcher for dev hot-reload.
let _template = null;
function loadTemplate() {
  if (_template) return _template;
  _template = fs.readFileSync(INDEX_PATH, 'utf8');
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
const ROUTE_META = {
  '/':         { key: 'home',     contentKey: 'home_skills' },
  '/projects': { key: 'projects' },
  '/halli':    { key: 'halli',    contentKey: 'halli_bio' },
  '/about':    { key: 'halli',    contentKey: 'halli_bio' },
  '/shop':     { key: 'shop',     contentKey: 'shop_hero' },
  '/news':     { key: 'news' },
  '/contact':  { key: 'contact',  contentKey: 'contact_hero' },
  '/privacy':  { key: 'privacy' },
  '/terms':    { key: 'terms' },
  '/party':    { key: 'party' },
};

const DEFAULT_META = {
  en: {
    home:     { title: 'Halli Smiley — Icelandic Carpenter & Computer Scientist', description: 'Portfolio of Halli, an Icelandic carpenter and computer scientist. Twenty years of precision joinery and timber framing combined with full-stack web development.' },
    projects: { title: 'Projects — Halli Smiley', description: 'Selected carpentry and software projects by Halli — hand-cut joinery, timber frames, custom web apps.' },
    halli:    { title: 'About Halli — Where Wood Meets Code', description: 'The long-form story of Halli: an Icelandic craftsman who moves between wood and software with the same discipline and care.' },
    shop:     { title: 'Shop — Halli Smiley', description: 'Apparel and goods from the workshop. Prices include 24% VAT, shipping from Iceland.' },
    news:     { title: 'News — Halli Smiley', description: 'Updates from the workshop, notes on projects in progress, and occasional writing on the craft-code overlap.' },
    contact:  { title: 'Contact — Halli Smiley', description: 'Reach Halli about carpentry commissions, software work, or anything at the intersection of the two.' },
    privacy:  { title: 'Privacy Policy — Halli Smiley' },
    terms:    { title: 'Terms of Service — Halli Smiley' },
    party:    { title: "Halli's 40th Birthday Party" },
  },
  is: {
    home:     { title: 'Halli Smiley — Íslenskur smiður & tölvunarfræðingur', description: 'Verkefnasafn Halla, íslensks smiðs og tölvunarfræðings. Tuttugu ára nákvæmni í smíði og grindarsmíði sem sameinast fullgildri vefforritun.' },
    projects: { title: 'Verkefni — Halli Smiley', description: 'Valin smíða- og hugbúnaðarverkefni Halla — handskornar fellingar, burðargrindur, sérsmíðuð vefforrit.' },
    halli:    { title: 'Um Halla — Þar sem viður mætir kóða', description: 'Löng saga Halla: íslenskur handverksmaður sem flakkar á milli viðar og hugbúnaðar með sama aga og umhyggju.' },
    shop:     { title: 'Verslun — Halli Smiley', description: 'Fatnaður og varningur úr verkstæðinu. Verð með 24% VSK, sent frá Íslandi.' },
    news:     { title: 'Fréttir — Halli Smiley', description: 'Fréttir úr verkstæðinu, glósur um verkefni í vinnslu og stöku skrif um handverk og forritun.' },
    contact:  { title: 'Samband — Halli Smiley', description: 'Hafðu samband við Halla um smíðaverkefni, hugbúnaðarverkefni eða eitthvað þar á milli.' },
    privacy:  { title: 'Persónuverndarstefna — Halli Smiley' },
    terms:    { title: 'Notkunarskilmálar — Halli Smiley' },
    party:    { title: '40 ára afmæli Halla' },
  },
};

// Section labels for breadcrumbs (per locale).
const SECTION_LABELS = {
  en: { projects: 'Projects', news: 'News', shop: 'Shop' },
  is: { projects: 'Verkefni', news: 'Fréttir', shop: 'Verslun' },
};

// Detail-route patterns. Order matters only because each returns on first match.
const DETAIL_PATTERNS = [
  { re: /^\/news\/([^/]+)$/,    type: 'news'    },
  { re: /^\/shop\/([^/]+)$/,    type: 'product' },
  { re: /^\/projects\/(\d+)$/,  type: 'project' },
];

function extractDetail(route) {
  for (const p of DETAIL_PATTERNS) {
    const m = route.match(p.re);
    if (m) return { type: p.type, param: m[1], section: p.type === 'product' ? 'shop' : p.type + 's' };
  }
  return null;
}

function extractLocale(pathname) {
  const parts = (pathname || '/').split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) {
    return { locale: parts[0], rest: '/' + parts.slice(1).join('/') || '/' };
  }
  return { locale: DEFAULT_LOCALE, rest: pathname || '/' };
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

async function fetchDetailRow(detail) {
  try {
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
                p.price_isk, p.price_eur, p.stock, p.active, p.updated_at,
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
  } catch {
    return null;
  }
  return null;
}

async function fetchListRows(section, limit = 10) {
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
      const { rows } = await db.query(
        `SELECT p.slug, p.name, p.name_is, p.description, p.description_is,
                p.price_isk, p.updated_at,
                (SELECT url FROM product_images
                  WHERE product_id = p.id
               ORDER BY position ASC, created_at ASC
                  LIMIT 1) AS image_url
           FROM products p
          WHERE p.active = TRUE
          ORDER BY p.updated_at DESC
          LIMIT $1`,
        [limit]
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
      item: `${APP_URL}/${locale}/${section}`,
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
    author:    { '@type': 'Person', name: 'Halli' },
    publisher: { '@type': 'Person', name: 'Halli' },
    mainEntityOfPage: canonical,
  };
}

function productSchema(row, locale, canonical) {
  const name = pickLocale(row, 'name', 'name_is', locale);
  const desc = pickLocale(row, 'description', 'description_is', locale);
  const availability = (row.stock > 0)
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: desc,
    image: row.image_url ? absUrl(row.image_url) : `${APP_URL}${OG_IMAGE_PATH}`,
    sku: row.slug,
    brand: { '@type': 'Brand', name: 'Halli Smiley' },
    offers: {
      '@type': 'Offer',
      url: canonical,
      price: row.price_isk,
      priceCurrency: 'ISK',
      availability,
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
    creator: { '@type': 'Person', name: 'Halli' },
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
  const heading = DEFAULT_META[locale]?.[section]?.title || DEFAULT_META.en[section].title;
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
      const href  = `/${locale}/projects/${row.id}`;
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

function rewriteHead(html, { title, description, canonical, hreflang, ogLocale, ogImage, jsonLd }) {
  if (/<title\b/i.test(html)) {
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title id="ssr-title">${esc(title)}</title>`);
  }
  html = html.replace(
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${esc(description)}" id="ssr-description" />`
  );
  html = html.replace(
    /<meta\s+property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${esc(title)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${esc(description)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${esc(canonical)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:locale"[^>]*>/i,
    `<meta property="og:locale" content="${esc(ogLocale)}" />`
  );
  html = html.replace(
    /<meta\s+property="og:image"[^>]*>/i,
    `<meta property="og:image" content="${esc(ogImage)}" data-base-href="${OG_IMAGE_PATH}" />`
  );
  html = replaceById(html, 'ssr-canonical',        { rel: 'canonical', href: canonical });
  html = replaceById(html, 'ssr-hreflang-en',      { rel: 'alternate', hreflang: 'en',        href: hreflang.en });
  html = replaceById(html, 'ssr-hreflang-is',      { rel: 'alternate', hreflang: 'is',        href: hreflang.is });
  html = replaceById(html, 'ssr-hreflang-default', { rel: 'alternate', hreflang: 'x-default', href: hreflang['x-default'] });
  html = html.replace(/<html\b[^>]*\blang="[^"]*"/i, `<html lang="${esc(ogLocale.split('_')[0])}"`);

  // Inject per-route JSON-LD just before </head>. The baked Person schema
  // on home stays in place (inside <head> before this insertion point).
  if (jsonLd) {
    html = html.replace(/<\/head>/i, `  ${jsonLd}\n</head>`);
  }
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
    `<div id="app"></div>\n  ${block}`
  );
}

// ── Middleware ───────────────────────────────────────────────────────────────

module.exports = async function ssrMetaMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  const accept = req.headers['accept'] || '';
  if (!accept.includes('text/html') && accept !== '*/*' && accept !== '') return next();
  if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next();

  const { locale, rest } = extractLocale(req.path);
  const route = (rest === '' ? '/' : rest).replace(/\/+$/, '') || '/';

  const detail = extractDetail(route);

  let title, description, ogImage;
  let schemas = [];
  let detailRow = null;

  if (detail) {
    // ── Detail page (news article / product / project) ─────────────────
    detailRow = await fetchDetailRow(detail);
    if (!detailRow) {
      // Not found — fall back to section defaults so the SPA can render
      // its own 404 and we still serve *something* sensible to crawlers.
      const sectionKey = detail.section === 'shop' ? 'shop'
                       : detail.section === 'news' ? 'news'
                       : 'projects';
      const d = (DEFAULT_META[locale] || DEFAULT_META[DEFAULT_LOCALE])[sectionKey];
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
        schemas.push(breadcrumbSchema({ section: 'projects', detailName: title, localePath: `/projects/${detailRow.id}`, locale }));
      }
    }
  } else {
    // ── List / static page ──────────────────────────────────────────────
    const meta = ROUTE_META[route] || null;
    const key  = meta?.key;
    const defaults = (DEFAULT_META[locale] || DEFAULT_META[DEFAULT_LOCALE])[key] || {};
    const override = meta?.contentKey ? await fetchContentMeta(meta.contentKey, locale) : null;

    title       = override?.title       || defaults.title       || DEFAULT_META[DEFAULT_LOCALE].home.title;
    description = override?.description || defaults.description || DEFAULT_META[DEFAULT_LOCALE].home.description;
    ogImage     = `${APP_URL}${OG_IMAGE_PATH}`;

    // Breadcrumbs on any non-home page.
    if (route !== '/') {
      let section = null;
      if (route === '/projects' || route === '/news' || route === '/shop') {
        section = route.slice(1);
      }
      const bc = breadcrumbSchema({
        section,
        detailName: section ? null : title,
        localePath: route,
        locale,
      });
      if (bc) schemas.push(bc);
    }
  }

  const canonical = `${APP_URL}${req.path}`;
  const hreflang  = {
    en:           `${APP_URL}/en${route === '/' ? '/' : route}`,
    is:           `${APP_URL}/is${route === '/' ? '/' : route}`,
    'x-default':  `${APP_URL}${route === '/' ? '/' : route}`,
  };
  const ogLocale = locale === 'is' ? 'is_IS' : 'en_IS';

  const jsonLdHtml = jsonLdScript(schemas);

  // Crawler body content — lists (/news, /shop, /projects) and all
  // detail pages. Static pages (home, halli, contact, privacy, terms)
  // rely on the SPA; their content is small enough that Google's JS
  // renderer handles it and social scrapers can read the <head> alone.
  let crawlerHtml = '';
  if (detail) {
    if (detailRow) crawlerHtml = crawlerDetailHtml(detail.type, detailRow, locale);
  } else if (route === '/news' || route === '/shop' || route === '/projects') {
    const section = route.slice(1);
    const rows    = await fetchListRows(section, 10);
    if (rows.length) crawlerHtml = crawlerListHtml(section, rows, locale);
  }

  let html = rewriteHead(loadTemplate(), {
    title, description, canonical, hreflang, ogLocale, ogImage,
    jsonLd: jsonLdHtml,
  });
  html = injectCrawlerContent(html, crawlerHtml);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.setHeader('Vary', 'Accept-Language, Cookie');
  res.send(html);
};
