'use strict';

// public/js/routePatterns.json is the one list of SPA routes the server reads
// to answer 404 for a path nothing renders (server/utils/spaRoutes.js). The
// client router keeps its own ROUTES table (each entry carries a view factory),
// so this test is what keeps the two identical: a route added to router.js but
// not to the JSON would answer 404 on a hard load while rendering fine in-app.
// Ported from icelandicstore #399 (harvest-ice-e-2026-09-24). Engine
// difference: a product's own routes (identity.routes) reach the server through
// ssrMeta's ROUTE_META, so a router pattern that is one of them may be absent
// from the JSON.

const fs   = require('fs');
const path = require('path');
const { matchesSpaRoute, patterns } = require('../../server/utils/spaRoutes');
const { productRoutes } = require('../../server/config/identity');

function routerPatterns() {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/router.js'), 'utf8');
  const start = src.indexOf('const ROUTES = [');
  const end = src.indexOf('\n];', start);
  expect(start).toBeGreaterThan(-1);
  return [...src.slice(start, end).matchAll(/pattern:\s*'([^']+)'/g)].map(m => m[1]);
}

describe('SPA route patterns', () => {
  test('routePatterns.json lists exactly the router.js ROUTES, in order', () => {
    const own = new Set(Object.keys(productRoutes()));
    expect(patterns).toEqual(routerPatterns().filter(p => !own.has(p) || patterns.includes(p)));
  });

  test('every pattern matches itself with sample params', () => {
    for (const p of patterns) {
      const sample = p.split('/').map(seg => (seg.startsWith(':') ? 'x1' : seg)).join('/');
      expect([p, matchesSpaRoute(sample)]).toEqual([p, true]);
    }
  });

  test('a trailing slash is ignored; extra or empty segments are not', () => {
    expect(matchesSpaRoute('/')).toBe(true);
    expect(matchesSpaRoute('/verkefni/')).toBe(true);
    expect(matchesSpaRoute('/verkefni/12')).toBe(true);
    expect(matchesSpaRoute('/verkefni/12/extra')).toBe(false);
    expect(matchesSpaRoute('/admin/books//invoices')).toBe(false);
    expect(matchesSpaRoute('/no-such-page')).toBe(false);
  });
});
