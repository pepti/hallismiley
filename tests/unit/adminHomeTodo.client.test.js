'use strict';

// public/js/views/AdminView.js renderHome — the "Í dag" attention rows added in
// harvest 2 lane 5 (icelandicstore #417): sold out and sign-ups awaiting
// approval link to their FILTERED lists, and a to-do whose source could not be
// read shows "—", never 0.

jest.mock('../../public/js/services/auth.js', () => ({
  isAuthenticated: () => true, canEdit: () => true, canSeeView: () => true,
}));
jest.mock('../../public/js/utils/modules.js', () => ({ moduleEnabled: () => true }));
jest.mock('../../public/js/navigate.js', () => ({ navigateReplace: jest.fn() }));
jest.mock('../../public/js/components/AdminSidebar.js', () => ({
  renderAdminShell: () => ({}), ADMIN_NAV: [], adminIcon: () => '',
}));
jest.mock('../../public/js/views/booksShared.js', () => ({ isk: n => `${n} kr.` }));
jest.mock('../../public/js/utils/format.js', () => ({ formatNumber: n => String(n) }));
jest.mock('../../public/js/i18n/i18n.js', () => {
  const t = (k, p = {}) => `${k}${p.n !== undefined ? `|${p.n}` : ''}`;
  return {
    t,
    href: r => `/is${r}`,
    plural: (n, one, many, p = {}) => t(n === 1 ? one : many, { n, ...p }),
    isSingular: n => n === 1,
    getLocale: () => 'is',
  };
});

const { renderHome } = require('../../public/js/views/AdminView.js');

const base = { generatedAt: '2026-09-26T12:00:00.000Z', figures: {}, recent: [] };

test('sold out and sign-ups link to exactly the filtered lists', () => {
  const html = renderHome({
    ...base,
    todo: [
      { kind: 'out_of_stock', view: 'products', route: '/admin/shop/products?stock=out', count: 3, detail: { sample: ['Bolli', 'Diskur'] } },
      { kind: 'signups_pending', view: 'users', route: '/admin/users?status=pending', count: 2, detail: { oldestAt: '2026-09-20T10:00:00Z' } },
      { kind: 'orders_to_ship', view: 'orders', route: '/admin/shop/orders?view=open', count: 5, detail: {} },
      { kind: 'change_requests_open', view: 'feedback', route: '/admin/feedback?status=open', count: 1, detail: {} },
    ],
  });
  expect(html).toContain('href="/is/admin/shop/products?stock=out"');
  expect(html).toContain('href="/is/admin/users?status=pending"');
  expect(html).toContain('href="/is/admin/shop/orders?view=open"');
  expect(html).toContain('href="/is/admin/feedback?status=open"');
  expect(html).toContain('Bolli, Diskur');
  expect(html).toMatch(/data-kind="out_of_stock"[\s\S]*?idag-todo__n">3</);
});

test('a source that could not be read shows "—", not 0, and keeps its link', () => {
  const html = renderHome({
    ...base,
    todo: [{ kind: 'orders_to_ship', view: 'orders', route: '/admin/shop/orders?view=open', count: null, failed: true, tone: null }],
    errors: ['todo.orders_to_ship', 'figures.openOrders'],
  });
  expect(html).toContain('data-failed="true"');
  expect(html).toMatch(/idag-todo__n">—</);
  expect(html).not.toMatch(/idag-todo__n">0</);
  expect(html).toContain('adminHome.waiting.tag.unread');
  expect(html).toContain('href="/is/admin/shop/orders?view=open"');
  // Not "all clear" — something may be waiting.
  expect(html).not.toContain('adminHome.waiting.allClear.title');
});
