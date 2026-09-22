/**
 * The feature registry (features/**\/*.md) is the wiki of what this engine
 * ships and the single source of the merge ownership map. It rots the moment
 * nobody checks it, so this test reads every feature file, the tree, both
 * migration arrays (as SOURCE TEXT — schema.js is huge and the product file
 * may be mid-edit) and the two documents it links to, and asserts:
 *
 *  - every file under the coverage roots is claimed by EXACTLY ONE feature
 *    (unclaimed and double-claimed are both reported);
 *  - every `paths` glob matches at least one tree file;
 *  - every migration name in the engine array and the product array is
 *    claimed by exactly one feature; engine-named (`NNN_`) ones only by engine
 *    features, product-prefixed ones only by that product's;
 *  - `domain` is a numbered `## N.` section of docs/ARCHITECTURE.md;
 *  - `owner` equals the folder; ids are unique and equal the filename;
 *  - every `history` anchor exists in docs/HISTORY.md;
 *  - `flag`, when set, is a key path of the resolved client config;
 *  - `features/local.json` keys are engine feature ids;
 *  - features/README.md, .engine-paths and .gitattributes equal what
 *    scripts/features-index.js generates.
 *
 * One assertion per rule over a set difference, so a failure names every
 * offender in one message; guards check each parser found something.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, tree } = require('../lib/sourceTree');
const idx = require('../../scripts/features-index');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// hallismiley (engine-graft): the engine tree carries another product's folder
// (features/os/) which a merge delivers and which is inert here — skip foreign
// product folders. The engine is adopting the same rule; this is the minimal
// local form of it until that version of the test arrives by sync.
const PRODUCT = idx.productId(ROOT);
const features = idx.loadFeatures(ROOT).filter((f) => f.folderOwner === 'engine' || f.folderOwner === PRODUCT);
const engineFeatures = features.filter((f) => f.owner === 'engine');
const ARCH = read('docs/ARCHITECTURE.md');
const HISTORY = read('docs/HISTORY.md');

// ------------------------------------------------------------ coverage
const COVERAGE_ROOTS = [
  'server/routes', 'server/controllers', 'server/models', 'server/services', 'server/middleware',
  'server/auth', 'server/utils', 'server/config', 'server/scripts',
  'public/js/views', 'public/js/components', 'public/js/services', 'public/js/utils', 'public/js/scenes',
  'public/css', 'tests/integration', 'tests/unit',
];
const files = [...tree].filter((p) => !p.endsWith('/'));
const covered = new Set(files.filter((p) => COVERAGE_ROOTS.some((r) => p.startsWith(r + '/')) || /^e2e\/[^/]+\.spec\.js$/.test(p)));

/** gitignore-ish glob → RegExp over the whole repo-relative path. */
function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const claims = new Map(); // file → [feature ids]
const emptyGlobs = [];
for (const f of features) {
  for (const g of f.paths || []) {
    const re = globRe(g);
    const hits = files.filter((p) => re.test(p));
    if (hits.length === 0) emptyGlobs.push(`${f.id}: ${g}`);
    for (const h of hits) {
      if (!claims.has(h)) claims.set(h, []);
      claims.get(h).push(f.id);
    }
  }
}

// ---------------------------------------------------------- migrations
const NAME_RE = /name: '((?:[a-z][a-z0-9]{1,7}_)?\d{3}_[a-z0-9_]+)'/g;
const namesIn = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? [...read(rel).matchAll(NAME_RE)].map((m) => m[1]) : []);
const engineNames = namesIn('server/config/schema.js');
const productNames = namesIn(`server/config/product-migrations/${PRODUCT}.js`);
const applied = new Set([...engineNames, ...productNames]);

const migClaims = new Map(); // name → [feature ids]
for (const f of features) {
  for (const m of f.migrations || []) {
    if (!migClaims.has(m)) migClaims.set(m, []);
    migClaims.get(m).push(f.id);
  }
}

// --------------------------------------------------------------- docs
const DOMAINS = new Set([...ARCH.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])));
const ANCHORS = new Set([...HISTORY.matchAll(/<a id="([\w-]+)"><\/a>/g)].map((m) => m[1]));

const keyPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined), obj);

// -------------------------------------------------------------- tests
describe('the parsers found the registry (guard)', () => {
  test('features, tree, migrations, docs', () => {
    expect(features.length).toBeGreaterThan(40);
    expect(engineFeatures.length).toBeGreaterThan(40);
    expect(features.some((f) => f.owner !== 'engine')).toBe(true);
    expect(covered.size).toBeGreaterThan(300);
    expect(engineNames.length).toBeGreaterThan(90);
    expect(engineNames[0]).toBe('001_initial_schema');
    expect(DOMAINS.size).toBeGreaterThan(15);
    expect(ANCHORS.size).toBeGreaterThan(15);
    const leads = features.find((f) => f.id === 'leads');
    expect(leads.name).toEqual({ is: 'Fyrirspurnir', en: 'Leads' });
    expect(leads.paths).toContain('server/routes/leadsRoutes.js');
    expect(leads.migrations).toEqual(['097_leads']);
  });

  test('the frontmatter parser handles the emitted subset', () => {
    const { data, body } = idx.parseFrontmatter(
      '---\nid: x\nname: {is: "A, b", en: B}\nn: 3\nflag: null   # comment\nlist: [a, b]\nblock:\n  - one\n  - two\nempty: []\n---\nbody\n',
    );
    expect(data).toEqual({ id: 'x', name: { is: 'A, b', en: 'B' }, n: 3, flag: null, list: ['a', 'b'], block: ['one', 'two'], empty: [] });
    expect(body).toBe('body\n');
  });
});

