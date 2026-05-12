'use strict';

/**
 * INTENTIONALLY FAILING TEST — do not merge.
 *
 * Verification artifact for the PR #46 deploy gate. The plan called for
 * "push a deliberately-failing test branch in a PR, confirm CI goes red
 * AND the Deploy workflow does not run." This file is the deliberately
 * failing test; the PR will be closed without merging once CI confirms
 * the negative path.
 */

describe('deploy-gate negative-path verification', () => {
  test('this test fails on purpose', () => {
    expect(true).toBe(false);
  });
});
