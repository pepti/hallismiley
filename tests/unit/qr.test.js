// QR generation for TOTP enrolment.
//
// There is no decoder in the test stack, so these assert STRUCTURE rather than
// "this scans". That distinction is worth being honest about: the definitive
// check is a real phone camera, done once at enrolment. What these catch is the
// class of failure that would otherwise reach that phone — an empty or malformed
// SVG, a missing quiet zone, a code that silently stops encoding the payload, or
// the colours drifting to something unscannable on a dark theme.
const qr = require('../../server/utils/qr');
const totp = require('../../server/utils/totp');

const URI = totp.otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'halli', issuer: 'Icelandic Store' });

function decodeDataUri(dataUri) {
  const m = /^data:image\/svg\+xml;base64,(.+)$/.exec(dataUri);
  if (!m) return null;
  return Buffer.from(m[1], 'base64').toString('utf8');
}

describe('QR — data URI shape', () => {
  test('returns a base64 SVG data URI', () => {
    const uri = qr.svgDataUri(URI);
    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = decodeDataUri(uri);
    expect(svg.trim()).toMatch(/^<svg/);
    expect(svg).toContain('</svg>');
  });

  test('the data URI is usable as an <img src> under the CSP', () => {
    // The CSP allows `img-src 'self' data: https:` — a data: URI needs no policy
    // change, where inline <svg> markup would mean innerHTML-ing a response.
    const uri = qr.svgDataUri(URI);
    expect(uri.startsWith('data:')).toBe(true);
    expect(uri).not.toMatch(/<script/i);
  });

  test('is deterministic for the same input', () => {
    expect(qr.svgDataUri(URI)).toBe(qr.svgDataUri(URI));
  });

  test('different secrets produce different codes', () => {
    const other = totp.otpauthUri({ secret: totp.generateSecret(), account: 'halli', issuer: 'Icelandic Store' });
    expect(qr.svgDataUri(URI)).not.toBe(qr.svgDataUri(other));
  });

  test('refuses to encode nothing', () => {
    expect(() => qr.svgDataUri('')).toThrow();
    expect(() => qr.svgDataUri(null)).toThrow();
    // Both entry points must agree on what is encodable, so a caller cannot
    // pre-validate with matrix() and then have svgDataUri() reject the same input.
    expect(() => qr.matrix('')).toThrow();
  });

  test('signals an over-capacity payload rather than returning something broken', () => {
    // qrcode-generator refuses payloads past QR version 40, and does it by
    // throwing a bare STRING ('code length overflow.') rather than an Error —
    // which is exactly why mfaService catches around this call instead of
    // letting it reach the error middleware. Pinned so a library change that
    // starts returning a truncated code instead would fail loudly here.
    expect(() => qr.svgDataUri('x'.repeat(3000))).toThrow();
  });
});

describe('QR — colours must stay scannable', () => {
  // The site ships dark themes. A QR that inherits the page palette looks
  // tasteful and cannot be read by a camera, so the white background and black
  // modules are pinned here rather than left to CSS.
  test('renders black modules on an explicit white background', () => {
    const svg = decodeDataUri(qr.svgDataUri(URI));
    expect(svg).toMatch(/fill="white"/);
    expect(svg).toMatch(/fill="black"/);
    // No currentColor / CSS variable that a theme could repaint.
    expect(svg).not.toMatch(/currentColor|var\(--/);
  });
});

describe('QR — structure', () => {
  test('has a quiet zone, without which scanners fail', () => {
    const svg = decodeDataUri(qr.svgDataUri(URI));
    const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(m).not.toBeNull();
    const [, w] = m;
    const { size } = qr.matrix(URI);
    // viewBox width = (modules + 2 × margin) × cellSize, so it must exceed the
    // bare module count — that difference IS the quiet zone.
    expect(Number(w)).toBeGreaterThan(size);
  });

  test('carries the three finder patterns', () => {
    // Top-left, top-right and bottom-left corners are dark in every valid QR.
    // If encoding silently produced an empty matrix these would be false.
    const { size, isDark } = qr.matrix(URI);
    expect(isDark(0, 0)).toBe(true);
    expect(isDark(0, size - 1)).toBe(true);
    expect(isDark(size - 1, 0)).toBe(true);
    // The bottom-right corner has no finder pattern — a matrix that is dark
    // everywhere would pass the three checks above but not this one.
    expect(isDark(size - 1, size - 1)).toBe(false);
  });

  test('grows with the payload, i.e. it is actually encoding the data', () => {
    const small = qr.matrix('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP').size;
    const large = qr.matrix(URI + '&extra=' + 'x'.repeat(200)).size;
    expect(large).toBeGreaterThan(small);
  });

  test('encodes a full otpauth URI without throwing', () => {
    // Real enrolment URIs carry issuer, algorithm, digits and period; the
    // longest realistic case is an email-shaped account label.
    const long = totp.otpauthUri({
      secret: totp.generateSecret(),
      account: 'a.very.long.email.address@a-long-domain-name.example.com',
      issuer: 'Icelandic Store',
    });
    expect(() => qr.svgDataUri(long)).not.toThrow();
    expect(qr.matrix(long).size).toBeGreaterThan(20);
  });
});
