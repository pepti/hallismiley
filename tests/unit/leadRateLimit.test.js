/**
 * The lead form's rate-limit POLICY.
 *
 * express-rate-limit is skipped entirely under NODE_ENV=test (otherwise every
 * integration suite would trip it), so an integration test can never observe
 * the configured numbers. Pinning the exported policy object here is what
 * keeps "5 per hour per IP" from being silently loosened.
 */
const contactRoutes = require('../../server/routes/contactRoutes');

describe('lead form rate-limit policy', () => {
  test('allows at most 5 submissions per IP', () => {
    expect(contactRoutes.LEAD_RATE_LIMIT.max).toBe(5);
  });

  test('the window is one hour', () => {
    expect(contactRoutes.LEAD_RATE_LIMIT.windowMs).toBe(60 * 60 * 1000);
  });
});
