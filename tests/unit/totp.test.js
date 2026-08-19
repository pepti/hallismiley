// TOTP (RFC 6238) — the primitive behind admin two-factor sign-in.
//
// The RFC 6238 Appendix B vectors are the point of this file. An in-house TOTP
// that is subtly wrong does not fail loudly; it produces plausible six-digit
// codes that simply never match what the user's authenticator app shows, and the
// only symptom is "2FA doesn't work" with nothing to debug. These vectors pin the
// implementation to the same numbers Google Authenticator computes.
const totp = require('../../server/utils/totp');

// RFC 6238 Appendix B, SHA-1 rows. The published secret is the ASCII string
// '12345678901234567890'; the RFC tabulates it as hex, we feed the same bytes.
const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS = [
  [59,          '287082'],
  [1111111109,  '081804'],
  [1111111111,  '050471'],
  [1234567890,  '005924'],
  [2000000000,  '279037'],
];

describe('TOTP — RFC 6238 test vectors (SHA-1, 6 digits, 30s)', () => {
  test.each(RFC_VECTORS)('T=%i produces %s', (unixSeconds, expected) => {
    expect(totp.codeForStep(RFC_SECRET, Math.floor(unixSeconds / 30))).toBe(expected);
  });

  test('verify() accepts the code for the current step', () => {
    const atMs = 1111111109 * 1000;
    expect(totp.verifyCode(RFC_SECRET, '081804', { atMs })).toEqual({ valid: true, step: Math.floor(1111111109 / 30) });
  });
});

describe('TOTP — base32', () => {
  test('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 64, 7]);
    expect(totp.base32Decode(totp.base32Encode(bytes))).toEqual(bytes);
  });

  test('tolerates the shapes humans and apps produce', () => {
    const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
    const spaced = secret.toLowerCase().replace(/(.{4})/g, '$1 ').trim();
    expect(totp.base32Decode(spaced)).toEqual(totp.base32Decode(secret));
    expect(totp.base32Decode(secret + '===')).toEqual(totp.base32Decode(secret));
  });

  test('rejects non-alphabet input rather than decoding it to something wrong', () => {
    // '0', '1' and '8' are deliberately absent from RFC 4648 base32 — they are the
    // characters people mistype for O, I and B. Returning null makes the caller
    // fail closed instead of verifying against a silently different secret.
    expect(totp.base32Decode('ABC018')).toBeNull();
    expect(totp.base32Decode('')).toBeNull();
    expect(totp.base32Decode(null)).toBeNull();
  });

  test('generateSecret produces a decodable 160-bit secret', () => {
    const s = totp.generateSecret();
    expect(totp.base32Decode(s)).toHaveLength(20);
    expect(totp.generateSecret()).not.toBe(s); // not a constant
  });
});

describe('TOTP — verification window', () => {
  const secret = totp.generateSecret();
  const atMs = 1_700_000_000_000;
  const step = Math.floor(atMs / 1000 / 30);

  test('accepts one step either side, for clock drift', () => {
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step - 1), { atMs }).valid).toBe(true);
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step),     { atMs }).valid).toBe(true);
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step + 1), { atMs }).valid).toBe(true);
  });

  test('rejects codes outside the window', () => {
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step - 2), { atMs }).valid).toBe(false);
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step + 2), { atMs }).valid).toBe(false);
  });

  test('window is configurable', () => {
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step - 2), { atMs, window: 2 }).valid).toBe(true);
    expect(totp.verifyCode(secret, totp.codeForStep(secret, step - 1), { atMs, window: 0 }).valid).toBe(false);
  });
});

describe('TOTP — replay prevention', () => {
  const secret = totp.generateSecret();
  const atMs = 1_700_000_000_000;
  const step = Math.floor(atMs / 1000 / 30);

  test('a step already spent is refused', () => {
    const code = totp.codeForStep(secret, step);
    const first = totp.verifyCode(secret, code, { atMs });
    expect(first).toEqual({ valid: true, step });

    // Same code, same 30s window, but the caller now knows that step is spent.
    // Without this an over-the-shoulder code stays usable for the rest of the window.
    expect(totp.verifyCode(secret, code, { atMs, lastUsedStep: first.step }).valid).toBe(false);
  });

  test('the NEXT step is still accepted after one is spent', () => {
    const next = totp.codeForStep(secret, step + 1);
    expect(totp.verifyCode(secret, next, { atMs, lastUsedStep: step }).valid).toBe(true);
  });
});

describe('TOTP — malformed input fails closed', () => {
  const secret = totp.generateSecret();

  test.each([
    ['empty',        ''],
    ['null',         null],
    ['undefined',    undefined],
    ['too short',    '12345'],
    ['too long',     '1234567'],
    ['non-numeric',  'abcdef'],
    ['mixed',        '12a456'],
  ])('rejects a %s code', (_label, code) => {
    expect(totp.verifyCode(secret, code).valid).toBe(false);
  });

  test('rejects everything when the stored secret is unusable', () => {
    // A corrupted or truncated secret column must not accidentally verify.
    expect(totp.verifyCode('not!valid!base32', '000000').valid).toBe(false);
    expect(totp.verifyCode('', '000000').valid).toBe(false);
  });
});

describe('TOTP — otpauth URI', () => {
  test('carries the parameters an authenticator app expects', () => {
    const uri = totp.otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'halli', issuer: 'Icelandic Store' });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    // Issuer appears both in the label and as a parameter — apps read either.
    expect(uri).toContain(encodeURIComponent('Icelandic Store:halli'));
    expect(uri).toContain('issuer=Icelandic+Store');
  });
});
