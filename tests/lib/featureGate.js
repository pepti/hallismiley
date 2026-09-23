'use strict';

/**
 * Feature gate for the test suites (D-021, 2026-09-22).
 *
 * The engine's specs assert the engine's behaviour — its public IA, its admin
 * lines, its seller area. A downstream that hides, disables or forks one of
 * those features records that in `features/local.json`
 * (`{ "<engine feature id>": { "status": "hidden|disabled|forked", "note" } }`)
 * and must NOT delete or hand-edit the engine's specs (docs/ENGINE-SYNC.md §6:
 * "never delete an engine spec"). This module reads that file plus the
 * feature registry and answers "should this suite run here?", so the skip is
 * derived, not hand-kept:
 *
 *   • gate(featureId)        → { skip, status, reason }
 *   • gateForSpec(file)      → the same for the feature whose `paths` claim
 *                              the spec (scripts/features-index.js), so a
 *                              spec never names its feature by hand
 *   • a feature belonging to ANOTHER product (features/<other>/…, arrives by
 *     merge and stays inert) skips too — its suite tests that product's
 *     seeded content, not this one's.
 *
 * Jest helpers (this file): describeFor / describeForSpec return `describe`
 * or a `describe.skip` that carries the note in the block name. Playwright:
 * e2e/lib/featureGate.js wraps the same core with `test.skip(cond, note)`.
 *
 * In the engine itself local.json is empty, so nothing skips here;
 * tests/unit/featureGate.test.js pins that and exercises a temp local.json.
 */
const fs = require('fs');
const path = require('path');
const { loadFeatures, productId } = require('../../scripts/features-index');

const ROOT = path.join(__dirname, '../..');
const GATED_STATUSES = ['hidden', 'disabled', 'forked'];

/** gitignore-ish glob → RegExp over a repo-relative posix path. */
function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** features/local.json → { id: { status, note } }; a missing file is {}. */
function readLocal(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
  }
  const out = {};
  for (const [id, v] of Object.entries(parsed || {})) {
    if (id === '_comment') continue;
    out[id] = v && typeof v === 'object' ? { status: v.status, note: v.note } : { status: String(v) };
  }
  return out;
}

const PASS = Object.freeze({ skip: false, status: null, reason: null, feature: null });

/**
 * Build a gate. Everything is injectable so the unit test can run it over a
 * temp local.json or a synthetic registry without touching the repo's.
 */
function createGate({
  root = ROOT,
  localPath = path.join(root, 'features', 'local.json'),
  features = loadFeatures(root),
  product = productId(root),
} = {}) {
  const local = readLocal(localPath);
  const byId = new Map(features.map((f) => [f.id, f]));
  const matchers = features.map((f) => ({ id: f.id, res: (f.paths || []).map(globRe) }));

  function gate(featureId) {
    const f = byId.get(featureId);
    if (!f) return { ...PASS, feature: featureId };
    if (f.foreign) {
      return {
        skip: true, status: 'foreign', feature: featureId,
        reason: `${featureId} belongs to product "${f.folderOwner}", not "${product}" — its files are inert here`,
      };
    }
    const override = local[featureId];
    if (override && GATED_STATUSES.includes(override.status)) {
      return {
        skip: true, status: override.status, feature: featureId,
        reason: `${featureId} is ${override.status} on this product (features/local.json)${override.note ? `: ${override.note}` : ''}`,
      };
    }
    return { skip: false, status: override ? override.status : f.status || null, reason: null, feature: featureId };
  }

  function toRel(file) {
    const abs = path.isAbsolute(file) ? file : path.join(root, file);
    return path.relative(root, abs).split(path.sep).join('/');
  }

  /** The id of the feature whose `paths` claim this file, or null. */
  function featureFor(file) {
    const rel = toRel(file);
    for (const { id, res } of matchers) if (res.some((re) => re.test(rel))) return id;
    return null;
  }

  function gateForSpec(file) {
    const id = featureFor(file);
    return id ? gate(id) : PASS;
  }

  return { root, product, local, features, gate, featureFor, gateForSpec };
}

let _default = null;
/** The gate over this repo, built on first use. */
function defaultGate() {
  if (!_default) _default = createGate();
  return _default;
}

// ── Jest helpers ─────────────────────────────────────────────────────────────
// `describe` is a Jest global; it is looked up at call time so this module can
// be required (and unit-tested) outside a test file too.

function skipper(result, describeImpl) {
  const d = describeImpl || global.describe;
  if (!result.skip) return d;
  const skip = (name, fn) => d.skip(`${name} — skipped: ${result.reason}`, fn);
  // describe.skip.each exists; mirror it so a gated `describe.each` still parses.
  skip.each = (...args) => (name, fn) => d.skip.each(...args)(`${name} — skipped: ${result.reason}`, fn);
  skip.skip = skip;
  skip.only = skip;
  return skip;
}

/** `describe`, or a `describe.skip` carrying the gate's note, for a feature. */
function describeFor(featureId, { gate = defaultGate(), describe: d } = {}) {
  return skipper(gate.gate(featureId), d);
}

/** The same, for the feature whose paths claim the calling spec (`__filename`). */
function describeForSpec(file, { gate = defaultGate(), describe: d } = {}) {
  return skipper(gate.gateForSpec(file), d);
}

module.exports = {
  ROOT, GATED_STATUSES, globRe, readLocal, createGate, defaultGate, describeFor, describeForSpec,
};
