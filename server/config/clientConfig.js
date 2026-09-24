'use strict';

// ── Per-instance client configuration ────────────────────────────────────────
//
// One engine, many instances (ORANGE-SMILEY-PLAN §4). Everything that differs
// between deployments of this codebase — which modules an instance exposes and
// how each behaves — is declared here, resolved once at boot, deep-frozen, and
// read from a single place. This is the seam every future module flag uses;
// `publicSurface.js` is its hand-rolled ancestor.
//
// Precedence (lowest → highest):
//   1. SCHEMA defaults below       — always safe, always complete
//   2. config/client.json          — committed, per-instance
//   3. CLIENT_CONFIG_* env vars    — per-deployment override (App Service app
//                                    settings, CI, a local .env)
//
// Rules of the road:
//   • NO SECRETS. This config is pino-logged in full at boot and is destined
//     for a committed JSON file. Secrets are env vars read where they are used
//     (see SECRET_KEY_RE below — it fails loudly if a secret-shaped key is ever
//     added to the schema).
//   • Unknown keys warn and are ignored; they never crash the boot. A corrupt
//     or absent file falls back to the defaults, which are deliberately the
//     most conservative choice (self-update `managed` = observe, don't act).
//   • `$schema` and `$comment` keys are ignored everywhere without warning, so
//     the JSON file can carry editor hints and prose.
//
// Env var names are derived from the schema path, camelCase split on case:
//   modules.selfUpdate.maintenanceWindow.fromHour
//   → CLIENT_CONFIG_MODULES_SELF_UPDATE_MAINTENANCE_WINDOW_FROM_HOUR
// `CLIENT_CONFIG_FILE` is reserved: it relocates the JSON file (tests use it).

const fs   = require('fs');
const path = require('path');
const { MODULE_IDS, PRESETS, presetIncludes } = require('./moduleCatalog');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// One `{ enabled }` section per switchable module (server/config/
// moduleCatalog.js — the catalogue owns the list; R4, 2026-09-24). The leaf
// default is `true`, but the resolved value is the PRESET's answer unless the
// file or the env sets the leaf itself (resolveConfig, cross-field checks).
function moduleSwitchSections() {
  const out = {};
  for (const id of MODULE_IDS) out[id] = { enabled: { type: 'boolean', default: true } };
  return out;
}

