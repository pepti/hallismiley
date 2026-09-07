// The 2FA gate's role predicate (server/services/mfaService.js). Widened
// 2026-09-07 (ENHANCEMENTS #17): a seller holding the `accounts` view —
// precomputed by the login flow as `accounts_holder` — is protected exactly
// like an admin, because they reach customer data and deploy to customers.
const { isProtected, shouldEnrol } = require('../../server/services/mfaService');

describe('mfaService role predicate', () => {
  test('admin with TOTP is protected; without it should enrol', () => {
    expect(isProtected({ role: 'admin', totp_enabled: true })).toBe(true);
    expect(shouldEnrol({ role: 'admin', totp_enabled: false })).toBe(true);
  });

  test('admin-anywhere (role set) counts like a primary admin', () => {
    expect(isProtected({ role: 'user', admin_anywhere: true, totp_enabled: true })).toBe(true);
    expect(shouldEnrol({ role: 'user', admin_anywhere: true, totp_enabled: false })).toBe(true);
  });

  test('an accounts holder is protected like an admin', () => {
    expect(isProtected({ role: 'solumadur', accounts_holder: true, totp_enabled: true })).toBe(true);
    expect(shouldEnrol({ role: 'solumadur', accounts_holder: true, totp_enabled: false })).toBe(true);
  });

  test('a plain user or a handbook-only seller is not', () => {
    expect(isProtected({ role: 'user', totp_enabled: true })).toBe(false);
    expect(shouldEnrol({ role: 'solufolk', accounts_holder: false, totp_enabled: false })).toBe(false);
    expect(isProtected(null)).toBe(false);
  });
});
