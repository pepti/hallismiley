// Guards the instance-level hidden set: every id in HIDDEN_ADMIN_VIEWS
// (public/js/components/adminSurface.js) must be a real admin view id, or a
// typo would silently hide nothing while the comment claims it hides a screen.
// Parses the client file as text, like admin-views-parity.test.js (ESM vs CJS).
const fs = require('fs');
const path = require('path');
const { ADMIN_VIEW_IDS } = require('../../server/auth/adminViews');

test('every HIDDEN_ADMIN_VIEWS id is a real ADMIN_VIEW_IDS entry', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../public/js/components/adminSurface.js'), 'utf8'
  );
  const start = src.indexOf('export const HIDDEN_ADMIN_VIEWS');
  const end   = src.indexOf(']);', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const ids = [...src.slice(start, end).matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(ADMIN_VIEW_IDS).toContain(id);
  // The policy must never swallow the whole console.
  expect(ids).not.toContain('dashboard');
  expect(ids).not.toContain('roles');
});
