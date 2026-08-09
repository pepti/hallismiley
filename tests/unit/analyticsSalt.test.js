const { visitorToken, parseUserAgent, isBot } = require('../../server/services/analyticsSalt');

describe('visitorToken', () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36';

  test('produces a 22-char base64url token', () => {
    const tok = visitorToken('1.2.3.4', UA);
    expect(tok).toHaveLength(22);
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet
  });

  test('is deterministic for the same (ip, ua) within a day', () => {
    expect(visitorToken('1.2.3.4', UA)).toBe(visitorToken('1.2.3.4', UA));
  });

  test('differs by IP and by user-agent', () => {
    expect(visitorToken('1.2.3.4', UA)).not.toBe(visitorToken('9.9.9.9', UA));
    expect(visitorToken('1.2.3.4', UA)).not.toBe(visitorToken('1.2.3.4', UA + 'x'));
  });

  test('does not leak the raw IP or user-agent', () => {
    const tok = visitorToken('203.0.113.7', UA);
    expect(tok).not.toContain('203.0.113.7');
    expect(tok.toLowerCase()).not.toContain('windows');
  });

  test('tolerates missing inputs', () => {
    expect(visitorToken(undefined, undefined)).toHaveLength(22);
  });
});

describe('parseUserAgent', () => {
  const cases = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E Safari', 'mobile', 'Safari', 'iOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',       'desktop', 'Chrome', 'Windows'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari',                     'tablet', 'Safari', 'iOS'],
    ['Mozilla/5.0 (Linux; Android 13) AppleWebKit Chrome Mobile Safari',         'mobile', 'Chrome', 'Android'],
    ['Mozilla/5.0 (Linux; Android 13; SM-T500) AppleWebKit Chrome Safari',       'tablet', 'Chrome', 'Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/119',                'desktop', 'Firefox', 'macOS'],
  ];

  test.each(cases)('parses %s', (ua, device, browser, os) => {
    expect(parseUserAgent(ua)).toEqual({ device, browser, os });
  });

  test('flags crawlers as bots', () => {
    expect(parseUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)').device).toBe('bot');
    expect(isBot('Mozilla/5.0 facebookexternalhit/1.1')).toBe(true);
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
  });

  test('returns unknowns for an empty UA', () => {
    expect(parseUserAgent('')).toEqual({ device: 'unknown', browser: 'unknown', os: 'unknown' });
  });

  test('uses screen width as a tiebreaker for ambiguous desktop UAs', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit Chrome Safari';
    expect(parseUserAgent(ua, 360).device).toBe('mobile');
    expect(parseUserAgent(ua, 900).device).toBe('tablet');
    expect(parseUserAgent(ua, 1920).device).toBe('desktop');
  });
});
