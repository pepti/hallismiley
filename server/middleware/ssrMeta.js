'use strict';
/*
 * SSR meta-tag injection for the SPA catch-all route.
 *
 * We don't server-render the <body> (it's a vanilla JS SPA that hydrates
 * client-side). What we DO render is the <head>: <title>, <meta name=
 * "description">, <link rel="canonical">, <link rel="alternate" hreflang>,
 * and the og:* set — all filled in per-route and per-locale from the
 * ROUTE_META table below and live site_content rows for content-driven pages.
 *
 * Scale design:
 *   • Template is read once from disk at boot (cached) — no fs.readFile per
 *     request.
 *   • Per-route metadata is static; only the 3 content-driven pages (home,
 *     halli, contact) hit the DB, and only for a 1-column projection.
 *   • Responses are tagged with  Cache-Control: public, max-age=300,
 *     stale-while-revalidate=60  so a CDN sitting in front can coalesce
 *     bot traffic without touching Node.
 *   • Unknown routes fall through to the generic meta — no 404 in the HTML
 *     (the SPA still handles the actual 404 render).
 *
 * Google indexes JS-rendered content, but Bing / Facebook / LinkedIn / X
 * crawlers don't always execute JS reliably — the head must carry the
 * truth so preview cards and search snippets render regardless.
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
// In dev, invalidate on file change so edits to index.html don't require restart.
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

// Fallback strings per (route key, locale). Kept small on purpose: real
// content lives in site_content / product / article rows.
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

// Parse the first path segment as a locale, or return DEFAULT_LOCALE.
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

// Look up admin-editable meta overrides on a site_content row. Admins add
// `meta_title` / `meta_description` keys to the JSONB blob — we surface them
// if present, fall back to DEFAULT_META otherwise. Single-row lookup with a
// locale filter; safe for the catch-all's request path.
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
    return {
      title:       v.meta_title,
      description: v.meta_description,
    };
  } catch {
    return null;
  }
}

// Replace the tag with matching id, preserving all attributes not in patch.
function replaceById(html, id, attrs, innerText) {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');
  // Match the full self-closing or paired element with this id.
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

// Single-use tag replacers — less brittle than regex-hunting for each
// attribute combination. The index.html baseline uses id= attributes on the
// tags we need to control.
function rewriteHead(html, { title, description, canonical, hreflang, ogLocale, ogImage }) {
  // <title id="ssr-title"> — add if absent, replace if present.
  if (/<title\b/i.test(html)) {
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title id="ssr-title">${esc(title)}</title>`);
  }

  // <meta name="description" …>
  html = html.replace(
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${esc(description)}" id="ssr-description" />`
  );

  // og:title / og:description / og:url / og:locale / og:image
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

  // Canonical + hreflang triple (replace-by-id).
  html = replaceById(html, 'ssr-canonical',        { rel: 'canonical', href: canonical });
  html = replaceById(html, 'ssr-hreflang-en',      { rel: 'alternate', hreflang: 'en',        href: hreflang.en });
  html = replaceById(html, 'ssr-hreflang-is',      { rel: 'alternate', hreflang: 'is',        href: hreflang.is });
  html = replaceById(html, 'ssr-hreflang-default', { rel: 'alternate', hreflang: 'x-default', href: hreflang['x-default'] });

  // <html lang="...">
  html = html.replace(/<html\b[^>]*\blang="[^"]*"/i, `<html lang="${esc(ogLocale.split('_')[0])}"`);

  return html;
}

/**
 * Express middleware — serves index.html with filled-in <head> for any
 * SPA route that reaches it. Mount AFTER static assets + API routes so we
 * only handle URLs that aren't files or data endpoints.
 */
module.exports = async function ssrMetaMiddleware(req, res, next) {
  // Only GET requests for HTML (bots + humans). Skip data endpoints.
  if (req.method !== 'GET') return next();
  const accept = req.headers['accept'] || '';
  if (!accept.includes('text/html') && accept !== '*/*' && accept !== '') return next();

  // Skip anything that looks like a file (has an extension) — those should
  // have been caught by the static middleware upstream; a miss = 404.
  if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next();

  const { locale, rest } = extractLocale(req.path);
  // Normalise the rest so '/', '/en', '/en/' all land on '/'.
  const route = (rest === '' ? '/' : rest).replace(/\/+$/, '') || '/';

  // Find the route meta entry (exact match or fall back to generic).
  const meta = ROUTE_META[route] || null;
  const key  = meta?.key;
  const defaults = (DEFAULT_META[locale] || DEFAULT_META[DEFAULT_LOCALE])[key] || {};

  // Admin-editable overrides for content-driven pages.
  const override = meta?.contentKey ? await fetchContentMeta(meta.contentKey, locale) : null;

  const title       = override?.title       || defaults.title       || DEFAULT_META[DEFAULT_LOCALE].home.title;
  const description = override?.description || defaults.description || DEFAULT_META[DEFAULT_LOCALE].home.description;

  const canonical = `${APP_URL}${req.path}`;
  const hreflang  = {
    en:           `${APP_URL}/en${route === '/' ? '/' : route}`,
    is:           `${APP_URL}/is${route === '/' ? '/' : route}`,
    'x-default':  `${APP_URL}${route === '/' ? '/' : route}`,
  };
  const ogLocale = locale === 'is' ? 'is_IS' : 'en_IS';
  const ogImage  = `${APP_URL}${OG_IMAGE_PATH}`;

  const html = rewriteHead(loadTemplate(), {
    title, description, canonical, hreflang, ogLocale, ogImage,
  });

  // CDN-friendly: same path + locale = same HTML (until admin edits meta or
  // code redeploys). 5 min fresh + 1 min SWR is plenty for meta copy.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.setHeader('Vary', 'Accept-Language, Cookie');
  res.send(html);
};