// Schema = defaults + validation, in one tree. A node is a leaf iff it has an
// own `type` AND `default`; anything else is a nested section. Adding a module
// means adding a section here and nothing else.
const SCHEMA = {
  // ── Identity: what makes this product THIS product ─────────────────────────
  //
  // The engine is authored here and merged into every downstream (D-021).
  // Everything a downstream would otherwise have to fork out of an engine file
  // to look like itself — its name, its visitor locale, its theme set, its hero
  // clip, which engine surfaces it hides, its Organization record — lives
  // under this key instead, so `config/client.json` (product-owned, never
  // synced) is the one file a product edits. The defaults ARE Orange Smiley's
  // current values: an engine with no `identity` block behaves exactly as it
  // did before the seam existed, and tests/unit/identityConfig.test.js pins
  // those values ONCE so they cannot drift silently.
  //
  // Consumers (server): middleware/ssrMeta.js (titles, og:site_name, the
  // Organization + WebSite JSON-LD, the <html data-*-theme> attributes and the
  // `<script id="identity">` hand-off), config/i18n.js (PUBLIC_DEFAULT_LOCALE),
  // config/publicSurface.js (hidden routes), config/themes.js (theme ids).
  // Consumers (client): public/js/utils/identity.js parses the hand-off once
  // and everything else reads it — theme-boot.js reads the <html> attributes
  // because it runs before any module can.
  identity: {
    brand: {
      // The name on the nav lockup, the footer, og:site_name and the tab
      // fallback. A proper noun: the same in every locale.
      name:      { type: 'string', default: 'Orange Smiley', validate: validateNonEmpty },
      // The registered company, for the Organization record and <meta author>.
      legalName: { type: 'string', default: 'Orange Smiley ehf.', validate: validateNonEmpty },
      // Branded search variants bound to the site in the WebSite/Organization
      // schemas, so knowledge graphs treat them as one entity.
      alternateNames: { type: 'string[]', default: ['Orangesmiley', 'Orange Smiley ehf.', 'orange smiley', 'Rekstrarkerfið', 'Rekstrarkerfi'] },
      // Appended to every page-part title ("Þjónusta" + " — Orange Smiley").
      // The page parts stay in ssrMeta.js / pageTitle.js; a part that carries
      // a `{brand}` placeholder (the home page) is substituted instead of
      // suffixed. Leading space and dash included on purpose: the product
      // decides the separator.
      titleSuffix: { type: 'string', default: ' — Orange Smiley' },
    },
    locale: {
      // The locale a visitor with no signal reads the site in. The env var
      // PUBLIC_DEFAULT_LOCALE still wins over this (config/i18n.js), as it
      // did before the seam. Must be one of SUPPORTED_LOCALES.
      publicDefault: { type: 'string', default: 'is', validate: validateLocaleId },
    },
    theme: {
      // `default` is what a visitor gets with nothing stored; `root` is the
      // theme whose tokens ARE :root (no data-theme attribute); `picker` is the
      // set, in picker order; `dark` names the ids that paint a dark page (the
      // pickers rim those swatches). The cross-field check below rejects a
      // picker that lacks the DEFAULT and restores the whole set. The root
      // need not be in the picker (identity-seam-2): a two-theme product can
      // keep :root as an unlisted base and offer only its own ids.
      default: { type: 'string',   default: 'ember',   validate: validateThemeId },
      root:    { type: 'string',   default: 'classic', validate: validateThemeId },
      picker:  { type: 'string[]', default: ['ember', 'classic', 'midnight'], validate: validateThemeIds },
      dark:    { type: 'string[]', default: ['ember', 'midnight'], validate: validateThemeIdList },
      // Optional picker swatches per theme id — `{ "<id>": { "bg": "#…", "fg":
      // "#…" } }` (identity-seam-3): a product with its own theme ids paints
      // its own swatches instead of the engine's neutral fallback.
      // themePrefs.js `swatchFor` reads it; an id absent here keeps the
      // engine's swatch (or the token-built neutral one).
      swatches: { type: 'object', default: {}, validate: validateThemeSwatches },
    },
    hero: {
      // The home hero clip and its still. A new clip gets a NEW filename —
      // the public/ mount caches for an hour.
      clip:   { type: 'string', default: '/assets/videos/hero-dc7df-v2.mp4',        validate: validateAssetPath },
      poster: { type: 'string', default: '/assets/videos/hero-dc7df-v2-poster.jpg', validate: validateAssetPath },
    },
    surface: {
      // The public IA, in order: the links after "Home" in the top nav and
      // both footers, and (with '/' and the legal pages) the sitemap. Each
      // entry is { route, labelKey }: a bare engine route and the i18n key of
      // its label (engine table or the product overlay). A downstream lists
      // its own — hallismiley: verkefni, news, halli. Home is never listed:
      // the lockup and the first link are always '/'. A route that is also in
      // hiddenRoutes is dropped by the readers (config/publicSurface.js,
      // utils/identity.js) rather than advertised and noindexed at once.
      nav: {
        type: 'object[]',
        default: [
          { route: '/thjonusta',    labelKey: 'nav.thjonusta' },
          { route: '/um-okkur',     labelKey: 'nav.umOkkur' },
          { route: '/hafa-samband', labelKey: 'nav.hafaSamband' },
        ],
        validate: validateNavEntries,
      },
      // Engine routes this product keeps functional but off every discovery
      // surface (nav, sitemap, search). Prefix-aware: '/news' hides
      // '/news/<slug>' too. See config/publicSurface.js.
      hiddenRoutes: {
        type: 'string[]',
        default: ['/party', '/halli', '/about', '/news', '/shop', '/projects', '/contact', '/privacy', '/verkefni'],
        validate: validateRoutePaths,
      },
      // Does the public nav offer "Innskrá"? Off for a shop window whose only
      // sign-in is staff (rekstrarkerfi.is, D-020): they sign in at /login,
      // which opens the same login modal. Independent of the `signup` module
      // (the "Nýskrá" link follows that).
      navSignIn: { type: 'boolean', default: true },
      // Admin screens hidden from the sidebar for accounts that hold every
      // view; routes and ids stay live and grantable. Every id must be a real
      // ADMIN_VIEW_IDS entry — tests/unit/admin-surface-parity.test.js checks
      // the resolved list, so a typo cannot silently hide nothing.
      hiddenAdminViews: {
        type: 'string[]',
        default: ['products', 'collections', 'bins', 'orders', 'discounts', 'sales', 'pos', 'background'],
        validate: validateViewIds,
      },
    },
    // A product's OWN public routes' meta (identity-seam-3, 2026-09-23):
    // `{ "/console": { titleKey, descriptionKey?, titleMode?, noindex?,
    // locale? } }`. Each entry is merged over the engine's route meta —
    // ssrMeta.js `ROUTE_META`/`DEFAULT_META` server-side, pageTitle.js
    // client-side — so a route the engine does not know (hallismiley's
    // `/aron13ara`, LedgerLink's `/console`) or one it does (`/`) is titled,
    // described, de-indexed or locale-locked from config, not from a hook.
    //   titleKey / descriptionKey  i18n keys (engine table or the product
    //                              overlay `product.<locale>.json`);
    //   titleMode                  'suffix' (default: part + brand.titleSuffix,
    //                              or `{brand}` substituted) | 'bare';
    //   noindex                    true → <meta robots noindex>, a robots.txt
    //                              Disallow, never in the sitemap;
    //   locale                     'is' | 'en' → locale-locked like the party
    //                              pages (config/i18n.js forcedLocaleFor):
    //                              301 under any other prefix, one canonical,
    //                              listed under its own locale only.
    //   contentKeys                the site_content keys the page renders
    //                              (`['verdskra']`); the sitemap's <lastmod>
    //                              for the route is their newest updated_at
    //                              (routes/sitemapRoutes.js, rk-feed 2026-09-23).
    // An entry replaces the engine row for that route whole (no site_content
    // meta override, no shop section). `$comment` keys inside are ignored.
    routes: { type: 'object', default: {}, validate: validateRouteMeta },
    organization: {
      // The Organization JSON-LD every page's publisher/provider/author refs
      // resolve to (`${APP_URL}/#organization`). `name` is brand.legalName;
      // `url` and the @id derive from APP_URL at request time.
      email:           { type: 'string',   default: 'info@orangesmiley.is' },
      // A literal, or (identity-seam-3) an i18n KEY (`org.description`) the
      // product carries per locale in its `product.<locale>.json` overlay —
      // ssrMeta's organizationSchema resolves a key through t() at request
      // time and emits a literal as written.
      description:     { type: 'string',   default: 'Icelandic software company building and operating websites, online stores and business systems for small and medium businesses — one platform, one monthly subscription.' },
      logo:            { type: 'string',   default: '/favicon.svg',  validate: validateAssetPath },
      image:           { type: 'string',   default: '/og-image.jpg', validate: validateAssetPath },
      // The og:image card every page falls back to (the Organization `image`
      // above is the entity's picture — the same file here, not the same
      // idea; identity-seam-3). ssrMeta's OG_IMAGE_PATH reads it.
      ogImage:         { type: 'string',   default: '/og-image.jpg', validate: validateAssetPath },
      addressLocality: { type: 'string',   default: 'Hafnarfjörður' },
      addressCountry:  { type: 'string',   default: 'IS' },
      areaServed:      { type: 'string',   default: 'Iceland' },
      knowsAbout:      { type: 'string[]', default: ['Web Development', 'E-commerce', 'Inventory Management', 'Invoicing', 'VAT Accounting', 'Shopify Migration', 'Node.js', 'PostgreSQL'] },
      // Profile URLs (LinkedIn, Facebook, GitHub…) for schema.org sameAs.
      sameAs:          { type: 'string[]', default: [], validate: validateHttpsUrls },
    },
  },
  security: {
    mfa: {
      // Must a protected account (an admin by role or role set, an `accounts`
      // holder, a published seller — mfaService.protectedRole) ENROL a second
      // factor before it may act as what it is?
      //   optional → no one is forced. The Prófíll panel offers enrolment and
      //              an account that HAS enrolled is challenged at every
      //              sign-in exactly as before; nothing is withheld.
      //   required → auth/mfaPolicy.js withholds `admin` / the `accounts` view
      //              until the account enrols, and the SPA walks it to the
      //              panel (harvest-rk-totp-2026-09-23).
      // Default optional (Halli, 2026-09-23). mfaPolicy re-reads the env var
      // per call so a test can flip it; a deployment's env does not change
      // while it runs, so that reads what was resolved here. The
      // published-seller routes demand totp_enabled
      // themselves (routes/sellerRoutes.js rule 4) whatever this says.
      enrolment: { type: 'string', default: 'optional', enum: ['optional', 'required'] },
    },
  },
  mcp: {
    // The MCP catalogue write tools (harvest-ice-c-2026-09-24; icelandicstore
    // #248/#250/#361). Each kind of write is its own switch and every switch
    // is OFF unless this file or its env var says true — so a stack whose
    // MCP_ALLOWED_SCOPES ceiling includes 'write' still offers none of them
    // until one is turned on here, deliberately, per instance (Halli
    // 2026-09-24). They also need the shop module (modules.shop.enabled).
    //   productCreate → create_product (always a DRAFT: active = false)
    //   productUpdate → update_product (never stock — that is set_stock's)
    //   stock         → set_stock (audited in inventory_adjustments, actor =
    //                   the token's owner)
    // Read per call by server/mcp/registry.js, so flipping the env var bites
    // without a restart. Env: CLIENT_CONFIG_MCP_WRITE_PRODUCT_CREATE etc.
    write: {
      productCreate: { type: 'boolean', default: false },
      productUpdate: { type: 'boolean', default: false },
      stock:         { type: 'boolean', default: false },
    },
  },
  modules: {
    // Which modules this instance HAS (R4, ENHANCEMENTS #5). A preset is a
    // Rekstrarkerfið tier — vefur (the core + news) · verslun (+ shop, till) ·
    // rekstur (+ bókhald) — or `all`, the engine default: every module, which
    // is how every instance behaved before the switches existed. Each module
    // below may still be set on its own (`"shop": { "enabled": false }`, or
    // CLIENT_CONFIG_MODULES_SHOP_ENABLED); an explicit setting beats the
    // preset. What each module owns: server/config/moduleCatalog.js.
    preset: { type: 'string', default: 'all', enum: PRESETS },
    ...moduleSwitchSections(),
    selfUpdate: {
      // Is the module present on this instance at all? Off means: no checker,
      // no admin screen, and the API answers 404 rather than 403 — a module
      // that is not here should not advertise that it could be. This is the
      // switch the base (HalliProjects) ships OFF, so the engine carries the
      // capability dormant and each fleet turns it on deliberately.
      enabled: { type: 'boolean', default: true },
      // managed → check + record only (Orange Smiley drives the update)
      // manual  → the customer's admin presses "Update now"
      // auto    → applies itself inside the maintenance window
      mode:    { type: 'string', default: 'managed', enum: ['managed', 'auto', 'manual'] },
      channel: { type: 'string', default: 'stable',  enum: ['stable', 'canary'] },
      // `{channel}` is substituted by the update checker (Phase 2). https only:
      // the manifest is public, but a plaintext fetch would let a network
      // attacker feed us a digest to pull.
      manifestUrl: {
        type: 'string',
        default: 'https://releases.orangesmiley.is/store/{channel}.json',
        validate: validateManifestUrl,
      },
      // A release flagged `critical: true` (a security fix) may jump the queue
      // and apply outside the maintenance window. Default true: the window
      // exists to protect a quiet hour, and a known-exploited hole outranks a
      // quiet hour. An instance that genuinely cannot tolerate an unscheduled
      // restart — a till mid-shift — turns this off and accepts the exposure.
      allowCriticalOutsideWindow: { type: 'boolean', default: true },
      maintenanceWindow: {
        days:     { type: 'string[]', default: ['tue', 'wed', 'thu'], enum: DAYS },
        fromHour: { type: 'int', default: 3, min: 0, max: 23 },
        toHour:   { type: 'int', default: 5, min: 0, max: 23 },
        tz:       { type: 'string', default: 'Atlantic/Reykjavik', validate: validateTimeZone },
      },
    },
  },
};

