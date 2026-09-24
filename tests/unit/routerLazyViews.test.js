'use strict';

// public/js/router.js loads views on demand through its VIEWS table. A typo
// there (wrong file, wrong export name, a route naming a view the table lacks)
// only fails when someone visits that route — so check every entry here.
// And the boot graph must stay small: main.js used to pull every view at load.
// Ported from icelandicstore #426 (harvest-ice-e-2026-09-24); the engine has no
// AccessGateView (ice's wholesale gate), so its fallbacks are HomeView and
// NotFoundView.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '../../public/js');
const src = fs.readFileSync(path.join(JS, 'router.js'), 'utf8');

const table = src.slice(src.indexOf('const VIEWS = {'), src.indexOf('\n};', src.indexOf('const VIEWS = {')));
const entries = [...table.matchAll(/^\s*(\w+):\s*\(\) => import\('(\.\/views\/[^']+)'\)\.then\(\(m\) => m\.(\w+)\),$/gm)]
  .map(([, key, file, exp]) => ({ key, file, exp }));

test('the lazy view table is parsed (guards the regex itself)', () => {
  expect(entries.length).toBeGreaterThan(60);
});

test.each(entries.map((e) => [e.key, e]))('%s loads a file that exports it', (_key, { key, file, exp }) => {
  expect(exp).toBe(key);
  const code = fs.readFileSync(path.join(JS, file), 'utf8');
  expect(code).toMatch(new RegExp(`export (class|function|const) ${exp}\\b|export \\{[^}]*\\b${exp}\\b`));
});

test('every make() in the route table names a view the table has', () => {
  const keys = new Set(entries.map((e) => e.key));
  const used = [...src.matchAll(/make\('(\w+)'/g)].map((m) => m[1]);
  expect(used.length).toBeGreaterThan(60);
  expect(used.filter((n) => !keys.has(n))).toEqual([]);
});

test('no view module is imported statically by the router except the fallbacks', () => {
  const statics = [...src.matchAll(/^import \{([^}]+)\} from '\.\/views\//gm)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
  expect(statics.sort()).toEqual(['HomeView', 'NotFoundView']);
});

test('the boot graph from main.js stays small (no view pulled in by accident)', () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      if (m[1].startsWith('.')) walk(path.resolve(path.dirname(file), m[1]));
    }
  };
  walk(path.join(JS, 'main.js'));
  const views = [...seen].map((f) => path.relative(JS, f)).filter((f) => f.startsWith('views'));
  expect(views.sort()).toEqual([path.join('views', 'HomeView.js'), path.join('views', 'NotFoundView.js')].sort());
  // The engine's boot graph was every view before this change; see HISTORY harvest-ice-e.
  expect(seen.size).toBeLessThan(60);
});
