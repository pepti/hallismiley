const {
  assertAllowedUrl, isAllowedUrl, allowedHosts, OutboundBlockedError,
} = require('../../server/services/outboundAllowlist');

const CONFIGURED = 'https://releases.orangesmiley.is/store/stable.json';

let savedEnv;
beforeEach(() => { savedEnv = process.env.OUTBOUND_ALLOWED_HOSTS; delete process.env.OUTBOUND_ALLOWED_HOSTS; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.OUTBOUND_ALLOWED_HOSTS;
  else process.env.OUTBOUND_ALLOWED_HOSTS = savedEnv;
});

const blocked = (url) => {
  expect(() => assertAllowedUrl(url)).toThrow(OutboundBlockedError);
  expect(isAllowedUrl(url)).toBe(false);
};

describe('allowedHosts', () => {
  test('the configured manifest host is allowed by construction', () => {
    expect(allowedHosts().has('releases.orangesmiley.is')).toBe(true);
  });

  test('the env var adds hosts, case-insensitively and trimmed', () => {
    process.env.OUTBOUND_ALLOWED_HOSTS = ' Releases.Example.COM , other.example.com ';
    const hosts = allowedHosts();
    expect(hosts.has('releases.example.com')).toBe(true);
    expect(hosts.has('other.example.com')).toBe(true);
  });

  test('the env var is read per call, not cached at require time', () => {
    expect(isAllowedUrl('https://late.example.com/x.json')).toBe(false);
    process.env.OUTBOUND_ALLOWED_HOSTS = 'late.example.com';
    expect(isAllowedUrl('https://late.example.com/x.json')).toBe(true);
  });
});

describe('assertAllowedUrl — what gets through', () => {
  test('the configured manifest URL', () => {
    expect(assertAllowedUrl(CONFIGURED).hostname).toBe('releases.orangesmiley.is');
  });

  test('an explicit :443 is the default port, so it is fine', () => {
    expect(assertAllowedUrl('https://releases.orangesmiley.is:443/x.json').hostname)
      .toBe('releases.orangesmiley.is');
  });
});

describe('assertAllowedUrl — what gets blocked', () => {
  test('plaintext http, even to an allowed host', () => {
    // The manifest names the image digest we will run; a plaintext fetch lets
    // anyone on the path choose that digest.
    blocked('http://releases.orangesmiley.is/store/stable.json');
  });

  test('a host that is not on the list', () => {
    blocked('https://evil.example.com/stable.json');
  });

  test('a suffix that merely LOOKS like an allowed host', () => {
    // The classic naive-endsWith bypass.
    blocked('https://releases.orangesmiley.is.evil.example.com/stable.json');
    blocked('https://notreleases.orangesmiley.is/stable.json');
  });

  test('IP literals — how SSRF reaches cloud metadata', () => {
    blocked('https://169.254.169.254/latest/meta-data/');
    blocked('https://127.0.0.1/stable.json');
    blocked('https://[::1]/stable.json');
  });

  test('localhost by name', () => {
    blocked('https://localhost/stable.json');
    blocked('https://api.localhost/stable.json');
  });

  test('credentials embedded in the URL', () => {
    blocked('https://user:pass@releases.orangesmiley.is/stable.json');
  });

  test('a non-default port on an allowed host', () => {
    blocked('https://releases.orangesmiley.is:8443/stable.json');
  });

  test('other schemes', () => {
    blocked('file:///etc/passwd');
    blocked('ftp://releases.orangesmiley.is/stable.json');
  });

  test('garbage', () => {
    blocked('not a url');
    blocked('');
    blocked(null);
  });

  test('the error carries a 502 — a blocked fetch is an upstream fault', () => {
    try {
      assertAllowedUrl('https://evil.example.com/x');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OutboundBlockedError);
      expect(err.status).toBe(502);
      expect(err.message).toContain('allowlist');
    }
  });
});
