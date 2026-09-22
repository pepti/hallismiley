#!/usr/bin/env node
'use strict';
/**
 * features-index.js — the feature registry's derived files.
 *
 * Reads every `features/**\/*.md` frontmatter and writes three files that must
 * never be edited by hand:
 *
 *   features/README.md   the index table (engine first, then one section per
 *                        product owner)
 *   .engine-paths        gitignore-syntax list of PRODUCT-owned paths: the
 *                        fixed list every repo shares plus every `paths`
 *                        entry of every non-engine feature. site-factory's
 *                        engine-sync reads it; a merge from upstream never
 *                        overwrites these.
 *   .gitattributes       `* text=auto`, then `<pattern> merge=ours` for each
 *                        .engine-paths pattern, then `package-lock.json -diff`
 *
 *   node scripts/features-index.js           write the three files
 *   node scripts/features-index.js --check   exit 1 if any differs
 *
 * The frontmatter parser is deliberately a small hand-written subset (no yaml
 * dependency): `key: scalar`, `key: {a: b, c: d}` inline maps, `key: [a, b]`
 * inline lists and `key:` + `  - item` block lists. Keep the emitted
 * frontmatter inside that subset. tests/unit/featureRegistry.test.js calls the
 * exported functions and asserts the committed files equal the generated ones.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FEATURES_DIR = 'features';

// ------------------------------------------------------------ frontmatter
function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.startsWith('"') ? JSON.parse(s) : s.slice(1, -1);
  }
  return s;
}

/** Split `a: b, c: "d, e"` on top-level commas (quotes respected). */
function splitTop(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function value(raw) {
  const s = raw.trim();
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    for (const part of splitTop(s.slice(1, -1))) {
      const i = part.indexOf(':');
      if (i < 0) throw new Error(`bad inline map entry: ${part}`);
      obj[part.slice(0, i).trim()] = scalar(part.slice(i + 1));
    }
    return obj;
  }
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map(scalar);
  return scalar(s);
}

/**
 * Parse a markdown file with YAML-subset frontmatter.
 * @returns {{ data: object, body: string }}
 */
function parseFrontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('no frontmatter block');
  const data = {};
  const lines = m[1].split('\n');
  let blockKey = null;
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item) {
      if (!blockKey) throw new Error(`list item without a key: ${line}`);
      data[blockKey].push(scalar(item[1].replace(/\s+#.*$/, '')));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (!kv) throw new Error(`unparseable frontmatter line: ${line}`);
    const key = kv[1];
    // A trailing `# comment` after a scalar is allowed (not inside quotes).
    let rest = kv[2];
    if (!/^\s*["'{[]/.test(rest)) rest = rest.replace(/\s+#.*$/, '');
    if (rest.trim() === '') { data[key] = []; blockKey = key; continue; }
    blockKey = null;
    data[key] = value(rest);
  }
  return { data, body: m[2] };
}

// ----------------------------------------------------------------- loading
function listFeatureFiles(root = ROOT) {
  const out = [];
  const dir = path.join(root, FEATURES_DIR);
  (function walk(rel) {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.md') && ent.name !== 'README.md') out.push(p);
    }
  })('');
  return out.sort();
}

/**
 * Every feature file, parsed. `file` is `features/<...>.md`; `folderOwner` is
 * what the folder says the owner is (`engine` for features/x.md, `<p>` for
 * features/<p>/x.md) — the test checks it equals `owner`.
 */
function loadFeatures(root = ROOT) {
  return listFeatureFiles(root).map((rel) => {
    const file = `${FEATURES_DIR}/${rel}`;
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(root, file), 'utf8'));
    const parts = rel.split('/');
    const folderOwner = parts.length === 1 ? 'engine' : parts[0];
    const fileId = path.posix.basename(rel, '.md');
    return { file, folderOwner, fileId, body, ...data };
  });
}

function productId(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'engine.json'), 'utf8')).product;
}

// -------------------------------------------------------------- generators
const FIXED_PRODUCT_PATHS = [
  'CLAUDE.md', 'PLAN.md', 'LESSONS.md', 'AGENTS.md', 'README.md', 'CHANGELOG.md',
  'engine.json', 'setup.ps1', 'config/client.json', 'features/local.json',
  'features/<product>/**',
  'server/config/product-migrations/**', 'server/migrations/product/**',
  'public/js/views/product/**', 'public/js/components/product/**',
  'public/js/services/product/**', 'public/css/product/**', 'public/assets/product/**',
  'public/js/i18n/product.*.json', 'server/i18n/product.*.json',
  'e2e/product/**', 'tests/product/**', 'docs/product/**',
  '.github/workflows/deploy.yml', '.github/workflows/promote.yml',
];

function enginePathPatterns(features, product) {
  const fixed = FIXED_PRODUCT_PATHS.map((p) => p.replace('<product>', product));
  const extra = new Set();
  for (const f of features) {
    if (f.owner === 'engine') continue;
    for (const p of f.paths || []) if (!fixed.includes(p)) extra.add(p);
  }
  return { fixed, extra: [...extra].sort() };
}

