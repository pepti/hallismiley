// Role × route harness — user. A plain signed-in `user` (no admin views): every public route renders cleanly, including the signed-in ones; every admin route is refused.
// The matrix itself is e2e/lib/roleMatrix.js, over the route list derived in
// e2e/lib/routes.js; see docs/TESTING.md ("The role × route harness"). Ported
// from icelandicstore #62 (harvest 2 lane 9, 2026-09-26).
const { test } = require('@playwright/test');
// Skipped as a whole on a product that hides, disables or forks the feature
// this spec belongs to (features/local.json — see e2e/lib/featureGate.js).
const { gateSpec } = require('../lib/featureGate');
gateSpec(test, __filename);
const { defineRoleMatrix } = require('../lib/roleMatrix');

defineRoleMatrix(test, 'user');
