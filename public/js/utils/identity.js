// The product identity on the client — the browser half of the seam that
// server/config/clientConfig.js resolves (`identity.*`, from config/client.json).
//
// ssrMeta.js writes the resolved record into the shell as
//   <script id="identity" type="application/json">{…}</script>
// and this module parses it ONCE. Everything brand-bearing in the SPA reads
// it here: the nav lockup and footer (brand.name), the tab title suffix
// (utils/pageTitle.js), the visitor-default locale (i18n/i18n.js), the theme
// trio (services/themePrefs.js), the hero clip (views/HomeView.js) and the
// hidden admin views (components/adminSurface.js). theme-boot.js is the one
// reader that cannot import this — it runs before first paint — so it takes
// the theme trio from the <html data-*-theme> attributes instead.
//
// IDENTITY_DEFAULTS mirror the schema defaults on the server (Orange Smiley's
// values) so a shell served without SSR, or a module loaded in the node test
// environment, behaves exactly as the engine did before the seam existed.
// tests/unit/identityConfig.test.js pins the two copies equal.

export const IDENTITY_DEFAULTS = Object.freeze({
  brand: Object.freeze({
    name: 'Orange Smiley',
    legalName: 'Orange Smiley ehf.',
    alternateNames: Object.freeze(['Orangesmiley', 'Orange Smiley ehf.', 'orange smiley', 'Rekstrarkerfið', 'Rekstrarkerfi']),
    titleSuffix: ' — Orange Smiley',
  }),
  locale: Object.freeze({ publicDefault: 'is' }),
  theme: Object.freeze({
    default: 'ember',
    root: 'classic',
    picker: Object.freeze(['ember', 'classic', 'midnight']),
    dark: Object.freeze(['ember', 'midnight']),
  }),
  hero: Object.freeze({
    clip: '/assets/videos/hero-dc7df-v2.mp4',
    poster: '/assets/videos/hero-dc7df-v2-poster.jpg',
  }),
  surface: Object.freeze({
    nav: Object.freeze([
      Object.freeze({ route: '/thjonusta',    labelKey: 'nav.thjonusta' }),
      Object.freeze({ route: '/um-okkur',     labelKey: 'nav.umOkkur' }),
      Object.freeze({ route: '/hafa-samband', labelKey: 'nav.hafaSamband' }),
    ]),
    hiddenRoutes: Object.freeze(['/party', '/halli', '/about', '/news', '/shop', '/projects', '/contact', '/privacy', '/verkefni']),
    hiddenAdminViews: Object.freeze(['products', 'collections', 'bins', 'orders', 'discounts', 'sales', 'pos', 'background']),
  }),
  organization: Object.freeze({
    email: 'info@orangesmiley.is',
    description: 'Icelandic software company building and operating websites, online stores and business systems for small and medium businesses — one platform, one monthly subscription.',
    logo: '/favicon.svg',
    image: '/og-image.jpg',
    addressLocality: 'Hafnarfjörður',
    addressCountry: 'IS',
    areaServed: 'Iceland',
    knowsAbout: Object.freeze(['Web Development', 'E-commerce', 'Inventory Management', 'Invoicing', 'VAT Accounting', 'Shopify Migration', 'Node.js', 'PostgreSQL']),
    sameAs: Object.freeze([]),
  }),
});

// A list default is either a list of strings or a list of records whose
// string fields the first default record names (the nav entries). A given
// list is taken whole only when every item fits; otherwise the default holds.
function listFits(def, v) {
  if (!Array.isArray(v)) return false;
  const shape = def.find((d) => d && typeof d === 'object');
  if (!shape) return v.every((s) => typeof s === 'string');
  const fields = Object.keys(shape);
  return v.every((item) => item && typeof item === 'object' && fields.every((f) => typeof item[f] === 'string'));
}
function copyList(def, v) {
  const shape = def.find((d) => d && typeof d === 'object');
  if (!shape) return v.slice();
  const fields = Object.keys(shape);
  return v.map((item) => Object.fromEntries(fields.map((f) => [f, item[f]])));
}

/**
 * Merge a parsed hand-off over the defaults. Only keys the defaults know are
 * taken, each checked against the default's type (a string stays a string, a
 * list stays a list of strings — or of records with the default's string
 * fields), so a malformed tag can never leave a field undefined for a reader.
 * Pure; exported for the tests.
 */
export function resolveIdentity(raw) {
  const out = {};
  for (const [section, defaults] of Object.entries(IDENTITY_DEFAULTS)) {
    const given = raw && typeof raw === 'object' && raw[section] && typeof raw[section] === 'object' ? raw[section] : {};
    const merged = {};
    for (const [key, def] of Object.entries(defaults)) {
      const v = given[key];
      if (Array.isArray(def)) {
        merged[key] = listFits(def, v) ? copyList(def, v) : copyList(def, def);
      } else {
        merged[key] = typeof v === typeof def ? v : def;
      }
    }
    out[section] = merged;
  }
  return out;
}

/**
 * Is `route` (locale-stripped) off the product's discovery surfaces? The
 * client twin of server/config/publicSurface.js isHiddenRoute: prefix-aware,
 * '/news' hides '/news/<slug>'. Pure; `id` defaults to the served identity.
 */
export function isHiddenRoute(route, id = getIdentity()) {
  if (!route) return false;
  return id.surface.hiddenRoutes.some((base) => route === base || route.startsWith(base + '/'));
}

/**
 * The public IA in order — `identity.surface.nav` minus the hidden routes —
 * for the top nav and both footers (NavBar.js, HomeView.js, ContactView.js).
 * Never includes '/': the lockup and the first link are always home. The
 * server derives the sitemap from the same rule (publicSurface.js PUBLIC_NAV).
 */
export function publicNav(id = getIdentity()) {
  return id.surface.nav.filter((e) => !isHiddenRoute(e.route, id));
}

let _identity = null;

/** The identity this page was served with (falls back to the defaults). */
export function getIdentity() {
  if (_identity) return _identity;
  let raw = null;
  try {
    const el = typeof document !== 'undefined' && typeof document.getElementById === 'function'
      ? document.getElementById('identity')
      : null;
    if (el && el.textContent) raw = JSON.parse(el.textContent);
  } catch {
    raw = null; // a malformed tag reads as "no tag": the defaults apply
  }
  _identity = resolveIdentity(raw);
  try {
    // A window-level copy for the e2e suite and for anyone debugging a page.
    if (typeof window !== 'undefined') window.__identity = _identity;
  } catch { /* not a browser */ }
  return _identity;
}