const CONFIG_FILE = process.env.CLIENT_CONFIG_FILE
  ? path.resolve(process.env.CLIENT_CONFIG_FILE)
  : path.join(__dirname, '..', '..', 'config', 'client.json');

const ENV_PREFIX = 'CLIENT_CONFIG_';
// Reserved env names that are not schema overrides.
const ENV_RESERVED = new Set([`${ENV_PREFIX}FILE`]);
// Keys the JSON file may carry that are documentation, not configuration.
const META_KEYS = new Set(['$schema', '$comment']);
// A key matching this must never appear in the schema — see the header note.
const SECRET_KEY_RE = /(secret|password|passwd|token|credential|apikey|api_key|private)/i;

// ── Validators ───────────────────────────────────────────────────────────────

function validateManifestUrl(value) {
  let url;
  try {
    // The placeholder is not a legal URL character everywhere; swap it for a
    // concrete channel before parsing so the template validates as itself.
    url = new URL(String(value).replace(/\{channel\}/g, 'stable'));
  } catch {
    return 'is not a valid URL';
  }
  if (url.protocol !== 'https:') return 'must use https';
  return null;
}

function validateTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value) });
    return null;
  } catch {
    return 'is not a recognised IANA time zone';
  }
}

// ── Identity validators ──────────────────────────────────────────────────────
// Each guards the shape a consumer relies on; the value is already coerced to
// the leaf's declared type, so a string[] validator receives an array.

