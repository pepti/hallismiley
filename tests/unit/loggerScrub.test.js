// URL secret-scrubbing in the pino req serializer — server/observability/logger.js.
//
// Password-reset / email-verify links carry their single-use secret in the
// query string, and the OAuth callbacks carry code+state. The std req
// serializer logs req.url verbatim, so without scrubbing those secrets land in
// the log sink. The param NAME is kept (logs stay debuggable), only its value
// is redacted.
const { scrubUrl } = require('../../server/observability/logger');

describe('logger scrubUrl', () => {
  test('redacts reset/verify tokens in the query string', () => {
    expect(scrubUrl('/en/reset-password?token=abc123&x=1'))
      .toBe('/en/reset-password?token=[REDACTED]&x=1');
    expect(scrubUrl('/en/verify-email?verify=s3cret'))
      .toBe('/en/verify-email?verify=[REDACTED]');
  });

  test('redacts OAuth code and state', () => {
    expect(scrubUrl('/auth/facebook/callback?code=AQBx&state=xyz'))
      .toBe('/auth/facebook/callback?code=[REDACTED]&state=[REDACTED]');
  });

  test('redacts api keys in either spelling', () => {
    expect(scrubUrl('/x?api_key=k1&api-key=k2&apikey=k3'))
      .toBe('/x?api_key=[REDACTED]&api-key=[REDACTED]&apikey=[REDACTED]');
  });

  test('is case-insensitive on the param name', () => {
    expect(scrubUrl('/x?TOKEN=abc')).toBe('/x?TOKEN=[REDACTED]');
  });

  test('leaves URLs without a query string alone', () => {
    expect(scrubUrl('/en/reset-password')).toBe('/en/reset-password');
    expect(scrubUrl('/assets/img.png')).toBe('/assets/img.png');
  });

  test('leaves unrelated params alone and survives non-strings', () => {
    expect(scrubUrl('/shop?category=mugs&page=2')).toBe('/shop?category=mugs&page=2');
    expect(scrubUrl(undefined)).toBeUndefined();
    expect(scrubUrl(null)).toBeNull();
  });

  test('stops at a fragment boundary', () => {
    expect(scrubUrl('/x?token=abc#section')).toBe('/x?token=[REDACTED]#section');
  });
});
