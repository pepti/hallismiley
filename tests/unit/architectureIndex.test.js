/**
 * docs/ARCHITECTURE.md is the per-domain index a feature request starts from,
 * and the dated write-ups its rules link to live in docs/HISTORY.md (the
 * archive, frozen 2026-09-26) and docs/history.d/*.md (one fragment per
 * branch since then — tests/lib/historyAnchors.js). Both rot the
 * moment nobody checks them, so this test reads the two documents and the tree
 * and asserts, in BOTH directions where a direction exists:
 *
 *  - every path the index names exists in the tracked tree (a bare `Name.ext`
 *    resolves by basename against the tree, so line layout is irrelevant; an
 *    unknown or ambiguous basename is a failure, never a skip);
 *  - every file in the source directories the index promises to cover is in it;
 *  - the HISTORY index table lists exactly the archive's anchored, dated
 *    entries; no slug repeats across the archive and the fragments;
 *  - every history link (`HISTORY.md#id` or `history.d/<file>.md#id`) from
 *    ARCHITECTURE, PLAN and API resolves to a file holding that anchor;
 *  - CLAUDE.md's domain map has exactly one row per numbered ARCHITECTURE
 *    section, and API.md's section links resolve too;
 *  - the migrations ARCHITECTURE cites are exactly the ones schema.js applies;
 *  - every feature file (features/**) is linked from its domain's Features
 *    row, and every id in a Features row is a feature file of that domain.
 *
 * One assertion per rule over a set difference, so a failure names every
 * offender in one message (the shape of admin-views-parity.test.js). Guards
 * check that each parser found something, so a reformat cannot make this
 * assert nothing.
 */
const fs = require('fs');
const path = require('path');
const { migrations } = require('../../server/config/schema');
const { ROOT, TREE_ROOTS, tree, byBase } = require('../lib/sourceTree');
const { loadFeatures } = require('../../scripts/features-index');
const historyAnchors = require('../lib/historyAnchors');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const ARCH = read('docs/ARCHITECTURE.md');
const HISTORY = read('docs/HISTORY.md');
const CLAUDE = read('CLAUDE.md');
const PLAN = read('PLAN.md');
const API = read('docs/API.md');

// The tree (walk, roots, byBase) lives in tests/lib/sourceTree.js, shared with
// featureRegistry.test.js.

// ------------------------------------------------------------ the parsers
const PREFIX = new RegExp(`^(${TREE_ROOTS.map((r) => r.replace('.', '\\.')).join('|')})/`);
const BARE = /^[\w.-]+\.(js|css|json|md|sql|yml|html|jpg|mp4)$/;

/** Every backticked file reference in a document, resolved to a tree path.
 *  Returns { paths, unknown, ambiguous }. */
function indexedPaths(md) {
  const paths = new Set();
  const unknown = [];
  const ambiguous = [];
  // Fenced blocks (the directory tree) are prose, not references.
  const body = md.replace(/```[\s\S]*?```/g, '');
  for (const line of body.split('\n')) {
    let lineDir = null; // the last full path on this line breaks a basename tie
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const tok = m[1].trim();
      if (/[\s(<>{}*]/.test(tok)) continue;
      if (PREFIX.test(tok)) {
        const p = !tok.endsWith('/') && tree.has(tok + '/') ? tok + '/' : tok;
        paths.add(p);
        lineDir = p.endsWith('/') ? p.slice(0, -1) : path.posix.dirname(p);
      } else if (BARE.test(tok)) {
        const hits = byBase.get(tok) || [];
        const tied = hits.length > 1 ? hits.filter((h) => path.posix.dirname(h) === lineDir) : hits;
        if (tied.length === 1) paths.add(tied[0]);
        else if (hits.length === 0) unknown.push(tok);
        else ambiguous.push(`${tok} → ${hits.join(' | ')}`);
      }
    }
  }
  return { paths, unknown, ambiguous };
}

