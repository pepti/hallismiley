'use strict';

/**
 * tests/lib/featureGate.js — the derived skip for a downstream that hides,
 * disables or forks an engine feature (features/local.json), and for the
 * files of another product that arrive by merge and stay inert.
 *
 * Pinned here: in the ENGINE nothing is gated (local.json is empty and every
 * feature is the engine's or this product's); every e2e spec and every jest
 * suite maps to a feature through the registry's paths, so the mapping is
 * never hand-kept; and a temp local.json marking `public-site: hidden` makes
 * the gate skip exactly the public-site specs, carrying the note.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createGate, defaultGate, describeFor, describeForSpec, readLocal, globRe, GATED_STATUSES,
} = require('../lib/featureGate');
const { ROOT, tree } = require('../lib/sourceTree');

const specs = [...tree].filter((p) => /^e2e\/[^/]+\.spec\.js$/.test(p));
const suites = [...tree].filter((p) => /^tests\/(unit|integration)\/[^/]+\.test\.js$/.test(p));

describe('in the engine nothing is gated', () => {
  const g = defaultGate();

  test('features/local.json carries no overrides', () => {
    expect(g.local).toEqual({});
  });

  test('every e2e spec belongs to a feature and runs', () => {
    expect(specs.length).toBeGreaterThan(10); // guard
    const unmapped = specs.filter((p) => g.featureFor(p) === null);
    expect(unmapped).toEqual([]);
    const gated = specs.filter((p) => g.gateForSpec(p).skip);
    expect(gated).toEqual([]);
  });

  test('every jest suite belongs to a feature and runs', () => {
    expect(suites.length).toBeGreaterThan(50); // guard
    expect(suites.filter((p) => g.featureFor(p) === null)).toEqual([]);
    expect(suites.filter((p) => g.gateForSpec(p).skip)).toEqual([]);
  });

  test('the product’s own features are not foreign', () => {
    expect(g.features.filter((f) => f.foreign)).toEqual([]);
    expect(g.gate('company-content').skip).toBe(false);
  });

  test('an unknown feature id never skips (a typo must not silence a suite)', () => {
    expect(g.gate('no-such-feature')).toMatchObject({ skip: false, reason: null });
  });

  test('describeFor hands back the real describe when nothing is gated', () => {
    const fake = Object.assign(() => 'ran', { skip: () => 'skipped' });
    expect(describeFor('public-site', { gate: g, describe: fake })).toBe(fake);
    expect(describeForSpec(path.join(ROOT, 'e2e/business-routes.spec.js'), { gate: g, describe: fake })).toBe(fake);
  });
});

describe('a downstream that hides public-site', () => {
  let dir;
  let g;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-gate-'));
    const localPath = path.join(dir, 'local.json');
    fs.writeFileSync(localPath, JSON.stringify({
      _comment: 'ignored',
      'public-site': { status: 'hidden', note: 'LedgerLink has no company site; the product landing is its own view' },
      'sales-handbook': { status: 'live' },
    }));
    g = createGate({ localPath });
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('gate() skips the hidden feature, with the note', () => {
    const r = g.gate('public-site');
    expect(r.skip).toBe(true);
    expect(r.status).toBe('hidden');
    expect(r.reason).toContain('public-site is hidden on this product');
    expect(r.reason).toContain('LedgerLink has no company site');
  });

  test('a local status that is not a gate (live) does not skip', () => {
    expect(g.gate('sales-handbook')).toMatchObject({ skip: false, status: 'live' });
    expect(GATED_STATUSES).toEqual(['hidden', 'disabled', 'forked']);
  });

  test('the public-site specs skip; everything else still runs', () => {
    const skipped = specs.filter((p) => g.gateForSpec(p).skip).sort();
    expect(skipped).toContain('e2e/business-routes.spec.js');
    expect(skipped).toContain('e2e/navigation.spec.js');
    expect(skipped).not.toContain('e2e/auth.spec.js');
    expect(skipped.every((p) => g.featureFor(p) === 'public-site')).toBe(true);
    expect(g.gateForSpec('tests/integration/ssrMeta.test.js').skip).toBe(true);
    expect(g.gateForSpec('tests/integration/auth.test.js').skip).toBe(false);
  });

  test('describeFor becomes a describe.skip that names the reason', () => {
    const calls = [];
    const fake = Object.assign(() => { throw new Error('must not run'); }, {
      skip: (name, fn) => { calls.push(name); return fn; },
    });
    const d = describeForSpec('e2e/business-routes.spec.js', { gate: g, describe: fake });
    expect(d).not.toBe(fake);
    d('business routes', () => {});
    expect(calls).toEqual([expect.stringMatching(/^business routes — skipped: public-site is hidden/)]);
  });

  test('disabled and forked gate the same way', () => {
    for (const status of ['disabled', 'forked']) {
      const p = path.join(dir, `${status}.json`);
      fs.writeFileSync(p, JSON.stringify({ 'public-site': { status } }));
      expect(createGate({ localPath: p }).gate('public-site')).toMatchObject({ skip: true, status });
    }
  });
});

describe('another product’s feature files are inert here', () => {
  test('a foreign feature skips, naming both products', () => {
    const g = createGate({
      product: 'll',
      features: [
        { id: 'company-content', owner: 'os', folderOwner: 'os', foreign: true, status: 'live', paths: ['tests/integration/salesGuidesD001.test.js'] },
        { id: 'auth', owner: 'engine', folderOwner: 'engine', foreign: false, status: 'live', paths: ['tests/integration/auth.test.js'] },
      ],
      localPath: path.join(os.tmpdir(), 'feature-gate-does-not-exist.json'),
    });
    expect(g.gate('company-content')).toMatchObject({ skip: true, status: 'foreign' });
    expect(g.gate('company-content').reason).toContain('belongs to product "os", not "ll"');
    expect(g.gateForSpec('tests/integration/salesGuidesD001.test.js').skip).toBe(true);
    expect(g.gateForSpec('tests/integration/auth.test.js').skip).toBe(false);
  });
});

describe('helpers', () => {
  test('a missing local.json is empty; a corrupt one is an error, never a silent pass', () => {
    expect(readLocal(path.join(os.tmpdir(), 'nope-feature-gate.json'))).toEqual({});
    const p = path.join(os.tmpdir(), `feature-gate-corrupt-${process.pid}.json`);
    fs.writeFileSync(p, '{ not json');
    try { expect(() => readLocal(p)).toThrow(/not valid JSON/); } finally { fs.rmSync(p, { force: true }); }
  });

  test('globRe matches the registry’s path patterns', () => {
    expect(globRe('tests/lib/**').test('tests/lib/featureGate.js')).toBe(true);
    expect(globRe('e2e/*.spec.js').test('e2e/auth.spec.js')).toBe(true);
    expect(globRe('e2e/*.spec.js').test('e2e/lib/x.spec.js')).toBe(false);
    expect(globRe('public/js/i18n/product.*.json').test('public/js/i18n/product.en.json')).toBe(true);
  });
});