function generateEnginePaths(features, product) {
  const { fixed, extra } = enginePathPatterns(features, product);
  const lines = [
    '# .engine-paths — PRODUCT-owned paths in this repo (gitignore syntax).',
    '# Generated by scripts/features-index.js from features/**/*.md; do not edit.',
    '# A sync from the engine upstream never overwrites these; .gitattributes',
    '# carries the same list as `merge=ours`. Everything else is engine-owned',
    '# and arrives by `git merge upstream/master`.',
    '',
    '# Fixed: the same in every repo of the estate',
    ...fixed,
  ];
  if (extra.length) {
    lines.push('', `# From the \`paths\` of every feature whose owner is not \`engine\``, ...extra);
  }
  return lines.join('\n') + '\n';
}

function patternsOf(enginePathsText) {
  return enginePathsText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function generateGitattributes(enginePathsText) {
  const lines = ['* text=auto'];
  for (const p of patternsOf(enginePathsText)) lines.push(`${p} merge=ours`);
  lines.push('package-lock.json -diff');
  return lines.join('\n') + '\n';
}

const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');

function generateReadme(features) {
  const owners = [...new Set(features.map((f) => f.owner))].sort((a, b) => (a === 'engine' ? -1 : b === 'engine' ? 1 : a.localeCompare(b)));
  const out = [
    '# Feature registry',
    '',
    'One file per feature under `features/` (engine features at the top level,',
    'product features under `features/<product>/`), each with a YAML frontmatter',
    'that names its files, migrations, gate and history. This index, `.engine-paths`',
    'and `.gitattributes` are GENERATED by `scripts/features-index.js` — do not',
    'edit them by hand; `tests/unit/featureRegistry.test.js` fails when they drift',
    'or when a source file is claimed by no feature (or by two).',
    '',
    'Status: `live` · `hidden` (served, hidden from nav/sitemap/admin lines) ·',
    '`dormant` (code present, switched off here) · `planned`. `flag` is the',
    '`config/client.json` key path that gates the feature, when one exists.',
    'Downstream overrides go in `features/local.json`.',
    '',
  ];
  for (const owner of owners) {
    const rows = features.filter((f) => f.owner === owner).sort((a, b) => a.domain - b.domain || a.id.localeCompare(b.id));
    out.push(`## ${owner === 'engine' ? 'Engine features' : `Product: ${owner}`} (${rows.length})`, '');
    out.push('| id | name (is / en) | domain | owner | status | flag | migrations | file |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const f of rows) {
      const name = f.name && typeof f.name === 'object' ? `${cell(f.name.is)} / ${cell(f.name.en)}` : cell(f.name);
      const link = f.file.replace(/^features\//, '');
      out.push(`| \`${f.id}\` | ${name} | ${f.domain} | ${f.owner} | ${f.status} | ${f.flag ? `\`${f.flag}\`` : '—'} | ${(f.migrations || []).map((m) => `\`${m}\``).join(', ') || '—'} | [${link}](${link}) |`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ------------------------------------------------------------------- main
function generateAll(root = ROOT) {
  const features = loadFeatures(root);
  const product = productId(root);
  const enginePaths = generateEnginePaths(features, product);
  return {
    'features/README.md': generateReadme(features),
    '.engine-paths': enginePaths,
    '.gitattributes': generateGitattributes(enginePaths),
  };
}

function diffSummary(oldText, newText) {
  const a = (oldText || '').replace(/\r\n/g, '\n').split('\n');
  const b = newText.split('\n');
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < 12; i++) {
    if (a[i] !== b[i]) out.push(`  line ${i + 1}: ${JSON.stringify(a[i] ?? '<missing>')} → ${JSON.stringify(b[i] ?? '<missing>')}`);
  }
  return out.join('\n');
}

function main(argv) {
  const check = argv.includes('--check');
  const files = generateAll(ROOT);
  let dirty = 0;
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(ROOT, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const same = current !== null && current.replace(/\r\n/g, '\n') === text;
    if (check) {
      if (!same) { dirty++; process.stdout.write(`${rel} differs:\n${diffSummary(current, text)}\n`); }
    } else if (!same) {
      fs.writeFileSync(abs, text);
      process.stdout.write(`wrote ${rel}\n`);
    }
  }
  if (check) {
    process.stdout.write(dirty ? `${dirty} file(s) out of date — run node scripts/features-index.js\n` : 'feature index up to date\n');
    process.exitCode = dirty ? 1 : 0;
  }
}

module.exports = {
  ROOT, FEATURES_DIR, FIXED_PRODUCT_PATHS,
  parseFrontmatter, listFeatureFiles, loadFeatures, productId,
  enginePathPatterns, generateEnginePaths, generateGitattributes, generateReadme, generateAll, patternsOf,
};

if (require.main === module) main(process.argv.slice(2));
