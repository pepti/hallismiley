/**
 * docs/ARCHITECTURE.md is the per-domain index a feature request starts from,
 * and docs/HISTORY.md holds the dated write-ups its rules link to. Both rot the
 * moment nobody checks them, so this test reads the two documents and the tree:
 *
 *  - every path the index names exists;
 *  - every routes / controller / model / view file in the tree is named in the
 *    index (a new router without an index row fails CI);
 *  - every HISTORY link in ARCHITECTURE, PLAN and HISTORY's own index resolves
 *    to an <a id> anchor in HISTORY.md;
 *  - every ARCHITECTURE section link in CLAUDE.md's domain map resolves to a
 *    heading (GitHub slug rules);
 *  - every migration number the index cites is in server/config/schema.js.
 *
 * Same read-the-source shape as tests/unit/pageTitle.test.js — with guards that
 * the parsers found something, so a reformat cannot make this assert nothing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const ARCH = read('docs/ARCHITECTURE.md');
const HISTORY = read('docs/HISTORY.md');
const CLAUDE = read('CLAUDE.md');
const PLAN = read('PLAN.md');
const SCHEMA = read('server/config/schema.js');

/** Backticked tokens, in order, per line. Tracked-tree prefixes only; a bare
 *  `Name.ext` resolves against the directory of the last full path on the line
 *  (the tables list `server/controllers/a.js`, `b.js`, `c.js`). */
const PREFIX = /^(server|public|tests|e2e|docs|scripts|config|\.github)\//;
const BARE = /^[\w.-]+\.(js|css|json|md|sql|yml|html)$/;
function indexedPaths(md) {
  const out = [];
  for (const line of md.split('\n')) {
    let dir = null;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const tok = m[1].trim();
      if (/[\s(<>{}*]/.test(tok)) continue;
      if (PREFIX.test(tok)) {
        if (tok.endsWith('/')) { out.push(tok); dir = tok.replace(/\/$/, ''); continue; }
        out.push(tok);
        dir = path.posix.dirname(tok);
      } else if (BARE.test(tok) && dir) {
        out.push(`${dir}/${tok}`);
      }
    }
  }
  return out;
}

const anchorsIn = (md) => new Set([...md.matchAll(/<a id="([\w-]+)"><\/a>/g)].map((m) => m[1]));

/** GitHub heading slug: lowercase, drop everything but letters/digits/space/hyphen, spaces → hyphens. */
const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

describe('docs/ARCHITECTURE.md names real files', () => {
  const paths = [...new Set(indexedPaths(ARCH))];

  test('the parser found the index (guard)', () => {
    expect(paths.length).toBeGreaterThan(300);
    expect(paths).toContain('server/routes/leadsRoutes.js');
    expect(paths).toContain('public/js/views/AdminLeadsView.js');
    expect(paths).toContain('tests/integration/leads.test.js');
  });

  test.each(paths)('%s exists', (p) => {
    expect(fs.existsSync(path.join(ROOT, p))).toBe(true);
  });
});

describe('every routes / controller / model / view file is indexed', () => {
  const dirs = ['server/routes', 'server/controllers', 'server/models', 'public/js/views'];
  for (const dir of dirs) {
    const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js'));
    test(`${dir} has files (guard)`, () => expect(files.length).toBeGreaterThan(5));
    test.each(files)(`${dir}/%s is named in the index`, (f) => {
      expect(ARCH.includes('`' + f + '`') || ARCH.includes('/' + f + '`')).toBe(true);
    });
  }
});

describe('history links resolve', () => {
  const anchors = anchorsIn(HISTORY);

  test('HISTORY.md has anchors and a dated heading per anchor (guard)', () => {
    expect(anchors.size).toBeGreaterThan(15);
    for (const id of anchors) {
      expect(HISTORY).toMatch(new RegExp(`<a id="${id}"></a>\\n## \\d{4}-\\d{2}-\\d{2} — `));
    }
  });

  const refs = (md, re) => [...new Set([...md.matchAll(re)].map((m) => m[1]))];
  const fromArch = refs(ARCH, /\(HISTORY\.md#([\w-]+)\)/g);
  const fromPlan = refs(PLAN, /\(docs\/HISTORY\.md#([\w-]+)\)/g);
  const fromIndex = refs(HISTORY, /\]\(#([\w-]+)\)/g);

  test('the link parsers found links (guard)', () => {
    expect(fromArch.length).toBeGreaterThan(10);
    expect(fromPlan.length).toBeGreaterThan(3);
    expect(fromIndex.length).toBe(anchors.size);
  });

  test.each([...fromArch, ...fromPlan, ...fromIndex])('#%s is an anchor in HISTORY.md', (id) => {
    expect(anchors.has(id)).toBe(true);
  });
});

describe("CLAUDE.md's domain map points at ARCHITECTURE.md sections", () => {
  const headings = new Set(ARCH.split('\n').filter((l) => l.startsWith('## ')).map((l) => slug(l.slice(3).trim())));
  const links = [...new Set([...CLAUDE.matchAll(/\(docs\/ARCHITECTURE\.md#([^)]+)\)/g)].map((m) => m[1]))];

  test('twenty domain rows (guard)', () => {
    expect(links.length).toBe(20);
    expect(headings.has('6-leads--fyrirspurnir')).toBe(true);
  });

  test.each(links)('#%s is a heading', (id) => {
    expect(headings.has(id)).toBe(true);
  });
});

describe('cited migrations exist in schema.js', () => {
  const applied = new Set([...SCHEMA.matchAll(/name:\s*'(\d{3})_/g)].map((m) => m[1]));
  const cited = new Set();
  for (const line of ARCH.split('\n')) {
    if (!/^\| Migrations \|/.test(line)) continue;
    for (const m of line.matchAll(/(\d{3})(?:[–-](\d{3}))?/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = a; n <= b; n++) cited.add(String(n).padStart(3, '0'));
    }
  }

  test('parsers found the chain (guard)', () => {
    expect(applied.size).toBeGreaterThan(90);
    expect(cited.size).toBeGreaterThan(60);
  });

  test.each([...cited])('migration %s is in schema.js', (n) => {
    expect(applied.has(n)).toBe(true);
  });
});
