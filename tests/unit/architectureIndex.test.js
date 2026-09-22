/**
 * docs/ARCHITECTURE.md is the per-domain index a feature request starts from,
 * and docs/HISTORY.md holds the dated write-ups its rules link to. Both rot the
 * moment nobody checks them, so this test reads the two documents and the tree
 * and asserts, in BOTH directions where a direction exists:
 *
 *  - every path the index names exists in the tree (a bare `Name.ext`
 *    resolves by basename against the tree, so line layout is irrelevant; an
 *    unknown or ambiguous basename is a failure, never a skip);
 *  - every file in the source directories the index promises to cover is in it;
 *  - the HISTORY index table lists exactly the anchored, dated entries;
 *  - every HISTORY link from ARCHITECTURE, PLAN and API resolves to an anchor;
 *  - CLAUDE.md's domain map has exactly one row per numbered ARCHITECTURE
 *    section, and API.md's section links resolve too;
 *  - the migrations ARCHITECTURE cites are exactly the ones schema.js applies.
 *
 * One assertion per rule over a set difference, so a failure names every
 * offender in one message; each message says what to add. Guards check that
 * every parser found something, so a reformat cannot make this assert nothing.
 *
 * This file ships from the base to every scaffold (site-factory copies
 * tests/ verbatim). PLAN.md and docs/API.md are optional sources: a repo
 * without them is simply not checked for them.
 */
const fs = require('fs');
const path = require('path');
const { migrations } = require('../../server/config/schema');

const ROOT = path.join(__dirname, '../..');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => (exists(p) ? fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n') : '');

const ARCH = read('docs/ARCHITECTURE.md');
const HISTORY = read('docs/HISTORY.md');
const CLAUDE = read('CLAUDE.md');
const PLAN = read('PLAN.md');
const API = read('docs/API.md');

// ---------------------------------------------------------------- the tree
const TREE_ROOTS = ['server', 'public', 'tests', 'e2e', 'docs', 'scripts', 'config', '.github'];
const SKIP_DIRS = new Set(['node_modules', 'coverage']);

function walk(rel, out) {
  for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) { out.add(p + '/'); walk(p, out); }
    } else {
      out.add(p);
    }
  }
}
const tree = new Set();
for (const r of TREE_ROOTS) if (exists(r)) { tree.add(r + '/'); walk(r, tree); }
for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) if (ent.isFile()) tree.add(ent.name);

const byBase = new Map();
for (const p of tree) {
  if (p.endsWith('/')) continue;
  const b = path.posix.basename(p);
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(p);
}

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
    expect(ARCH.length).toBeGreaterThan(1000);
    expect(tree.size).toBeGreaterThan(300);
    expect(paths.size).toBeGreaterThan(200);
    expect(paths.has('server/routes/authRoutes.js')).toBe(true);
    expect(paths.has('RUNBOOK.md')).toBe(true); // root-level bare token resolves
  });

  test('every listed path exists in the tree (add the file, or fix the path in ARCHITECTURE.md)', () => {
    expect(diff(paths, tree)).toEqual([]);
  });

  test('every bare filename resolves to exactly one tree file (write the full path when two share a name)', () => {
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
  ].filter(exists);

  test('there are directories to cover (guard)', () => expect(dirs.length).toBeGreaterThan(8));

  test.each(dirs)('%s — every .js file has a row in docs/ARCHITECTURE.md', (dir) => {
    const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !paths.has(f))).toEqual([]);
  });
});

describe('docs/HISTORY.md: anchors, dated headings and the index table agree', () => {
  const anchors = anchorsIn(HISTORY);
  const dated = new Set([...HISTORY.matchAll(/<a id="([\w-]+)"><\/a>\n## \d{4}-\d{2}-\d{2} — /g)].map((m) => m[1]));
  const tableStart = HISTORY.indexOf('\n## Index\n');
  const tableEnd = HISTORY.indexOf('\n---\n', tableStart);
  const indexLinks = linkIds(HISTORY.slice(tableStart, tableEnd), /\]\(#([\w-]+)\)/g);

  test('parsers found the file (guard)', () => {
    expect(anchors.size).toBeGreaterThan(0);
    expect(tableStart).toBeGreaterThan(0);
    expect(tableEnd).toBeGreaterThan(tableStart);
  });

  test('every anchor heads a dated section, and every dated section has an anchor', () => {
    expect(diff(anchors, dated)).toEqual([]);
    expect(diff(dated, anchors)).toEqual([]);
  });

  test('the index table lists exactly the anchored entries (add the row, or the anchor)', () => {
    expect(diff(indexLinks, anchors)).toEqual([]);
    expect(diff(anchors, indexLinks)).toEqual([]);
  });
});

describe('history links resolve', () => {
  const anchors = anchorsIn(HISTORY);
  const sources = {
    'docs/ARCHITECTURE.md': linkIds(ARCH, /\(HISTORY\.md#([\w-]+)\)/g),
    'PLAN.md': linkIds(PLAN, /\(docs\/HISTORY\.md#([\w-]+)\)/g),
    'docs/API.md': linkIds(API, /\(HISTORY\.md#([\w-]+)\)/g),
  };

  test('ARCHITECTURE links to history (guard)', () => {
    expect(sources['docs/ARCHITECTURE.md'].size).toBeGreaterThan(3);
  });

  test.each(Object.keys(sources))('every HISTORY link in %s is an anchor', (file) => {
    expect(diff(sources[file], anchors)).toEqual([]);
  });
});

describe('ARCHITECTURE section links', () => {
  const claudeLinks = linkIds(CLAUDE, /\(docs\/ARCHITECTURE\.md#([^)]+)\)/g);
  const apiLinks = linkIds(API, /\(ARCHITECTURE\.md#([^)]+)\)/g);

  test('parsers found sections (guard)', () => {
    expect(DOMAIN_SLUGS.size).toBeGreaterThan(8);
    expect(claudeLinks.size).toBeGreaterThan(8);
  });

  test("CLAUDE.md's domain map has one row per numbered section, and no other (add or remove the row)", () => {
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
  const CITE = /(?<!\d)(\d{3})(?:\s*[–—-]\s*(\d{3}))?(?!\d)/g;
  const applied = new Set(migrations.map((m) => m.name.slice(0, 3)));
  const cited = new Set();
  for (const line of ARCH.split('\n')) {
    if (!/^\| Migrations \|/.test(line)) continue;
    // A citation is a standalone 3-digit number or a 3-digit range (any dash);
    // the lookarounds keep a year like 2026 from minting migration 202.
    for (const m of line.matchAll(CITE)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = a; n <= b; n++) cited.add(String(n).padStart(3, '0'));
    }
  }

  test('parsers found the chain (guard)', () => {
    expect(applied.size).toBeGreaterThan(50);
    expect(cited.size).toBeGreaterThan(50);
    expect(migrations[0].name).toBe('001_initial_schema');
  });

  test('every cited migration is applied, and every applied migration is cited in some domain', () => {
    expect(diff(cited, applied)).toEqual([]);
    expect(diff(applied, cited)).toEqual([]);
  });

  test('the citation regex ignores years and accepts every dash', () => {
    const take = (s) => [...s.matchAll(CITE)].map((m) => m[1] + (m[2] ? '-' + m[2] : ''));
    expect(take('| Migrations | 105 (2026 year-end) |')).toEqual(['105']);
    expect(take('| Migrations | 072—079, 080–081, 082-083 |')).toEqual(['072-079', '080-081', '082-083']);
  });
});
