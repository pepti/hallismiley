const { parse, isValid, compare, isNewer, gte } = require('../../server/utils/semver');

describe('parse', () => {
  test('accepts plain releases', () => {
    expect(parse('1.4.2')).toEqual({ major: 1, minor: 4, patch: 2, prerelease: [] });
  });

  test('accepts prerelease and build metadata', () => {
    expect(parse('1.0.0-rc.1+build.7')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ['rc', '1'] });
  });

  test('rejects everything that is not semver', () => {
    for (const bad of ['dev', 'v1.4.2', '1.4', '1.4.2.3', '01.2.3', '', null, undefined, 42, '1.2.3-']) {
      expect(parse(bad)).toBeNull();
      expect(isValid(bad)).toBe(false);
    }
  });
});

describe('compare', () => {
  test('orders by major, then minor, then patch', () => {
    expect(compare('2.0.0', '1.9.9')).toBe(1);
    expect(compare('1.10.0', '1.9.0')).toBe(1);   // numeric, not lexical
    expect(compare('1.0.10', '1.0.9')).toBe(1);
    expect(compare('1.0.0', '1.0.0')).toBe(0);
    expect(compare('1.0.0', '1.0.1')).toBe(-1);
  });

  test('a prerelease ranks below its release', () => {
    expect(compare('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compare('1.0.0', '1.0.0-rc.1')).toBe(1);
  });

  test('prerelease identifiers follow semver precedence', () => {
    expect(compare('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);   // fewer identifiers ranks lower
    expect(compare('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1); // numeric below alphanumeric
    expect(compare('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);  // numeric compares numerically
    expect(compare('1.0.0-rc.1', '1.0.0-beta.11')).toBe(1);
  });

  test('build metadata is ignored', () => {
    expect(compare('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  test('an uncomparable version is null, never 0', () => {
    // The distinction is load-bearing: treating "cannot compare" as "equal"
    // would make a dev build silently up to date instead of out of scope.
    expect(compare('dev', '1.0.0')).toBeNull();
    expect(compare('1.0.0', 'dev')).toBeNull();
    expect(compare('dev', 'dev')).toBeNull();
  });
});

describe('isNewer / gte — unknown never means yes', () => {
  test('isNewer is strict', () => {
    expect(isNewer('1.4.2', '1.4.1')).toBe(true);
    expect(isNewer('1.4.2', '1.4.2')).toBe(false);
    expect(isNewer('1.4.1', '1.4.2')).toBe(false);
  });

  test('a dev build is never newer and never compatible', () => {
    expect(isNewer('1.4.2', 'dev')).toBe(false);
    expect(isNewer('dev', '1.4.2')).toBe(false);
    expect(gte('dev', '1.0.0')).toBe(false);
  });

  test('gte accepts equal and greater', () => {
    expect(gte('1.3.0', '1.3.0')).toBe(true);
    expect(gte('1.4.0', '1.3.0')).toBe(true);
    expect(gte('1.2.0', '1.3.0')).toBe(false);
  });
});
