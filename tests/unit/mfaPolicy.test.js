// auth/mfaPolicy.js, utils/secretBox.js, utils/safeEqual.js — DB-free.
// The HTTP behaviour lives in tests/integration/adminTotpEnforcement.test.js.
//
// Harvested from rekstrarkerfid (2026-09-18) on 2026-09-23. The engine's gate
// is wider than rk's (mfaService.protectedRole: admin OR `accounts` holder OR
// published seller), so the policy here withholds the ROLE for an admin and
// the VIEW for an accounts holder; the seller routes ask for totp_enabled
// themselves. The cases below pin all three.
const mfaPolicy = require('../../server/auth/mfaPolicy');
const secretBox = require('../../server/utils/secretBox');
const { safeEqual } = require('../../server/utils/safeEqual');

const ENV = ['NODE_ENV', 'ADMIN_TOTP_EXEMPT', 'TOTP_ENC_KEY', 'CLIENT_CONFIG_SECURITY_MFA_ENROLMENT'];
// The mandatory path is `security.mfa.enrolment: required`; the instance
// default is `optional` (mfa-optional-2026-09-23). Each describe that pins the
// mandatory rule asks for it; the policy reads the variable per call.
const REQUIRE = () => { process.env.CLIENT_CONFIG_SECURITY_MFA_ENROLMENT = 'required'; };
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const admin = (over = {}) => ({ id: 'u1', username: 'Halli', role: 'admin', totp_enabled: false, ...over });

describe('mustEnrol', () => {
  beforeEach(() => { REQUIRE(); delete process.env.ADMIN_TOTP_EXEMPT; });

  test('an admin without TOTP must; with it, or without the role, need not', () => {
    expect(mfaPolicy.mustEnrol(admin())).toBe(true);
    expect(mfaPolicy.mustEnrol(admin({ totp_enabled: true }))).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ role: 'moderator' }))).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ role: 'user' }), ['user', 'admin'])).toBe(true);   // admin by role set
  });

  test('totp_enabled has to be literally true — a missing column value is not enrolment', () => {
    expect(mfaPolicy.mustEnrol(admin({ totp_enabled: undefined }))).toBe(true);
    expect(mfaPolicy.mustEnrol(admin({ totp_enabled: 'true' }))).toBe(true);
  });

  test('the wider engine gate: an accounts holder and a published seller must enrol too', () => {
    expect(mfaPolicy.mustEnrol(admin({ role: 'solumadur', accounts_holder: true }), ['solumadur'])).toBe(true);
    expect(mfaPolicy.mustEnrol(admin({ role: 'user', seller_holder: true }), ['user'])).toBe(true);
    expect(mfaPolicy.mustEnrol(admin({ role: 'solufolk', accounts_holder: false }), ['solufolk'])).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ role: 'solumadur', accounts_holder: true, totp_enabled: true }), ['solumadur'])).toBe(false);
  });
});

describe('ADMIN_TOTP_EXEMPT', () => {
  beforeEach(REQUIRE);

  test('exempts by username (case-insensitive) or * outside production', () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_TOTP_EXEMPT = 'someone, halli';
    expect(mfaPolicy.mustEnrol(admin())).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ username: 'other' }))).toBe(true);
    process.env.ADMIN_TOTP_EXEMPT = '*';
    expect(mfaPolicy.mustEnrol(admin({ username: 'other' }))).toBe(false);
  });

  test('is IGNORED when NODE_ENV=production — which includes the Azure TEST stack', () => {
    process.env.NODE_ENV = 'production';
    for (const value of ['*', 'halli']) {
      process.env.ADMIN_TOTP_EXEMPT = value;
      expect(mfaPolicy.isExempt(admin())).toBe(false);
      expect(mfaPolicy.mustEnrol(admin())).toBe(true);
    }
  });
});

