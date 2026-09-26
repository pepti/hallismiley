// Route → document.title for SPA navigation.
//
// server/middleware/ssrMeta.js rewrites <title> per URL, but that only runs on a
// full page load. Client-side navigation never touched document.title at all, so
// the tab kept the landing page's title for the whole session: every admin
// screen, every article, every checkout step read "Orange Smiley — hugbúnaðarhús
// knúið gervigreind". Crawlers and social unfurls always get the SSR title, so
// this is purely human-facing — tab labels, bookmark names, browser history.
//
// ⚠ PUBLIC page parts are i18n KEYS (`meta.<key>.title`, identity-seam-2,
// 2026-09-23) — the same keys DEFAULT_META in server/middleware/ssrMeta.js
// names, routed by the same patterns as its ROUTE_META, and composed the same
// way (server/config/identity.js composeTitle): a part carrying `{brand}` is
// substituted, a `TITLE_MODE` of 'bare' is used as written, everything else
// gets identity.brand.titleSuffix. The text lives in public/js/i18n/<locale>.json
// (engine) and product.<locale>.json (a product's override), the brand and the
// suffix in utils/identity.js (the product's config/client.json), so a
// downstream never edits this file. A product's OWN routes (`identity.routes`,
// identity-seam-3 — a route the engine does not know, or one it re-describes)
// are read from the hand-off in titleForRoute and win over the table below,
// exactly as ssrMeta merges them over its tables. A direct load of /thjonusta
// and a client-side navigation to it must not title the tab differently:
// tests/unit/pageTitle.test.js reads the server file and both tables and
// fails on any drift, so this comment is enforced rather than hopeful.
//
// The public parts read the ACTIVE message table (t()) — the router calls
// titleForRoute after loadLocale, so that is the locale it passes. Admin and
// account routes have no SSR titles at all (they are noindex), so those
// strings live only here.
//
// A detail view that knows its own subject — an article, an invoice, a customer
// account — should set `view.documentTitle` instead of adding a pattern here.
// The router prefers that whenever it is a non-empty string.

import { getIdentity, routeMeta } from './identity.js';
import { t } from '../i18n/i18n.js';

// Route pattern (as ROUTES in router.js declares it) → the i18n key of its
// page part.
const PUBLIC_TITLES = {
  '/':              'meta.home.title',
  '/thjonusta':     'meta.thjonusta.title',
  '/um-okkur':      'meta.umOkkur.title',
  '/hafa-samband':  'meta.contact.title',
  '/personuvernd':  'meta.privacy.title',
  // Hidden-but-functional surfaces (server/config/publicSurface.js).
  '/verkefni':      'meta.projects.title',
  '/projects':      'meta.projects.title',
  '/contact':       'meta.contact.title',
  '/privacy':       'meta.privacy.title',
  '/terms':         'meta.terms.title',
  // The portfolio surfaces keep their own full titles ("Halli Smiley" is the
  // base's, by design) — TITLE_MODE marks them bare, like the server does.
  '/halli':         'meta.halli.title',
  '/about':         'meta.halli.title',
  '/shop':          'meta.shop.title',
  '/news':          'meta.news.title',
  '/party':         'meta.party.title',
};

// Routes whose part IS the whole title (ssrMeta's `titleMode: 'bare'`).
const TITLE_MODE = {
  '/halli': 'bare',
  '/about': 'bare',
  '/shop':  'bare',
  '/news':  'bare',
  '/party': 'bare',
};

// A detail route inherits its list's title until the view supplies its own.
const INHERITS = {
  '/verkefni/:id': '/verkefni',
  '/projects/:id': '/projects',
  '/news/:slug':   '/news',
};

// Client-only sections: no SSR title exists for these, so nothing to mirror.
// The brand suffix is appended by titleForRoute.
const SECTIONS = {
  '/cart':     { en: 'Cart',            is: 'Karfa' },
  '/checkout': { en: 'Checkout',        is: 'Ganga frá pöntun' },
  '/orders':   { en: 'Order history',   is: 'Pantanir' },
  '/profile':  { en: 'Account',         is: 'Aðgangur' },
  '/solusvaedi': { en: 'Seller area',   is: 'Sölusvæði' },
  '/signup':   { en: 'Create an account', is: 'Stofna aðgang' },
  '/login':    { en: 'Sign in',         is: 'Innskráning' },
};

// Every /admin/* route shares one label rather than enumerating ~40 patterns:
// the admin shell already says where you are, and the tab only needs to name
// which app it is. Nothing under /admin is indexed, so there is no SEO cost.
const ADMIN = { en: 'Admin', is: 'Stjórnborð' };

/**
 * Compose a title from a page part — the client twin of composeTitle in
 * server/config/identity.js. Exported so the parity test can hold the two
 * together.
 * @param {string} part
 * @param {string} [mode] 'bare' to use the part as written
 * @returns {string}
 */
export function composeTitle(part, mode) {
  const { brand } = getIdentity();
  const s = String(part ?? '');
  if (mode === 'bare') return s;
  if (s.includes('{brand}')) return s.split('{brand}').join(brand.name);
  return s + brand.titleSuffix;
}

/**
 * Build the document title for a route.
 * @param {string} pattern route pattern from the router (or the path itself)
 * @param {string} locale  'en' | 'is' — the active locale (public parts are
 *                         read from the active message table)
 * @returns {string}
 */
export function titleForRoute(pattern, locale) {
  const lc = locale === 'is' ? 'is' : 'en';
  const site = getIdentity().brand.name;
  const key = INHERITS[pattern] || pattern;

  // The product's OWN routes (identity.routes, identity-seam-3) win over the
  // engine table for the same route — the same merge ssrMeta.js makes over
  // ROUTE_META/DEFAULT_META, so a load and a click still agree.
  const product = routeMeta(key);
  if (product) return composeTitle(t(product.titleKey), product.titleMode === 'bare' ? 'bare' : undefined);

  const titleKey = PUBLIC_TITLES[key];
  if (titleKey) return composeTitle(t(titleKey), TITLE_MODE[key]);

  const section = SECTIONS[key];
  if (section) return composeTitle(section[lc]);

  if (typeof key === 'string' && key.startsWith('/admin')) {
    return composeTitle(ADMIN[lc]);
  }

  return site;
}

/**
 * The title an admin detail view owns (`view.documentTitle`): its own subject
 * first, so a narrow tab still tells two admin tabs apart, then the shared
 * "Admin — site" title every other /admin route carries. Ported from
 * icelandicstore #324 (8e977ae).
 * @param {string} label  already-translated subject, e.g. "Order OS-1042"
 * @param {string} locale 'en' | 'is'
 * @returns {string}
 */
export function adminPageTitle(label, locale) {
  const base = titleForRoute('/admin', locale);
  return label ? `${label} — ${base}` : base;
}

// Exported for the parity test, which walks these against the server's tables.
export const __tables = { PUBLIC_TITLES, TITLE_MODE, INHERITS, SECTIONS, ADMIN };