const anchorsIn = (md) => new Set([...md.matchAll(/<a id="([\w-]+)"><\/a>/g)].map((m) => m[1]));
const linkIds = (md, re) => new Set([...md.matchAll(re)].map((m) => m[1]));
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

/** GitHub heading slugs: lowercase; keep letters, digits, `_`, space, `-`;
 *  spaces → `-`; a repeated slug gets `-1`, `-2`, … */
function githubSlugs(headings) {
  const seen = new Map();
  return headings.map((h) => {
    const base = h.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  });
}

const ARCH_HEADINGS = ARCH.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
const ARCH_SLUGS = new Set(githubSlugs(ARCH_HEADINGS));
const DOMAIN_SLUGS = new Set(githubSlugs(ARCH_HEADINGS).filter((s) => /^\d+-/.test(s)));

// ------------------------------------------------------------------ tests
describe('docs/ARCHITECTURE.md names real files', () => {
  const { paths, unknown, ambiguous } = indexedPaths(ARCH);

  test('the parser found the index (guard)', () => {
    expect(tree.size).toBeGreaterThan(500);
    expect(paths.size).toBeGreaterThan(300);
    expect(paths.has('server/routes/leadsRoutes.js')).toBe(true);
    expect(paths.has('public/js/views/AdminLeadsView.js')).toBe(true);
    expect(paths.has('RUNBOOK.md')).toBe(true); // root-level bare token resolves
  });

  test('every listed path exists in the tracked tree', () => {
    expect(diff(paths, tree)).toEqual([]);
  });

  test('every bare filename resolves to exactly one tree file', () => {
    expect(unknown).toEqual([]);
    expect(ambiguous).toEqual([]);
  });
});

describe('every source file the index promises to cover is listed', () => {
  const { paths } = indexedPaths(ARCH);
  const dirs = [
    'server/routes', 'server/controllers', 'server/models', 'server/services',
    'server/services/bookkeeping', 'server/services/bookkeeping/peppol',
    'server/middleware', 'server/auth', 'server/utils',
    'public/js/views', 'public/js/components', 'public/js/services', 'public/js/utils', 'public/js/scenes',
  ];

  test.each(dirs)('%s', (dir) => {
    const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
    expect(files.length).toBeGreaterThan(3); // guard
    expect(files.filter((f) => !paths.has(f))).toEqual([]);
  });
});