function validateNonEmpty(value) {
  return String(value).trim() === '' ? 'must not be empty' : null;
}

// A BCP-47-ish primary tag: 'is', 'en', 'pt-br'. Membership in
// SUPPORTED_LOCALES is config/i18n.js's concern (it is env-driven).
function validateLocaleId(value) {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(value) ? null : 'must be a lowercase locale id such as "is"';
}

// Theme ids ride html[data-theme="…"] and localStorage; keep them attribute-
// and-CSS-safe.
const THEME_ID_RE = /^[a-z][a-z0-9-]*$/;
function validateThemeId(value) {
  return THEME_ID_RE.test(value) ? null : 'must be a theme id matching ^[a-z][a-z0-9-]*$';
}
function validateThemeIds(list) {
  if (!list.length) return 'must list at least one theme';
  return validateThemeIdList(list);
}
// The same shape, but empty is fine (a product may paint no dark theme).
function validateThemeIdList(list) {
  const bad = list.filter(id => !THEME_ID_RE.test(id));
  if (bad.length) return `has ids that do not match ^[a-z][a-z0-9-]*$ (${bad.join(', ')})`;
  if (new Set(list).size !== list.length) return 'must not repeat a theme id';
  return null;
}

// A site-relative path ('/assets/…') or an absolute https URL (a CDN).
function validateAssetPath(value) {
  if (/^\/[^\s"'<>]*$/.test(value)) return null;
  if (/^https:\/\/[^\s"'<>]+$/.test(value)) return null;
  return 'must be a site-relative path starting with "/" or an https URL';
}

// Hidden routes are matched by prefix against the locale-stripped path, so
// each must be a bare '/segment[/…]' — no locale prefix, no trailing slash,
// never '/' itself (that would hide the whole site).
function validateRoutePaths(list) {
  const bad = list.filter(p => !/^\/[a-z0-9][a-z0-9/_-]*$/i.test(p) || p.endsWith('/'));
  return bad.length ? `has entries that are not bare routes like "/news" (${bad.join(', ')})` : null;
}

// A nav entry is a bare route (same shape as a hidden route) plus the i18n
// key of its label. Nothing else is read, so nothing else is accepted.
const NAV_ROUTE_RE = /^\/[a-z0-9][a-z0-9/_-]*$/i;
const I18N_KEY_RE  = /^[a-z0-9_$]+(?:\.[a-z0-9_$-]+)+$/i;
function validateNavEntries(list) {
  const bad = [];
  const seen = new Set();
  for (const e of list) {
    if (!isPlainObject(e) || typeof e.route !== 'string' || typeof e.labelKey !== 'string') { bad.push(JSON.stringify(e)); continue; }
    if (!NAV_ROUTE_RE.test(e.route) || e.route.endsWith('/')) bad.push(e.route);
    else if (!I18N_KEY_RE.test(e.labelKey)) bad.push(`${e.route}: ${e.labelKey}`);
    else if (Object.keys(e).some(k => k !== 'route' && k !== 'labelKey')) bad.push(`${e.route}: unknown field`);
    else if (seen.has(e.route)) bad.push(`${e.route} repeated`);
    seen.add(e.route);
  }
  return bad.length ? `has entries that are not { route: "/bare-route", labelKey: "nav.key" } (${bad.join(', ')})` : null;
}

// identity.routes — a map of bare route (or '/') → the route's meta record.
// Every field is optional except titleKey; nothing else is read, so nothing
// else is accepted. A locale is shape-checked here; whether it is SUPPORTED
// is config/i18n.js's concern (an unsupported lock is ignored there).
const ROUTE_FIELDS = new Set(['titleKey', 'descriptionKey', 'titleMode', 'noindex', 'locale', 'contentKeys']);
// A site_content key: the table's PRIMARY KEY text, as the seeds spell them
// (home_hero, contact_card, verdskra).
const CONTENT_KEY_RE = /^[a-z0-9_]{1,64}$/;
function validateRouteMeta(map) {
  const bad = [];
  for (const [route, e] of Object.entries(map)) {
    if (route !== '/' && (!NAV_ROUTE_RE.test(route) || route.endsWith('/'))) { bad.push(`${route}: not a bare route`); continue; }
    if (!isPlainObject(e)) { bad.push(`${route}: not an object`); continue; }
    if (typeof e.titleKey !== 'string' || !I18N_KEY_RE.test(e.titleKey)) { bad.push(`${route}: titleKey must be an i18n key`); continue; }
    if (e.descriptionKey !== undefined && (typeof e.descriptionKey !== 'string' || !I18N_KEY_RE.test(e.descriptionKey))) bad.push(`${route}: descriptionKey must be an i18n key`);
    else if (e.titleMode !== undefined && e.titleMode !== 'bare' && e.titleMode !== 'suffix') bad.push(`${route}: titleMode must be "bare" or "suffix"`);
    else if (e.noindex !== undefined && typeof e.noindex !== 'boolean') bad.push(`${route}: noindex must be a boolean`);
    else if (e.locale !== undefined && e.locale !== null && (typeof e.locale !== 'string' || validateLocaleId(e.locale))) bad.push(`${route}: locale must be a locale id or null`);
    else if (e.contentKeys !== undefined && (!Array.isArray(e.contentKeys) || e.contentKeys.some(k => typeof k !== 'string' || !CONTENT_KEY_RE.test(k)))) bad.push(`${route}: contentKeys must be a list of site_content keys`);
    else {
      const unknown = Object.keys(e).filter(k => !ROUTE_FIELDS.has(k));
      if (unknown.length) bad.push(`${route}: unknown field ${unknown.join(', ')}`);
    }
  }
  return bad.length
    ? `has entries that are not { "/route": { titleKey, descriptionKey?, titleMode?, noindex?, locale?, contentKeys? } } (${bad.join('; ')})`
    : null;
}

// identity.theme.swatches — theme id → { bg, fg }, each a CSS colour. Kept to
// the characters a colour literal needs; the values land in a CSS custom
// property, never in markup.
const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9 ,.%/]+\)|[a-z]+)$/i;
function validateThemeSwatches(map) {
  const bad = [];
  for (const [id, s] of Object.entries(map)) {
    if (!THEME_ID_RE.test(id)) { bad.push(`${id}: not a theme id`); continue; }
    if (!isPlainObject(s) || typeof s.bg !== 'string' || typeof s.fg !== 'string') { bad.push(`${id}: needs { bg, fg }`); continue; }
    if (!CSS_COLOR_RE.test(s.bg) || !CSS_COLOR_RE.test(s.fg) || !s.bg.trim() || !s.fg.trim()) bad.push(`${id}: bg/fg must be CSS colours`);
    else if (Object.keys(s).some(k => k !== 'bg' && k !== 'fg')) bad.push(`${id}: unknown field`);
  }
  return bad.length ? `has entries that are not { "<theme id>": { bg, fg } } (${bad.join('; ')})` : null;
}

// Admin view ids are lowercase words (server/auth/adminViews.js). Whether each
// one EXISTS is checked by tests/unit/admin-surface-parity.test.js against the
// resolved config — this module stays dependency-free.
function validateViewIds(list) {
  const bad = list.filter(id => !/^[a-z][a-z0-9_-]*$/.test(id));
  return bad.length ? `has entries that are not admin view ids (${bad.join(', ')})` : null;
}

function validateHttpsUrls(list) {
  const bad = list.filter(u => {
    try { return new URL(u).protocol !== 'https:'; } catch { return true; }
  });
  return bad.length ? `has entries that are not https URLs (${bad.join(', ')})` : null;
}

// ── Schema helpers ───────────────────────────────────────────────────────────

// A leaf carries BOTH `type` and `default`. Checking `default` alone would
// misread a section that has a child leaf called `default` (identity.theme
// .default is exactly that) as a leaf of its own.
function isLeaf(node) {
  return !!node && typeof node === 'object'
    && Object.prototype.hasOwnProperty.call(node, 'default')
    && Object.prototype.hasOwnProperty.call(node, 'type');
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function camelToSnakeUpper(segment) {
  return segment.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/** Env var name for a schema path, e.g. ['modules','selfUpdate','mode']. */
function envNameFor(segments) {
  return ENV_PREFIX + segments.map(camelToSnakeUpper).join('_');
}

/** Walk the schema, calling visit(segments, leaf) for every leaf. */
function walkSchema(node, visit, segments = []) {
  for (const [key, child] of Object.entries(node)) {
    const next = segments.concat(key);
    if (isLeaf(child)) visit(next, child);
    else walkSchema(child, visit, next);
  }
}

/** Fresh defaults tree (fresh arrays and fresh objects inside them, so
 *  callers can never share mutable state). */
function defaultsFrom(node) {
  const out = {};
  for (const [key, child] of Object.entries(node)) {
    out[key] = isLeaf(child)
      ? (Array.isArray(child.default) ? child.default.map(cloneValue) : cloneDeep(child.default))
      : defaultsFrom(child);
  }
  return out;
}

function cloneValue(v) {
  return isPlainObject(v) ? { ...v } : v;
}

// JSON-shaped values only (what a config file or an env var can carry).
function cloneDeep(v) {
  if (Array.isArray(v)) return v.map(cloneDeep);
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneDeep(x)]));
  return v;
}

