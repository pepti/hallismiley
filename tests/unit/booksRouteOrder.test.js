/**
 * Middleware order on the bookkeeping document routes.
 *
 * `docLimiter` (server/middleware/booksLimiters.js) exists to bound the cost
 * of the streaming/PDF/CSV endpoints per IP. It only does that if it runs
 * BEFORE the view/role guard: placed after `requireView(...)`, an
 * unauthenticated caller is answered by the guard (a cheap 401/403) and
 * never counted, while an authenticated caller is counted — the inverse of
 * what a limiter in front of a file-serving route is for, and it leaves the
 * guard itself unbounded. `GET /documents/:id` had it the wrong way round
 * until 2026-09-12; this test fails on that code.
 *
 * Inspects the router's own stack (no server boot, no database).
 */
const router = require('../../server/routes/adminBookkeepingRoutes');
const { docLimiter } = require('../../server/middleware/booksLimiters');

describe('adminBookkeepingRoutes — docLimiter position', () => {
  const routes = router.stack.filter(layer => layer.route);
  const limited = routes.filter(layer => layer.route.stack.some(s => s.handle === docLimiter));

  test('the limiter is applied to at least the document/export routes', () => {
    const paths = limited.map(l => l.route.path);
    expect(paths).toEqual(expect.arrayContaining(['/documents/:id', '/invoices/:id/pdf', '/invoices/export.csv']));
  });

  test('on every route that uses it, docLimiter runs first', () => {
    const wrong = limited
      .map(l => ({ path: l.route.path, index: l.route.stack.findIndex(s => s.handle === docLimiter) }))
      .filter(r => r.index !== 0);
    expect(wrong).toEqual([]);
  });
});