describe('applyMfaPolicy', () => {
  beforeEach(() => { REQUIRE(); delete process.env.ADMIN_TOTP_EXEMPT; });

  test('withholds admin in place and always leaves roles set', () => {
    const u = mfaPolicy.applyMfaPolicy(admin(), ['admin']);
    expect(u).toMatchObject({ role: 'user', roles: ['user'], mfaEnrolmentRequired: true });
  });

  test('keeps the other roles, and promotes one to primary when admin was primary', () => {
    const u = mfaPolicy.applyMfaPolicy(admin(), ['admin', 'moderator', 'lager']);
    expect(u).toMatchObject({ role: 'moderator', roles: ['moderator', 'lager'] });
  });

  test('without a resolved role set (a reader that only knows the primary) the primary role is still vetted', () => {
    expect(mfaPolicy.applyMfaPolicy(admin())).toMatchObject({ role: 'user', roles: ['user'] });
    const mod = mfaPolicy.applyMfaPolicy(admin({ role: 'moderator' }));
    expect(mod).toMatchObject({ role: 'moderator', roles: ['moderator'] });
    expect(mod.mfaEnrolmentRequired).toBeUndefined();
  });

  test('an enrolled admin passes through untouched', () => {
    const u = mfaPolicy.applyMfaPolicy(admin({ totp_enabled: true }), ['admin']);
    expect(u).toMatchObject({ role: 'admin', roles: ['admin'] });
    expect(u.mfaEnrolmentRequired).toBeUndefined();
  });

  test('an accounts holder keeps its roles — the flag is set, the VIEW is what gets withheld', () => {
    const u = mfaPolicy.applyMfaPolicy(admin({ role: 'solumadur', accounts_holder: true }), ['solumadur']);
    expect(u).toMatchObject({ role: 'solumadur', roles: ['solumadur'], mfaEnrolmentRequired: true });
  });
});

describe('withholdViews', () => {
  test('strips accounts and the wildcard only while enrolment is owed', () => {
    const views = ['handbok', 'leads', 'accounts', 'commission'];
    expect(mfaPolicy.withholdViews(views, true)).toEqual(['handbok', 'leads', 'commission']);
    expect(mfaPolicy.withholdViews(['*'], true)).toEqual([]);
    expect(mfaPolicy.withholdViews(views, false)).toBe(views);
    expect(mfaPolicy.viewsHoldProtected(['*'])).toBe(true);
    expect(mfaPolicy.viewsHoldProtected(['handbok'])).toBe(false);
  });
});

describe('applyMfaPolicyToRequest', () => {
  beforeEach(() => { REQUIRE(); delete process.env.ADMIN_TOTP_EXEMPT; });

  test('uses an accounts flag the caller already resolved without looking views up', async () => {
    const req = { user: admin({ role: 'solumadur', accounts_holder: true, roles: ['solumadur'] }) };
    await mfaPolicy.applyMfaPolicyToRequest(req);
    expect(req.user).toMatchObject({ role: 'solumadur', roles: ['solumadur'], mfaEnrolmentRequired: true });
  });

  test('an admin is decided from the role set alone', async () => {
    const req = { user: admin({ roles: ['admin'] }) };
    await mfaPolicy.applyMfaPolicyToRequest(req);
    expect(req.user).toMatchObject({ role: 'user', roles: ['user'], mfaEnrolmentRequired: true });
  });
});