// Drop `$schema`/`$comment` keys at every level of a (fresh) plain object.
function stripMeta(v) {
  if (Array.isArray(v)) return v.map(stripMeta);
  if (!isPlainObject(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!META_KEYS.has(k)) out[k] = stripMeta(x);
  return out;
}

function getIn(obj, segments) {
  return segments.reduce((acc, k) => (isPlainObject(acc) ? acc[k] : undefined), obj);
}

function setIn(obj, segments, value) {
  let cursor = obj;
  for (const key of segments.slice(0, -1)) cursor = cursor[key];
  cursor[segments[segments.length - 1]] = value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ── Coercion + validation of one value ───────────────────────────────────────

/**
 * Coerce a raw value (from JSON, where it already has a type, or from an env
 * var, where it is always a string) to the leaf's declared type.
 * @returns {{ value: * } | { error: string }}
 */
function coerce(leaf, raw) {
  switch (leaf.type) {
    case 'string':
      if (typeof raw === 'string') return { value: raw };
      return { error: 'must be a string' };

    case 'int': {
      const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
      if (typeof n !== 'number' || !Number.isInteger(n)) return { error: 'must be an integer' };
      return { value: n };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (typeof raw === 'string' && /^(true|1|yes|on)$/i.test(raw.trim()))  return { value: true };
      if (typeof raw === 'string' && /^(false|0|no|off)$/i.test(raw.trim())) return { value: false };
      return { error: 'must be a boolean' };
    }

    case 'string[]': {
      let list = raw;
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[')) {
          try { list = JSON.parse(trimmed); } catch { return { error: 'must be a JSON array or a comma-separated list' }; }
        } else {
          list = trimmed === '' ? [] : trimmed.split(',').map(s => s.trim());
        }
      }
      if (!Array.isArray(list) || list.some(v => typeof v !== 'string')) {
        return { error: 'must be an array of strings' };
      }
      return { value: list };
    }

    // A list of plain objects (the nav entries). From JSON it is already an
    // array; an env var carries it as a JSON string. What the objects must
    // hold is the leaf validator's job.
    case 'object[]': {
      let list = raw;
      if (typeof raw === 'string') {
        try { list = JSON.parse(raw.trim()); } catch { return { error: 'must be a JSON array of objects' }; }
      }
      if (!Array.isArray(list) || !list.every(isPlainObject)) return { error: 'must be an array of objects' };
      return { value: list.map(cloneValue) };
    }

    // A map keyed by the product (the route meta, the theme swatches). From
    // JSON it is an object; an env var carries it as a JSON string. `$comment`
    // keys inside — on the map or on a record — are documentation, like
    // everywhere else in the file. What the records must hold is the leaf
    // validator's job.
    case 'object': {
      let obj = raw;
      if (typeof raw === 'string') {
        try { obj = JSON.parse(raw.trim()); } catch { return { error: 'must be a JSON object' }; }
      }
      if (!isPlainObject(obj)) return { error: 'must be an object' };
      return { value: stripMeta(cloneDeep(obj)) };
    }

    /* istanbul ignore next — unreachable while every leaf uses a type above */
    default:
      return { error: `has an unsupported schema type "${leaf.type}"` };
  }
}

/** @returns {string|null} error message, or null when the value is acceptable. */
function validateValue(leaf, value) {
  if (leaf.enum) {
    const values = Array.isArray(value) ? value : [value];
    const bad = values.filter(v => !leaf.enum.includes(v));
    if (bad.length) return `must be one of ${leaf.enum.join(', ')} (got ${bad.join(', ')})`;
  }
  if (leaf.type === 'int') {
    if (typeof leaf.min === 'number' && value < leaf.min) return `must be >= ${leaf.min}`;
    if (typeof leaf.max === 'number' && value > leaf.max) return `must be <= ${leaf.max}`;
  }
  if (leaf.validate) return leaf.validate(value);
  return null;
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve the effective config. Pure — no filesystem, no process.env, no
 * module state — so precedence is directly testable.
 *
 * @param {object}   [opts.fileConfig] parsed config/client.json (or {})
 * @param {object}   [opts.env]        environment (defaults to process.env)
 * @param {object}   [opts.schema]     schema tree (defaults to SCHEMA)
 * @returns {{ config: object, warnings: string[] }} config is NOT frozen here
 */
function resolveConfig({ fileConfig = {}, env = process.env, schema = SCHEMA } = {}) {
  const warnings = [];
  const config   = defaultsFrom(schema);

  // Index the schema once: leaves by dotted path and by env var name.
  const leaves  = new Map();
  const byEnv   = new Map();
  walkSchema(schema, (segments, leaf) => {
    const dotted = segments.join('.');
    leaves.set(dotted, { segments, leaf });
    const name = envNameFor(segments);
    if (byEnv.has(name)) {
      // Two schema paths collapsing to one env name is a bug in the schema,
      // not in anyone's deployment. Say so loudly; first path wins.
      warnings.push(`schema defect: ${dotted} and ${byEnv.get(name).segments.join('.')} both map to ${name}`);
    } else {
      byEnv.set(name, { segments, leaf, dotted });
    }
  });

  // Leaves the file or the env set to an accepted value — the module
  // switches a preset must leave alone.
  const explicit = new Set();

  const apply = (source, dotted, rawValue) => {
    const entry = leaves.get(dotted);
    const { leaf, segments } = entry;
    const coerced = coerce(leaf, rawValue);
    if (coerced.error) {
      warnings.push(`${source} ${dotted} ${coerced.error} — keeping ${JSON.stringify(getIn(config, segments))}`);
      return;
    }
    const error = validateValue(leaf, coerced.value);
    if (error) {
      warnings.push(`${source} ${dotted} ${error} — keeping ${JSON.stringify(getIn(config, segments))}`);
      return;
    }
    setIn(config, segments, coerced.value);
    explicit.add(dotted);
  };

  // ── Layer 2: the file ──────────────────────────────────────────────────────
  const walkFile = (node, segments) => {
    for (const [key, raw] of Object.entries(node)) {
      if (META_KEYS.has(key)) continue;
      const next   = segments.concat(key);
      const dotted = next.join('.');
      const entry  = leaves.get(dotted);
      if (entry) {
        apply('config/client.json:', dotted, raw);
      } else if (isPlainObject(raw) && getIn(schema, next)) {
        walkFile(raw, next);
      } else {
        warnings.push(`config/client.json: unknown key "${dotted}" ignored`);
      }
    }
  };
  if (isPlainObject(fileConfig)) walkFile(fileConfig, []);
  else warnings.push('config/client.json: top level is not an object — ignored');

  // ── Layer 3: env vars ──────────────────────────────────────────────────────
  for (const name of Object.keys(env).filter(k => k.startsWith(ENV_PREFIX)).sort()) {
    if (ENV_RESERVED.has(name)) continue;
    const target = byEnv.get(name);
    if (!target) {
      warnings.push(`env ${name} does not match any config key — ignored`);
      continue;
    }
    const raw = env[name];
    // An empty env var is how App Service / CI represent "not set"; treat it
    // as absent rather than as an empty string that fails validation.
    if (raw === undefined || raw === '') continue;
    apply('env ' + name + ':', target.dotted, raw);
  }

  // ── Cross-field checks ─────────────────────────────────────────────────────

  // The preset answers every module switch nobody set explicitly. Applied
  // after BOTH layers, so `preset: "vefur"` in the file plus
  // CLIENT_CONFIG_MODULES_BOOKS_ENABLED=true in the env is Vefur + bókhald,
  // and an env preset re-derives the switches the file left alone.
  const modules = config.modules;
  if (modules && typeof modules.preset === 'string') {
    for (const id of MODULE_IDS) {
      if (!isPlainObject(modules[id]) || explicit.has(`modules.${id}.enabled`)) continue;
      modules[id].enabled = presetIncludes(modules.preset, id);
    }
  }

  const window = config.modules.selfUpdate.maintenanceWindow;
  if (window.fromHour === window.toHour) {
    warnings.push(
      `modules.selfUpdate.maintenanceWindow is zero-length (fromHour === toHour === ${window.fromHour}) — auto updates would never run`
    );
  }
  if (!window.days.length) {
    warnings.push('modules.selfUpdate.maintenanceWindow.days is empty — auto updates would never run');
  }

  // The theme set only makes sense together: a default the picker does not
  // offer would paint a theme nobody can choose back. Reject the whole set and
  // fall back to the schema's, rather than half of a product's choice. The
  // root may sit outside the picker (a two-theme product keeps :root as an
  // unlisted base); `dark` ids outside the picker are simply never asked for.
  const theme = config.identity && config.identity.theme;
  if (theme && !theme.picker.includes(theme.default)) {
    warnings.push(
      `identity.theme.picker [${theme.picker.join(', ')}] does not include "${theme.default}" — keeping the default theme set`
    );
    config.identity.theme = defaultsFrom(schema).identity.theme;
  }

  return { config, warnings };
}

/**
 * Read config/client.json. A missing file is the normal case for a fresh
 * instance. A corrupt one is a deploy error, but the defaults are the safe
 * choice, so we report it at error level and keep booting rather than taking
 * the site down over a stray comma.
 *
 * @returns {{ fileConfig: object, source: string, problems: string[] }}
 */
function loadFileConfig(file = CONFIG_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { fileConfig: {}, source: 'defaults', problems: [] };
    return { fileConfig: {}, source: 'defaults', problems: [`could not read ${file}: ${err.message}`] };
  }
  try {
    const parsed = JSON.parse(text);
    return { fileConfig: parsed, source: file, problems: [] };
  } catch (err) {
    return { fileConfig: {}, source: 'defaults', problems: [`${file} is not valid JSON (${err.message}) — using defaults`] };
  }
}

/** Guard the no-secrets rule as the schema grows. @returns {string[]} */
function secretShapedPaths(schema = SCHEMA) {
  const offenders = [];
  walkSchema(schema, (segments) => {
    if (segments.some(s => SECRET_KEY_RE.test(s))) offenders.push(segments.join('.'));
  });
  return offenders;
}

// ── Singleton ────────────────────────────────────────────────────────────────

const loaded = loadFileConfig();
const { config, warnings } = resolveConfig({ fileConfig: loaded.fileConfig });
const allProblems = loaded.problems.concat(warnings);

/** Deep-frozen effective config for this instance. */
const clientConfig = deepFreeze(config);

/**
 * Emit the resolved config to pino. Called once from server.js at boot so the
 * line lands in order with the rest of the startup log; kept out of module
 * load so requiring the config never has a side effect on the log.
 */
function logResolvedConfig(log = require('../logger')) {
  for (const problem of loaded.problems) log.error(`[clientConfig] ${problem}`);
  for (const warning of warnings)        log.warn(`[clientConfig] ${warning}`);
  for (const offender of secretShapedPaths()) {
    log.error(`[clientConfig] schema defect: "${offender}" looks like a secret — client config is logged in full and committed to git`);
  }
  log.info({ source: loaded.source, config: clientConfig }, '[clientConfig] resolved instance configuration');
}

module.exports = {
  clientConfig,
  logResolvedConfig,
  // Exposed for tests and for tooling that documents the config surface.
  resolveConfig,
  loadFileConfig,
  secretShapedPaths,
  envNameFor,
  deepFreeze,
  SCHEMA,
  CONFIG_FILE,
  ENV_PREFIX,
  problems: allProblems,
  defaults: () => defaultsFrom(SCHEMA),
};
