// Feature gate for the Playwright suite — the e2e face of tests/lib/featureGate.js.
//
// An engine spec belongs to a feature (the registry's `paths` say which). On a
// product that has hidden, disabled or forked that feature in
// features/local.json, or when the feature belongs to another product, the
// spec is skipped as a whole with the note from local.json — it is never
// deleted or hand-edited (docs/ENGINE-SYNC.md §6). In the engine local.json is
// empty and every spec runs.
//
//   const { gateSpec } = require('./lib/featureGate');
//   gateSpec(test, __filename);            // at the top of a spec
//   skipUnless(test, 'seller-publication'); // a describe that needs a feature
const core = require('../../tests/lib/featureGate');

/** Skip every test in the calling spec when its feature is gated here. */
function gateSpec(test, file) {
  const r = core.defaultGate().gateForSpec(file);
  test.skip(r.skip, r.reason || undefined);
  return r;
}

/** Skip the enclosing file or describe when `featureId` is gated here. */
function skipUnless(test, featureId) {
  const r = core.defaultGate().gate(featureId);
  test.skip(r.skip, r.reason || undefined);
  return r;
}

module.exports = { gateSpec, skipUnless, gate: (id) => core.defaultGate().gate(id) };
