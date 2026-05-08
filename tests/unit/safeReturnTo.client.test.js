'use strict';

/**
 * Unit tests for the client-side returnTo validator at
 * public/js/utils/safeReturnTo.js. SignupView.js reads `signupReturnTo`
 * from sessionStorage (which any same-origin script can write to) and
 * navigates to it after signup, so the value must be re-validated client-side
 * before being trusted.
 *
 * The module is authored as ESM but Jest's babel-jest transform (configured
 * via babel.config.js with @babel/preset-env) compiles it to CJS for require().
 */

const { isSafeReturnTo } = require('../../public/js/utils/safeReturnTo');

describe('safeReturnTo (client) — isSafeReturnTo', () => {
  test('accepts simple absolute paths', () => {
    expect(isSafeReturnTo('/')).toBe(true);
    expect(isSafeReturnTo('/party')).toBe(true);
    expect(isSafeReturnTo('/en/projects/123')).toBe(true);
    expect(isSafeReturnTo('/shop?category=mugs')).toBe(true);
  });

  test('rejects values that do not start with /', () => {
    expect(isSafeReturnTo('party')).toBe(false);
    expect(isSafeReturnTo('./party')).toBe(false);
    expect(isSafeReturnTo('../party')).toBe(false);
  });

  test('rejects protocol-relative URLs', () => {
    expect(isSafeReturnTo('//evil.com')).toBe(false);
    expect(isSafeReturnTo('//evil.com/phish')).toBe(false);
  });

  test('rejects backslash (browsers normalize \\ → /)', () => {
    expect(isSafeReturnTo('/\\evil.com')).toBe(false);
    expect(isSafeReturnTo('/foo\\bar')).toBe(false);
    expect(isSafeReturnTo('\\evil.com')).toBe(false);
  });

  test('rejects percent-encoded backslash (%5c, %5C)', () => {
    expect(isSafeReturnTo('/%5cevil.com')).toBe(false);
    expect(isSafeReturnTo('/%5Cevil.com')).toBe(false);
    expect(isSafeReturnTo('/foo%5cbar')).toBe(false);
  });

  test('rejects null bytes (raw and percent-encoded)', () => {
    expect(isSafeReturnTo('/foo\0bar')).toBe(false);
    expect(isSafeReturnTo('/foo%00bar')).toBe(false);
    expect(isSafeReturnTo('/%00')).toBe(false);
  });

  test('rejects absolute URLs and embedded schemes', () => {
    expect(isSafeReturnTo('http://evil.com')).toBe(false);
    expect(isSafeReturnTo('https://evil.com')).toBe(false);
    expect(isSafeReturnTo('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnTo('/redirect?next=https://evil.com')).toBe(false);
  });

  test('rejects nullish / non-string values', () => {
    expect(isSafeReturnTo('')).toBe(false);
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo(123)).toBe(false);
    expect(isSafeReturnTo({})).toBe(false);
  });

  test('rejects values longer than 500 chars', () => {
    expect(isSafeReturnTo('/' + 'a'.repeat(500))).toBe(false);
    expect(isSafeReturnTo('/' + 'a'.repeat(499))).toBe(true);
  });
});