describe('security.mfa.enrolment = optional (the default, mfa-optional-2026-09-23)', () => {
  beforeEach(() => {
    delete process.env.CLIENT_CONFIG_SECURITY_MFA_ENROLMENT;
    delete process.env.ADMIN_TOTP_EXEMPT;
  });

  test('this instance resolves to optional', () => {
    expect(mfaPolicy.ENROLMENT_ENV).toBe('CLIENT_CONFIG_SECURITY_MFA_ENROLMENT');
    expect(mfaPolicy.enrolmentMode()).toBe('optional');
    expect(mfaPolicy.enrolmentRequired()).toBe(false);
  });

  test('nobody must enrol — admin, admin by role set, accounts holder, published seller', () => {
    expect(mfaPolicy.mustEnrol(admin())).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ role: 'user' }), ['user', 'admin'])).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ role: 'solumadur', accounts_holder: true }), ['solumadur'])).toBe(false);
    expect(mfaPolicy.mustEnrol(admin({ role: 'user', seller_holder: true }), ['user'])).toBe(false);
  });

  test('an unenrolled admin keeps admin; an accounts holder keeps its roles and no flag is set', () => {
    const a = mfaPolicy.applyMfaPolicy(admin(), ['admin', 'moderator']);
    expect(a).toMatchObject({ role: 'admin', roles: ['admin', 'moderator'] });
    expect(a.mfaEnrolmentRequired).toBeUndefined();
    const s = mfaPolicy.applyMfaPolicy(admin({ role: 'solumadur', accounts_holder: true }), ['solumadur']);
    expect(s.mfaEnrolmentRequired).toBeUndefined();
    expect(mfaPolicy.effectiveRoles(admin(), ['admin'])).toEqual({ role: 'admin', roles: ['admin'], enrolmentRequired: false });
  });

  test('the per-request form looks nothing up and withholds nothing', async () => {
    const req = { user: admin({ role: 'solumadur', roles: ['solumadur'] }) };
    await mfaPolicy.applyMfaPolicyToRequest(req);
    expect(req.user.accounts_holder).toBeUndefined();   // no Role lookup under optional
    expect(req.user.mfaEnrolmentRequired).toBeUndefined();
  });

  test('a value the schema rejects is ignored, as clientConfig ignored it at boot', () => {
    process.env.CLIENT_CONFIG_SECURITY_MFA_ENROLMENT = 'REQUIRED';
    expect(mfaPolicy.enrolmentMode()).toBe('optional');
    expect(mfaPolicy.mustEnrol(admin())).toBe(false);
  });

  test('`required` restores the withholding on the next call', () => {
    REQUIRE();
    expect(mfaPolicy.enrolmentMode()).toBe('required');
    expect(mfaPolicy.applyMfaPolicy(admin(), ['admin'])).toMatchObject({ role: 'user', roles: ['user'], mfaEnrolmentRequired: true });
  });
});

describe('secretBox', () => {
  test('round-trips, never repeats a ciphertext, and binds to its associated data', () => {
    const a = secretBox.seal('JBSWY3DPEHPK3PXP', 'user-1');
    const b = secretBox.seal('JBSWY3DPEHPK3PXP', 'user-1');
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(secretBox.open(a, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => secretBox.open(a, 'user-2')).toThrow();
  });

  test('rejects a tampered value and a value sealed under another key', () => {
    const sealed = secretBox.seal('secret', 'u');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => secretBox.open(parts.join(':'), 'u')).toThrow();

    process.env.TOTP_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => secretBox.open(sealed, 'u')).toThrow();
  });

  test('accepts a hex key; refuses a key of the wrong length; unset means not configured', () => {
    process.env.TOTP_ENC_KEY = 'ab'.repeat(32);
    expect(secretBox.open(secretBox.seal('x', 'u'), 'u')).toBe('x');

    process.env.TOTP_ENC_KEY = 'too-short';
    expect(() => secretBox.isConfigured()).toThrow(/32 bytes/);

    delete process.env.TOTP_ENC_KEY;
    expect(secretBox.isConfigured()).toBe(false);
    expect(() => secretBox.seal('x', 'u')).toThrow(/not configured/);
  });
});

describe('safeEqual', () => {
  test('equal strings only — no prefixes, no length tricks, no non-strings', () => {
    expect(safeEqual('Bearer abc', 'Bearer abc')).toBe(true);
    expect(safeEqual('Bearer ab', 'Bearer abc')).toBe(false);
    expect(safeEqual('Bearer abcd', 'Bearer abc')).toBe(false);
    expect(safeEqual('', 'Bearer abc')).toBe(false);
    expect(safeEqual(undefined, 'Bearer abc')).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});
