// Route → document.title for SPA navigation.
//
// server/middleware/ssrMeta.js rewrites <title> per URL, but that only runs on a
// full page load. Client-side navigation never touched document.title at all, so
// the tab kept the landing page's title for the whole session: every admin
// screen, every article, every checkout step read "Orange Smiley — hugbúnaðarhús
// knúið gervigreind". Crawlers and social unfurls always get the SSR title, so
// this is purely human-facing — tab labels, bookmark names, browser history.
//
// ⚠ PUBLIC page parts below are copied VERBATIM from DEFAULT_META in
// server/middleware/ssrMeta.js, routed by the same patterns as its ROUTE_META,
// and composed the same way (server/config/identity.js composeTitle): a part
// carrying `{brand}` is substituted, a `TITLE_MODE` of 'bare' is used as
// written, everything else gets identity.brand.titleSuffix. The brand and the
// suffix come from utils/identity.js (the product's config/client.json), so a
// downstream never edits this file. A direct load of /thjonusta and a
// client-side navigation to it must not title the tab differently.
// tests/unit/pageTitle.test.js reads that server file and fails on any drift,
// so this comment is enforced rather than hopeful.
//
// Admin and account routes have no SSR titles at all (they are noindex), so
// those strings live only here.
//
// A detail view that knows its own subject — an article, an invoice, a customer
// account — should set `view.documentTitle` instead of adding a pattern here.
// The router prefers that whenever it is a non-empty string.

import { getIdentity } from './identity.js';

// Route pattern (as ROUTES in router.js declares it) → page part per locale.
const PUBLIC_TITLES = {
  '/':              { en: '{brand} — AI-driven software company', is: '{brand} — hugbúnaðarhús knúið gervigreind' },
  '/thjonusta':     { en: 'Services',                             is: 'Þjónusta' },
  '/um-okkur':      { en: 'About us',                             is: 'Um okkur' },
  '/hafa-samband':  { en: 'Contact',                              is: 'Hafa samband' },
  '/personuvernd':  { en: 'Privacy Policy',                       is: 'Persónuverndarstefna' },
  // Hidden-but-functional surfaces (server/config/publicSurface.js).
  '/verkefni':      { en: 'Our work',                             is: 'Verkefnin okkar' },
  '/projects':      { en: 'Our work',                             is: 'Verkefnin okkar' },
  '/contact':       { en: 'Contact',                              is: 'Hafa samband' },
  '/privacy':       { en: 'Privacy Policy',                       is: 'Persónuverndarstefna' },
  '/terms':         { en: 'Terms of Service',                     is: 'Notkunarskilmálar' },
  // The portfolio surfaces keep their own full titles ("Halli Smiley" is the
  // base's, by design) — TITLE_MODE marks them bare, like the server does.
  '/halli':         { en: 'About Halli — Where Wood Meets Code',  is: 'Um Halla — Þar sem viður mætir kóða' },
  '/about':         { en: 'About Halli — Where Wood Meets Code',  is: 'Um Halla — Þar sem viður mætir kóða' },
  '/shop':          { en: 'Shop — Halli Smiley',                  is: 'Verslun — Halli Smiley' },
  '/news':          { en: 'News — Halli Smiley',                  is: 'Fréttir — Halli Smiley' },
  '/party':         { en: "Halli's 40th Birthday Party",          is: '40 ára afmæli Halla' },
  '/aron13ara':     { en: 'Til hamingju með 13 ára afmælið, Aron!', is: 'Til hamingju með 13 ára afmælið, Aron!' }, // hallismiley hook (engine-graft)
};

// Routes whose part IS the whole title (ssrMeta's `titleMode: 'bare'`).
const TITLE_MODE = {
  '/halli': 'bare',
  '/about': 'bare',
  '/shop':  'bare',
  '/news':  'bare',
  '/party': 'bare',
  '/aron13ara': 'bare', // hallismiley hook (engine-graft)
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
 * @param {string} locale  'en' | 'is'
 * @returns {string}
 */
export function titleForRoute(pattern, locale) {
  const lc = locale === 'is' ? 'is' : 'en';
  const site = getIdentity().brand.name;
  const key = INHERITS[pattern] || pattern;

  const part = PUBLIC_TITLES[key];
  if (part) return composeTitle(part[lc], TITLE_MODE[key]);

  const section = SECTIONS[key];
  if (section) return composeTitle(section[lc]);

  if (typeof key === 'string' && key.startsWith('/admin')) {
    return composeTitle(ADMIN[lc]);
  }

  return site;
}

// Exported for the parity test, which walks these against the server's tables.
export const __tables = { PUBLIC_TITLES, TITLE_MODE, INHERITS, SECTIONS, ADMIN };
