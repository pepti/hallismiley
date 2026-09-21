// Route → document.title for SPA navigation.
//
// server/middleware/ssrMeta.js rewrites <title> per URL, but that only runs on a
// full page load. Client-side navigation never touched document.title at all, so
// the tab kept the landing page's title for the whole session: every admin
// screen, every article, every checkout step read "Orange Smiley — hugbúnaðarhús
// knúið gervigreind". Crawlers and social unfurls always get the SSR title, so
// this is purely human-facing — tab labels, bookmark names, browser history.
//
// ⚠ PUBLIC titles below are copied VERBATIM from DEFAULT_META in
// server/middleware/ssrMeta.js, routed by the same patterns as its ROUTE_META.
// A direct load of /thjonusta and a client-side navigation to it must not title
// the tab differently. tests/unit/pageTitle.test.js reads that server file and
// fails on any drift, so this comment is enforced rather than hopeful.
//
// Admin and account routes have no SSR titles at all (they are noindex), so
// those strings live only here.
//
// A detail view that knows its own subject — an article, an invoice, a customer
// account — should set `view.documentTitle` instead of adding a pattern here.
// The router prefers that whenever it is a non-empty string.

const SITE = { en: 'Orange Smiley', is: 'Orange Smiley' };

// Route pattern (as ROUTES in router.js declares it) → full title per locale.
const PUBLIC_TITLES = {
  '/':              { en: 'Orange Smiley — AI-driven software company', is: 'Orange Smiley — hugbúnaðarhús knúið gervigreind' },
  '/thjonusta':     { en: 'Services — Orange Smiley',                   is: 'Þjónusta — Orange Smiley' },
  '/um-okkur':      { en: 'About us — Orange Smiley',                   is: 'Um okkur — Orange Smiley' },
  '/hafa-samband':  { en: 'Contact — Orange Smiley',                    is: 'Hafa samband — Orange Smiley' },
  '/personuvernd':  { en: 'Privacy Policy — Orange Smiley',             is: 'Persónuverndarstefna — Orange Smiley' },
  // Hidden-but-functional surfaces (server/config/publicSurface.js). They keep
  // their own titles on purpose — the SSR ones say "Halli Smiley" by design.
  '/verkefni':      { en: 'Our work — Orange Smiley',                   is: 'Verkefnin okkar — Orange Smiley' },
  '/projects':      { en: 'Our work — Orange Smiley',                   is: 'Verkefnin okkar — Orange Smiley' },
  '/contact':       { en: 'Contact — Orange Smiley',                    is: 'Hafa samband — Orange Smiley' },
  '/privacy':       { en: 'Privacy Policy — Orange Smiley',             is: 'Persónuverndarstefna — Orange Smiley' },
  '/terms':         { en: 'Terms of Service — Orange Smiley',           is: 'Notkunarskilmálar — Orange Smiley' },
  '/halli':         { en: 'About Halli — Where Wood Meets Code',        is: 'Um Halla — Þar sem viður mætir kóða' },
  '/about':         { en: 'About Halli — Where Wood Meets Code',        is: 'Um Halla — Þar sem viður mætir kóða' },
  '/shop':          { en: 'Shop — Halli Smiley',                        is: 'Verslun — Halli Smiley' },
  '/news':          { en: 'News — Halli Smiley',                        is: 'Fréttir — Halli Smiley' },
  '/party':         { en: "Halli's 40th Birthday Party",                is: '40 ára afmæli Halla' },
};

// A detail route inherits its list's title until the view supplies its own.
const INHERITS = {
  '/verkefni/:id': '/verkefni',
  '/projects/:id': '/projects',
  '/news/:slug':   '/news',
};

// Client-only sections: no SSR title exists for these, so nothing to mirror.
// `— Orange Smiley` is appended by titleForRoute.
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
 * Build the document title for a route.
 * @param {string} pattern route pattern from the router (or the path itself)
 * @param {string} locale  'en' | 'is'
 * @returns {string}
 */
export function titleForRoute(pattern, locale) {
  const lc = locale === 'is' ? 'is' : 'en';
  const site = SITE[lc];
  const key = INHERITS[pattern] || pattern;

  const full = PUBLIC_TITLES[key];
  if (full) return full[lc];

  const section = SECTIONS[key];
  if (section) return `${section[lc]} — ${site}`;

  if (typeof key === 'string' && key.startsWith('/admin')) {
    return `${ADMIN[lc]} — ${site}`;
  }

  return site;
}

// Exported for the parity test, which walks these against the server's tables.
export const __tables = { SITE, PUBLIC_TITLES, INHERITS, SECTIONS, ADMIN };
