const { parseArgs, build, extractChangelog } = require('../../scripts/build-manifest.js');
const { validateManifest } = require('../../server/services/updateChecker');

const DIGEST = 'sha256:' + 'a'.repeat(64);
const argv = (...args) => ['node', 'build-manifest.js', ...args];

describe('parseArgs', () => {
  test('accepts a complete promotion', () => {
    const args = parseArgs(argv(
      '--channel=canary', `--digest=${DIGEST}`, '--version=1.4.2',
      '--min-compatible=1.3.0', '--critical', '--published-at=2026-08-10T03:00:00Z'
    ));
    expect(args).toMatchObject({
      channel: 'canary', digest: DIGEST, version: '1.4.2',
      minCompatible: '1.3.0', critical: true,
    });
  });

  test('defaults the version to package.json', () => {
    const pkg = require('../../package.json');
    expect(parseArgs(argv('--channel=stable', `--digest=${DIGEST}`)).version).toBe(pkg.version);
  });

  test('a TAG is refused where a digest is required', () => {
    // The whole point of the manifest: a tag is mutable, a digest is not. A
    // manifest naming ":stable" would mean "whatever that points at today".
    for (const bad of ['latest', 'stable', 'sha256:short', '', undefined, 'sha256:' + 'A'.repeat(64)]) {
      expect(() => parseArgs(argv('--channel=stable', `--digest=${bad}`))).toThrow(/digest/);
    }
  });

  test('an unknown channel is refused', () => {
    expect(() => parseArgs(argv('--channel=beta', `--digest=${DIGEST}`))).toThrow(/channel/);
    expect(() => parseArgs(argv(`--digest=${DIGEST}`))).toThrow(/channel/);
  });

  test('a non-semver version or min-compatible is refused', () => {
    expect(() => parseArgs(argv('--channel=stable', `--digest=${DIGEST}`, '--version=v1.4.2'))).toThrow(/semver/);
    expect(() => parseArgs(argv('--channel=stable', `--digest=${DIGEST}`, '--min-compatible=1.x'))).toThrow(/semver/);
  });

  test('an unparseable published-at is refused', () => {
    expect(() => parseArgs(argv('--channel=stable', `--digest=${DIGEST}`, '--published-at=soon'))).toThrow(/ISO 8601/);
  });

  test('a typo in a flag is an error, not a silently ignored option', () => {
    expect(() => parseArgs(argv('--channel=stable', `--digest=${DIGEST}`, '--criticall'))).toThrow(/Unrecognised/);
  });
});

describe('extractChangelog', () => {
  const md = [
    '# Changelog', '',
    '## [1.4.2] — 2026-08-10', '', '- Fixed the thing', '',
    '## [1.4.1] — 2026-08-01', '', '- Older thing', '',
  ].join('\n');

  test('pulls exactly one release section', () => {
    const out = extractChangelog(md, '1.4.2');
    expect(out).toContain('## [1.4.2]');
    expect(out).toContain('Fixed the thing');
    expect(out).not.toContain('1.4.1');
    expect(out).not.toContain('Older thing');
  });

  test('handles a heading without brackets', () => {
    expect(extractChangelog('## 2.0.0\n\n- new\n', '2.0.0')).toContain('- new');
  });

  test('a missing section is empty, not fatal — notes must never block a release', () => {
    expect(extractChangelog(md, '9.9.9')).toBe('');
    expect(extractChangelog(null, '1.0.0')).toBe('');
  });

  test('does not match a version that merely starts the same', () => {
    expect(extractChangelog('## [1.4.20] — x\n\n- twenty\n', '1.4.2')).toBe('');
  });
});

describe('build — and the fleet accepts what it builds', () => {
  const args = (over = {}) => ({ channel: 'stable', digest: DIGEST, version: '1.4.2', ...over });

  test('produces a manifest the deployed instances validate', () => {
    // The publisher and the consumer share one schema by construction: this is
    // literally the function every instance runs on the fetched document.
    const result = validateManifest(build(args()));
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({ version: '1.4.2', imageDigest: DIGEST, critical: false });
  });

  test('carries the critical flag through', () => {
    expect(validateManifest(build(args({ critical: true }))).manifest.critical).toBe(true);
  });

  test('minCompatibleVersion is present only when the release constrains the path', () => {
    expect(build(args())).not.toHaveProperty('minCompatibleVersion');
    expect(build(args({ minCompatible: '1.3.0' })).minCompatibleVersion).toBe('1.3.0');
  });

  test('publishedAt is normalised to ISO 8601', () => {
    expect(build(args({ publishedAt: '2026-08-10T03:00:00Z' })).publishedAt).toBe('2026-08-10T03:00:00.000Z');
    expect(() => new Date(build(args()).publishedAt).toISOString()).not.toThrow();
  });

  test('a version with no changelog section still publishes', () => {
    const manifest = build(args({ version: '9.9.9' }));
    expect(manifest.changelogMd).toBe('');
    expect(validateManifest(manifest).ok).toBe(true);
  });
});
