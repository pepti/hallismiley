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

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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
      // set, in picker order. The cross-field check below rejects a picker
      // that lacks the default or the root and restores all three defaults.
      default: { type: 'string',   default: 'ember',   validate: validateThemeId },
      root:    { type: 'string',   default: 'classic', validate: validateThemeId },
      picker:  { type: 'string[]', default: ['ember', 'classic', 'midnight'], validate: validateThemeIds },
    },
    hero: {
      // The home hero clip and its still. A new clip gets a NEW filename —
      // the public/ mount caches for an hour.
      clip:   { type: 'string', default: '/assets/videos/hero-dc7df-v2.mp4',        validate: validateAssetPath },
      poster: { type: 'string', default: '/assets/videos/hero-dc7df-v2-poster.jpg', validate: validateAssetPath },
    },
    surface: {
      // Engine routes this product keeps functional but off every discovery
      // surface (nav, sitemap, search). Prefix-aware: '/news' hides
      // '/news/<slug>' too. See config/publicSurface.js.
      hiddenRoutes: {
        type: 'string[]',
        default: ['/party', '/halli', '/about', '/news', '/shop', '/projects', '/contact', '/privacy', '/verkefni'],
        validate: validateRoutePaths,
      },
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
    organization: {
      // The Organization JSON-LD every page's publisher/provider/author refs
      // resolve to (`${APP_URL}/#organization`). `name` is brand.legalName;
      // `url` and the @id derive from APP_URL at request time.
      email:           { type: 'string',   default: 'info@orangesmiley.is' },
      description:     { type: 'string',   default: 'Icelandic software company building and operating websites, online stores and business systems for small and medium businesses — one platform, one monthly subscription.' },
      logo:            { type: 'string',   default: '/favicon.svg',  validate: validateAssetPath },
      image:           { type: 'string',   default: '/og-image.jpg', validate: validateAssetPath },
      addressLocality: { type: 'string',   default: 'Hafnarfjörður' },
      addressCountry:  { type: 'string',   default: 'IS' },
      areaServed:      { type: 'string',   default: 'Iceland' },
      knowsAbout:      { type: 'string[]', default: ['Web Development', 'E-commerce', 'Inventory Management', 'Invoicing', 'VAT Accounting', 'Shopify Migration', 'Node.js', 'PostgreSQL'] },
      // Profile URLs (LinkedIn, Facebook, GitHub…) for schema.org sameAs.
      sameAs:          { type: 'string[]', default: [], validate: validateHttpsUrls },
    },
  },
  modules: {
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

/** Fresh defaults tree (fresh arrays, so callers can never share mutable state). */
function defaultsFrom(node) {
  const out = {};
  for (const [key, child] of Object.entries(node)) {
    out[key] = isLeaf(child)
      ? (Array.isArray(child.default) ? child.default.slice() : child.default)
      : defaultsFrom(child);
  }
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
  const window = config.modules.selfUpdate.maintenanceWindow;
  if (window.fromHour === window.toHour) {
    warnings.push(
      `modules.selfUpdate.maintenanceWindow is zero-length (fromHour === toHour === ${window.fromHour}) — auto updates would never run`
    );
  }
  if (!window.days.length) {
    warnings.push('modules.selfUpdate.maintenanceWindow.days is empty — auto updates would never run');
  }

  // The theme trio only makes sense together: a default the picker does not
  // offer would paint a theme nobody can choose back, and a root outside the
  // picker would leave :root's tokens unreachable. Reject the whole trio and
  // fall back to the schema's, rather than half of a product's choice.
  const theme = config.identity && config.identity.theme;
  const missing = theme ? [theme.default, theme.root].filter(id => !theme.picker.includes(id)) : [];
  if (missing.length) {
    warnings.push(
      `identity.theme.picker [${theme.picker.join(', ')}] does not include ${missing.map(m => `"${m}"`).join(' and ')} — keeping the default theme set`
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
