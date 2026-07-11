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
const { DEFAULT_LOCALE, SUPPORTED_LOCALES, isPartyPath } = require('../config/i18n');

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
//
// /shop/products, /shop/tech, /shop/carpentry are department sub-routes
// added in shop-redesign step 2. They share the shop_hero content key for
// admin-editable copy fallback but have their own DEFAULT_META titles so
// each section is independently SEO-indexable.
const ROUTE_META = {
  '/':                 { key: 'home',           contentKey: 'home_skills' },
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

const DEFAULT_META = {
  en: {
    home:           { title: 'Halli Smiley — Icelandic Carpenter & Computer Scientist', description: 'Portfolio of Halli, an Icelandic carpenter and computer scientist. Twenty years of precision joinery and timber framing combined with full-stack web development.' },
    projects:       { title: 'Projects — Halli Smiley', description: 'Selected carpentry and software projects by Halli — hand-cut joinery, timber frames, custom web apps.' },
    halli:          { title: 'About Halli — Where Wood Meets Code', description: 'The long-form story of Halli: an Icelandic craftsman who moves between wood and software with the same discipline and care.' },
    shop:           { title: 'Shop — Halli Smiley', description: 'Apparel, goods, and services from the workshop. Prices include 24% VAT, shipping from Iceland.' },
    shopProducts:   { title: 'Products — Halli Smiley Shop', description: 'Physical goods from the workshop: apparel and accessories. Prices include 24% VAT, shipping from Iceland.' },
    shopTech:       { title: 'Tech Services — Work with Halli', description: 'Technical advisement, AI teaching sessions, and lectures by Halli. Book a session through the shop.' },
    shopCarpentry:  { title: 'Carpentry Services — Work with Halli', description: 'Carpentry advisement and commissioned work — including TV wall artwork. Book a session through the shop.' },
    news:           { title: 'News — Halli Smiley', description: 'Updates from the workshop, notes on projects in progress, and occasional writing on the craft-code overlap.' },
    contact:        { title: 'Contact — Halli Smiley', description: 'Reach Halli about carpentry commissions, software work, or anything at the intersection of the two.' },
    privacy:        { title: 'Privacy Policy — Halli Smiley' },
    terms:          { title: 'Terms of Service — Halli Smiley' },
    party:          { title: "Halli's 40th Birthday Party", description: "You're invited to Halli's 40th birthday — July 25, Mýrarkot & SPA. Tap here to see the schedule and RSVP." },
  },
  is: {
    home:           { title: 'Halli Smiley — Íslenskur smiður & tölvunarfræðingur', description: 'Verkefnasafn Halla, íslensks smiðs og tölvunarfræðings. Tuttugu ára nákvæmni í smíði og grindarsmíði sem sameinast fullgildri vefforritun.' },
    projects:       { title: 'Verkefni — Halli Smiley', description: 'Valin smíða- og hugbúnaðarverkefni Halla — handskornar fellingar, burðargrindur, sérsmíðuð vefforrit.' },
    halli:          { title: 'Um Halla — Þar sem viður mætir kóða', description: 'Löng saga Halla: íslenskur handverksmaður sem flakkar á milli viðar og hugbúnaðar með sama aga og umhyggju.' },
    shop:           { title: 'Verslun — Halli Smiley', description: 'Fatnaður, varningur og þjónusta úr verkstæðinu. Verð með 24% VSK, sent frá Íslandi.' },
    shopProducts:   { title: 'Vörur — Verslun Halla Smiley', description: 'Áþreifanlegar vörur úr verkstæðinu: fatnaður og fylgihlutir. Verð með 24% VSK, sent frá Íslandi.' },
    shopTech:       { title: 'Tækniþjónusta — Vinnuðu með Halla', description: 'Tækniráðgjöf, AI-kennsla og fyrirlestrar hjá Halla. Bókaðu tíma í gegnum verslunina.' },
    shopCarpentry:  { title: 'Smíðaþjónusta — Vinnuðu með Halla', description: 'Smíðaráðgjöf og sérsmíði — þar á meðal sjónvarpsveggir. Bókaðu tíma í gegnum verslunina.' },
    news:           { title: 'Fréttir — Halli Smiley', description: 'Fréttir úr verkstæðinu, glósur um verkefni í vinnslu og stöku skrif um handverk og forritun.' },
    contact:        { title: 'Samband — Halli Smiley', description: 'Hafðu samband við Halla um smíðaverkefni, hugbúnaðarverkefni eða eitthvað þar á milli.' },
    privacy:        { title: 'Persónuverndarstefna — Halli Smiley' },
    terms:          { title: 'Notkunarskilmálar — Halli Smiley' },
    party:          { title: '40 ára afmæli Halla', description: 'Þér er boðið í 40 ára afmæli Halla - 25 Julí, Mýrakot og Spa. Smelltu hér til að sjá dagskrá og skrá mætingu.' },
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

function extractLocale(req) {
  const pathname = req.path || '/';
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) {
    return { locale: parts[0], rest: '/' + parts.slice(1).join('/') || '/' };
  }
  // No URL locale prefix. For party paths, defer to the locale middleware's
  // resolution (cookie → user-pref → party-default 'is' → Accept-Language)
  // so an EN-cookie user doesn't see SSR render IS before the SPA flips to EN.
  // Other unprefixed paths keep the historic DEFAULT_LOCALE fallback so SEO
  // for /, /projects, etc. stays unchanged.
  if (isPartyPath(pathname)) {
    const resolved = req.locale && SUPPORTED_LOCALES.includes(req.locale) ? req.locale : null;
    return { locale: resolved || DEFAULT_LOCALE, rest: pathname };
  }
  return { locale: DEFAULT_LOCALE, rest: pathname };
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

function websiteSchema() {
  // Emitted only on the home page. The alternateName array binds branded
  // search variants (one-word "Hallismiley", spaced "Halli Smiley") to the
  // site so Bing's knowledge graph treats them as the same entity. The
  // publisher reference resolves to the Person schema baked into
  // public/index.html (same @id).
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id':  `${APP_URL}/#website`,
    url:    APP_URL,
    name:   'Halli Smiley',
    alternateName: ['Hallismiley', 'Halli', 'halli smiley'],
    inLanguage: ['en', 'is'],
    publisher: { '@id': `${APP_URL}/#person` },
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
  const defaults = (DEFAULT_META[locale] || DEFAULT_META[DEFAULT_LOCALE]).home;

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

  // Featured projects — top 3 with anchor links into /<locale>/projects/<id>.
  if (Array.isArray(projectRows) && projectRows.length) {
    const sectionHeading = locale === 'is' ? 'Valin verkefni' : 'Featured projects';
    const li = projectRows.map(row => {
      const title = pickLocale(row, 'title', 'title_is', locale);
      const desc  = pickLocale(row, 'description', 'description_is', locale);
      const href  = `/${locale}/projects/${row.id}`;
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

function rewriteHead(html, { title, description, canonical, hreflang, ogLocale, ogImage, jsonLd }) {
  if (/<title\b/i.test(html)) {
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title id="ssr-title">${esc(title)}</title>`);
  }
  html = html.replace(
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${esc(description)}" id="ssr-description" />`
  );
  // App environment for the client (drives the in-app feedback widget + TEST
  // chrome). Explicit APP_ENV wins; otherwise any non-production NODE_ENV is
  // treated as "test" so the widget is available in dev/staging, hidden in prod.
  const appEnv = process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'test');
  html = html.replace(
    /<meta\s+name="app-env"[^>]*>/i,
    `<meta name="app-env" content="${esc(appEnv)}" id="ssr-app-env" />`
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
      `<meta name="msvalidate.01" content="${esc(bingToken)}" />`
    );
  }
  if (googleToken) {
    html = html.replace(
      /<meta\s+name="google-site-verification"[^>]*>/i,
      `<meta name="google-site-verification" content="${esc(googleToken)}" />`
    );
  }
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

  const { locale, rest } = extractLocale(req);
  const route = (rest === '' ? '/' : rest).replace(/\/+$/, '') || '/';

  // Static + section routes take precedence over detail patterns so that
  // /shop/products etc. don't accidentally match the /shop/:slug product
  // regex (which would try to fetch a product with slug='products').
  const staticMeta = ROUTE_META[route] || null;
  const detail = staticMeta ? null : extractDetail(route);

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
    const meta = staticMeta;
    const key  = meta?.key;
    const defaults = (DEFAULT_META[locale] || DEFAULT_META[DEFAULT_LOCALE])[key] || {};
    // For shop section sub-routes we deliberately do NOT pull meta_title /
    // meta_description from shop_hero — the shared hero copy applies to the
    // landing only. Per-section pages get the DEFAULT_META titles so each
    // route stays independently SEO-indexable.
    const override = (meta?.contentKey && !meta.section) ? await fetchContentMeta(meta.contentKey, locale) : null;

    title       = override?.title       || defaults.title       || DEFAULT_META[DEFAULT_LOCALE].home.title;
    description = override?.description || defaults.description || DEFAULT_META[DEFAULT_LOCALE].home.description;
    ogImage     = `${APP_URL}${OG_IMAGE_PATH}`;

    // Party links share the admin-uploaded cover photo instead of the generic
    // site card. Falls back to OG_IMAGE_PATH above when no cover is uploaded.
    if (key === 'party') {
      const partyOg = await fetchPartyOgImage();
      if (partyOg) ogImage = partyOg;
    }

    // Breadcrumbs on any non-home page.
    if (route !== '/') {
      let section = null;
      let detailName = null;
      if (route === '/projects' || route === '/news' || route === '/shop') {
        section = route.slice(1);
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
      // Home page — emit WebSite schema (alongside the baked Person schema
      // in public/index.html). Binds brand-name variants for knowledge-graph
      // matching on Bing/Google.
      schemas.push(websiteSchema());
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

  // Crawler body content — covers the home page, list pages, and detail
  // pages. Bing and other non-JS crawlers index the initial HTML response,
  // so anything the SPA would render client-side has to be mirrored here.
  // Other static pages (halli, contact, privacy, terms) still rely on the
  // SPA — their <head> meta plus JSON-LD give crawlers enough signal and
  // the content there changes too rarely to be worth pre-rendering.
  let crawlerHtml = '';
  if (detail) {
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
