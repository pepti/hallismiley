// Route → document.title for SPA navigation.
//
// server/middleware/ssrMeta.js rewrites <title> per URL, but that only runs on a
// full page load. Client-side navigation never touched document.title at all, so
// the tab kept the landing page's title for the whole session — every admin
// screen, every article, every checkout step read "Halli Smiley — Icelandic
// Carpenter & Computer Scientist". Crawlers and social unfurls always get the
// SSR title, so this is purely human-facing — tab labels, bookmark names,
// browser history.
//
// ⚠ PUBLIC titles below are copied VERBATIM from DEFAULT_META in
// server/middleware/ssrMeta.js, routed by the same patterns as its ROUTE_META.
// A direct load of /shop and a client-side navigation to it must not title the
// tab differently. tests/unit/pageTitle.test.js reads that server file and fails
// on any drift, so this comment is enforced rather than hopeful.
//
// Admin and account routes have no SSR titles at all (they are noindex), so
// those strings live only here.
//
// A detail view that knows its own subject — an article, a product, an invoice —
// should set `view.documentTitle` instead of adding a pattern here. The router
// prefers that whenever it is a non-empty string.
//
// An instance re-skinned from this base must re-point SITE and PUBLIC_TITLES at
// its own copy, exactly as it re-points ssrMeta's DEFAULT_META. The parity test
// is what makes that a build failure rather than a silent inconsistency.

const SITE = { en: 'Halli Smiley', is: 'Halli Smiley' };

// Route pattern (as ROUTES in router.js declares it) → full title per locale.
const PUBLIC_TITLES = {
  '/':                { en: 'Halli Smiley — Icelandic Carpenter & Computer Scientist', is: 'Halli Smiley — Íslenskur smiður & tölvunarfræðingur' },
  '/projects':        { en: 'Projects — Halli Smiley',            is: 'Verkefni — Halli Smiley' },
  '/halli':           { en: 'About Halli — Where Wood Meets Code', is: 'Um Halla — Þar sem viður mætir kóða' },
  '/about':           { en: 'About Halli — Where Wood Meets Code', is: 'Um Halla — Þar sem viður mætir kóða' },
  '/shop':            { en: 'Shop — Halli Smiley',                is: 'Verslun — Halli Smiley' },
  '/shop/products':   { en: 'Products — Halli Smiley Shop',       is: 'Vörur — Verslun Halla Smiley' },
  '/shop/tech':       { en: 'Tech Services — Work with Halli',    is: 'Tækniþjónusta — Vinnuðu með Halla' },
  '/shop/carpentry':  { en: 'Carpentry Services — Work with Halli', is: 'Smíðaþjónusta — Vinnuðu með Halla' },
  '/news':            { en: 'News — Halli Smiley',                is: 'Fréttir — Halli Smiley' },
  '/contact':         { en: 'Contact — Halli Smiley',             is: 'Samband — Halli Smiley' },
  '/privacy':         { en: 'Privacy Policy — Halli Smiley',      is: 'Persónuverndarstefna — Halli Smiley' },
  '/terms':           { en: 'Terms of Service — Halli Smiley',    is: 'Notkunarskilmálar — Halli Smiley' },
  '/party':           { en: "Halli's 40th Birthday Party",        is: '40 ára afmæli Halla' },
  '/aron13ara':       { en: 'Til hamingju með 13 ára afmælið, Aron!', is: 'Til hamingju með 13 ára afmælið, Aron!' },
};

// A detail route inherits its list's title until the view supplies its own.
const INHERITS = {
  '/projects/:id':  '/projects',
  '/news/:slug':    '/news',
  '/shop/:slug':    '/shop',
};

// Client-only sections: no SSR title exists for these, so nothing to mirror.
// `— Halli Smiley` is appended by titleForRoute.
const SECTIONS = {
  '/cart':     { en: 'Cart',              is: 'Karfa' },
  '/checkout': { en: 'Checkout',          is: 'Ganga frá pöntun' },
  '/orders':   { en: 'Order history',     is: 'Pantanir' },
  '/profile':  { en: 'Account',           is: 'Aðgangur' },
  '/signup':   { en: 'Create an account', is: 'Stofna aðgang' },
  '/login':    { en: 'Sign in',           is: 'Innskráning' },
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
