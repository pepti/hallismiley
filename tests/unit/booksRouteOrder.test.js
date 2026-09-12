/**
 * Middleware order on the bookkeeping document routes.
 *
 * `docLimiter` (server/middleware/booksLimiters.js, 60 / 15 min per IP)
 * bounds the cost of the streaming/PDF/CSV endpoints. `router.use(requireAuth)`
 * already precedes every route, so anonymous traffic never reaches it in
 * either order; what the order decides is whether an AUTHENTICATED caller who
 * lacks the view is counted before the guard runs (and before the guard's
 * role lookup) or can hit the guard unbounded. Eleven sibling routes put the
 * limiter first; `GET /documents/:id` had it after the guard until 2026-09-12.
 * This test fails on that code.
 *
 * Inspects the router's own stack — no server boot, no database. Requiring
 * the router does evaluate `documentService.createDocumentUpload()`, which
 * mkdirs the (gitignored) books upload directory once; harmless and
 * idempotent.
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