describe('docs/HISTORY.md (the frozen archive): anchors, dated headings and the index table agree', () => {
  // The index table covers the archive only; fragments in docs/history.d/ are
  // their own index (filenames sort by date — historyFragments.test.js).
  const anchors = anchorsIn(HISTORY);
  const dated = new Set([...HISTORY.matchAll(/<a id="([\w-]+)"><\/a>\n## \d{4}-\d{2}-\d{2} — /g)].map((m) => m[1]));
  const tableStart = HISTORY.indexOf('\n## Index\n');
  const tableEnd = HISTORY.indexOf('\n---\n', tableStart);
  const indexLinks = linkIds(HISTORY.slice(tableStart, tableEnd), /\]\(#([\w-]+)\)/g);

  test('parsers found the file (guard)', () => {
    expect(anchors.size).toBeGreaterThan(15);
    expect(tableStart).toBeGreaterThan(0);
    expect(tableEnd).toBeGreaterThan(tableStart);
  });

  test('every anchor heads a dated section', () => {
    expect(diff(anchors, dated)).toEqual([]);
    expect(diff(dated, anchors)).toEqual([]);
  });

  test('the index table lists exactly the anchored entries', () => {
    expect(diff(indexLinks, anchors)).toEqual([]);
    expect(diff(anchors, indexLinks)).toEqual([]);
  });
});

describe('history anchors are one namespace (archive + docs/history.d fragments)', () => {
  test('parsers found both halves (guard)', () => {
    expect(historyAnchors.anchorsByFile().get(historyAnchors.ARCHIVE_FILE).size).toBeGreaterThan(15);
    expect(historyAnchors.fragmentFiles().length).toBeGreaterThan(0);
  });

  test('no slug appears twice across the archive and the fragments', () => {
    expect(historyAnchors.duplicateAnchors()).toEqual([]);
  });
});

describe('history links resolve', () => {
  // A link is `HISTORY.md#id` (the archive) or `history.d/<file>.md#id` (a
  // fragment), relative to the linking file: docs/ files link `HISTORY.md` /
  // `history.d/…`, PLAN.md at the root links `docs/HISTORY.md` / `docs/history.d/…`.
  // Both must resolve: the file exists and the anchor is IN that file.
  const byFile = historyAnchors.anchorsByFile();
  const LINK = /\(((?:docs\/)?(?:HISTORY\.md|history\.d\/[\w.-]+\.md))#([\w-]+)\)/g;
  const linksIn = (md, dir) => [...md.matchAll(LINK)].map((m) => ({
    file: path.posix.normalize(path.posix.join(dir, m[1])), id: m[2], raw: `${m[1]}#${m[2]}`,
  }));
  const sources = {
    'docs/ARCHITECTURE.md': linksIn(ARCH, 'docs'),
    'PLAN.md': linksIn(PLAN, '.'),
    'docs/API.md': linksIn(API, 'docs'),
  };

  test('the link parsers found links (guard)', () => {
    expect(sources['docs/ARCHITECTURE.md'].length).toBeGreaterThan(10);
    expect(sources['PLAN.md'].length).toBeGreaterThan(3);
    expect(sources['docs/API.md'].length).toBeGreaterThan(3);
    expect(sources['PLAN.md'].some((l) => l.file.startsWith('docs/history.d/'))).toBe(true);
  });

  test.each(Object.keys(sources))('every history link in %s resolves to a file that holds the anchor', (file) => {
    const bad = sources[file].filter((l) => !(byFile.get(l.file) || new Set()).has(l.id)).map((l) => l.raw);
    expect([...new Set(bad)].sort()).toEqual([]);
  });
});

describe('ARCHITECTURE section links', () => {
  const claudeLinks = linkIds(CLAUDE, /\(docs\/ARCHITECTURE\.md#([^)]+)\)/g);
  const apiLinks = linkIds(API, /\(ARCHITECTURE\.md#([^)]+)\)/g);

  test('parsers found sections (guard)', () => {
    expect(DOMAIN_SLUGS.size).toBeGreaterThan(10);
    expect(DOMAIN_SLUGS.has('6-leads--fyrirspurnir')).toBe(true);
    expect(apiLinks.size).toBeGreaterThan(3);
  });

  test("CLAUDE.md's domain map has one row per numbered section, and no other", () => {
    expect(diff(claudeLinks, DOMAIN_SLUGS)).toEqual([]);
    expect(diff(DOMAIN_SLUGS, claudeLinks)).toEqual([]);
  });

  test("API.md's section links resolve", () => {
    expect(diff(apiLinks, ARCH_SLUGS)).toEqual([]);
  });

  test('slugs follow GitHub rules (underscore kept, duplicates suffixed)', () => {
    expect(githubSlugs(['21. market_companies ingest', 'Same', 'Same'])).toEqual(['21-market_companies-ingest', 'same', 'same-1']);
  });
});

describe('cited migrations are exactly the applied ones', () => {
  // Applied = the engine array (schema.js) plus this product's array, read as
  // source text so a mid-edit product file cannot break the require. The
  // product file keeps 091/092/104 under their engine-era names (D-021).
  const productFile = `server/config/product-migrations/${require('../../engine.json').product}.js`;
  const productNums = fs.existsSync(path.join(ROOT, productFile))
    ? [...read(productFile).matchAll(/name: '(\d{3})_[a-z0-9_]+'/g)].map((m) => m[1])
    : [];
  const applied = new Set([...migrations.map((m) => m.name.slice(0, 3)), ...productNums]);
  const cited = new Set();
  for (const line of ARCH.split('\n')) {
    if (!/^\| Migrations \|/.test(line)) continue;
    // A citation is a standalone 3-digit number or a 3-digit range (any dash);
    // the lookarounds keep a year like 2026 from minting migration 202.
    for (const m of line.matchAll(/(?<!\d)(\d{3})(?:\s*[–—-]\s*(\d{3}))?(?!\d)/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = a; n <= b; n++) cited.add(String(n).padStart(3, '0'));
    }
  }

  test('parsers found the chain (guard)', () => {
    expect(applied.size).toBeGreaterThan(90);
    expect(cited.size).toBeGreaterThan(60);
    expect(migrations[0].name).toBe('001_initial_schema');
  });

  test('every cited migration is applied, and every applied migration is cited', () => {
    expect(diff(cited, applied)).toEqual([]);
    expect(diff(applied, cited)).toEqual([]);
  });

  test('the citation regex ignores years and accepts every dash', () => {
    const take = (s) => [...s.matchAll(/(?<!\d)(\d{3})(?:\s*[–—-]\s*(\d{3}))?(?!\d)/g)].map((m) => m[1] + (m[2] ? '-' + m[2] : ''));
    expect(take('| Migrations | 105 (2026 year-end) |')).toEqual(['105']);
    expect(take('| Migrations | 072—079, 080–081, 082-083 |')).toEqual(['072-079', '080-081', '082-083']);
  });
});

describe('every feature file is linked from its domain\'s Features row', () => {
  // "<domain>:<id>" pairs from the registry and from the `| Features |` rows.
  // Another product's folder (features/os/ in a downstream) is inert: its
  // features are not this repo's to document, so ARCHITECTURE need not link
  // them — and since docs/ARCHITECTURE.md is engine-owned and arrives by
  // merge, a row that DOES link a foreign feature (the engine's own row links
  // features/os/company-content.md, foreign in every downstream) is allowed
  // but not required (identity-seam-3): the link must still resolve to a file.
  const { productId } = require('../../scripts/features-index');
  const product = productId(ROOT);
  const isForeign = (file) => { const m = file.match(/^features\/([^/]+)\//); return !!m && m[1] !== product; };
  const registry = new Set(loadFeatures(ROOT).filter((f) => !f.foreign).map((f) => `${f.domain}:${f.id}`));
  const rows = new Set();
  const foreignLinks = [];
  let domain = null;
  for (const line of ARCH.split('\n')) {
    const h = line.match(/^## (\d+)\. /);
    if (h) domain = h[1];
    if (!/^\| Features \|/.test(line)) continue;
    for (const m of line.matchAll(/\[([\w-]+)\]\(\.\.\/(features\/[\w/-]+\.md)\)/g)) {
      expect(fs.existsSync(path.join(ROOT, m[2]))).toBe(true);
      expect(path.posix.basename(m[2], '.md')).toBe(m[1]);
      if (isForeign(m[2])) { foreignLinks.push(m[2]); continue; }
      rows.add(`${domain}:${m[1]}`);
    }
  }

  test('parsers found the rows (guard)', () => {
    expect(registry.size).toBeGreaterThan(40);
    expect(rows.size).toBeGreaterThan(40);
    expect(rows.has('6:leads')).toBe(true);
  });

  test('the Features rows list exactly the registry, per domain', () => {
    expect(diff(registry, rows)).toEqual([]);
    expect(diff(rows, registry)).toEqual([]);
  });

  test('a foreign feature link is tolerated, never counted (the engine has none of its own)', () => {
    // In the engine every features/<p>/ folder is its own product's, so no
    // link is foreign here; in a downstream the engine's os row is.
    const { role } = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine.json'), 'utf8'));
    if (role === 'engine') expect(foreignLinks).toEqual([]);
    for (const f of foreignLinks) expect(rows.has(`3:${path.posix.basename(f, '.md')}`)).toBe(false);
  });
});