describe('frontmatter shape', () => {
  test('ids are unique and equal the filename', () => {
    const ids = features.map((f) => f.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(features.filter((f) => f.id !== f.fileId).map((f) => `${f.file}: id ${f.id}`)).toEqual([]);
  });

  test('owner equals the folder', () => {
    expect(features.filter((f) => f.owner !== f.folderOwner).map((f) => `${f.file}: owner ${f.owner}, folder ${f.folderOwner}`)).toEqual([]);
  });

  test('required keys and enums', () => {
    const bad = [];
    for (const f of features) {
      if (!f.name || typeof f.name !== 'object' || !f.name.is || !f.name.en) bad.push(`${f.id}: name`);
      if (!['live', 'hidden', 'dormant', 'planned'].includes(f.status)) bad.push(`${f.id}: status ${f.status}`);
      if (!Array.isArray(f.paths)) bad.push(`${f.id}: paths`);
      if (!Array.isArray(f.migrations)) bad.push(`${f.id}: migrations`);
      if (!Array.isArray(f.history)) bad.push(`${f.id}: history`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.since))) bad.push(`${f.id}: since ${f.since}`);
      if (!('origin' in f)) bad.push(`${f.id}: origin`);
      if (!('flag' in f)) bad.push(`${f.id}: flag`);
      if (!f.body.trim()) bad.push(`${f.id}: empty body`);
    }
    expect(bad).toEqual([]);
  });

  test('domain is a numbered ARCHITECTURE section', () => {
    expect(features.filter((f) => !DOMAINS.has(f.domain)).map((f) => `${f.id}: domain ${f.domain}`)).toEqual([]);
  });

  test('every history anchor exists in HISTORY.md', () => {
    const bad = [];
    for (const f of features) for (const h of f.history) if (!ANCHORS.has(h)) bad.push(`${f.id}: ${h}`);
    expect(bad).toEqual([]);
  });

  test('flag, when set, is a key path of the resolved client config', () => {
    const { clientConfig } = require('../../server/config/clientConfig');
    const bad = features.filter((f) => f.flag != null && keyPath(clientConfig, f.flag) === undefined).map((f) => `${f.id}: ${f.flag}`);
    expect(bad).toEqual([]);
    expect(keyPath(clientConfig, 'modules.selfUpdate.enabled')).toBeDefined(); // guard
  });
});

describe('file coverage', () => {
  test('every paths glob matches at least one tree file', () => {
    expect(emptyGlobs).toEqual([]);
  });

  test('every file under the coverage roots is claimed by exactly one feature', () => {
    const unclaimed = [...covered].filter((p) => !claims.has(p)).sort();
    const doubled = [...claims].filter(([, ids]) => ids.length > 1).map(([p, ids]) => `${p} ← ${ids.join(', ')}`).sort();
    expect({ unclaimed, doubled }).toEqual({ unclaimed: [], doubled: [] });
  });
});

describe('migration ownership', () => {
  test('every applied migration is claimed by exactly one feature, and nothing else is claimed', () => {
    const claimed = new Set(migClaims.keys());
    const doubled = [...migClaims].filter(([, ids]) => ids.length > 1).map(([m, ids]) => `${m} ← ${ids.join(', ')}`);
    expect({ unclaimed: diff(applied, claimed), unknown: diff(claimed, applied), doubled }).toEqual({ unclaimed: [], unknown: [], doubled: [] });
  });

  test('engine-named migrations belong to engine features, prefixed ones to that product', () => {
    const bad = [];
    for (const f of features) {
      for (const m of f.migrations) {
        const prefix = m.match(/^([a-z][a-z0-9]{1,7})_\d{3}_/);
        const legacyProduct = productNames.includes(m) && !prefix; // 091/092/104: product-owned under their old engine names
        if (legacyProduct) { if (f.owner !== PRODUCT) bad.push(`${f.id}: ${m} is a ${PRODUCT} product migration`); }
        else if (prefix) { if (f.owner !== prefix[1]) bad.push(`${f.id}: ${m} belongs to product ${prefix[1]}`); }
        else if (f.owner !== 'engine') bad.push(`${f.id}: ${m} is an engine migration`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('features/local.json', () => {
  test('keys are engine feature ids', () => {
    const local = JSON.parse(read('features/local.json'));
    const ids = new Set(engineFeatures.map((f) => f.id));
    expect(Object.keys(local).filter((k) => k !== '_comment' && !ids.has(k))).toEqual([]);
  });
});

describe('generated files are current', () => {
  const generated = idx.generateAll(ROOT);
  test.each(Object.keys(generated))('%s equals what scripts/features-index.js writes', (rel) => {
    expect(read(rel)).toBe(generated[rel]);
  });

  test('.engine-paths carries every non-engine feature path and the fixed list (guard)', () => {
    const patterns = idx.patternsOf(generated['.engine-paths']);
    expect(patterns).toContain(`features/${PRODUCT}/**`);
    expect(patterns).toContain('config/client.json');
    for (const f of features) if (f.owner !== 'engine') for (const p of f.paths) expect(patterns).toContain(p);
    expect(generated['.gitattributes'].split('\n')[0]).toBe('* text=auto');
    for (const p of patterns) expect(generated['.gitattributes']).toContain(`${p} merge=ours`);
  });
});
