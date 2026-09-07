/**
 * The leads inbox's retention POLICY.
 *
 * /personuvernd §6 promises enquiries are deleted 24 months after receipt.
 * The number lives in one place (server/services/leadsCleanup.js) and is
 * pinned here so it cannot be silently loosened without the policy text
 * moving with it (PrivacyView.js header comment).
 */
const { RETENTION_DAYS } = require('../../server/services/leadsCleanup');

describe('leads retention policy', () => {
  test('defaults to 730 days (24 months, the /personuvernd promise)', () => {
    expect(RETENTION_DAYS).toBe(730);
  });
});
