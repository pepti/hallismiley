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
// own `default`; anything else is a nested section. Adding a module means
// adding a section here and nothing else.
const SCHEMA = {
  modules: {
    selfUpdate: {
      // Is the module present on this instance at all? Off means: no checker,
      // no admin screen, and the API answers 404 rather than 403 — a module
      // that is not here should not advertise that it could be. This is the
      // switch the base (HalliProjects) ships OFF, so the engine carries the
      // capability dormant and each fleet turns it on deliberately.
      // BASE DEFAULT: the engine ships with self-update OFF — the API answers 404,
    // the checker never starts, the sidebar drops the Updates line. Instances
    // (and the factory) turn it on per fleet in config/client.json.
    enabled: { type: 'boolean', default: false },
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

// ── Schema helpers ───────────────────────────────────────────────────────────

function isLeaf(node) {
  return !!node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, 'default');
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
