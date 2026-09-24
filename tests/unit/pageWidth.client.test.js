'use strict';

// public/js/services/pageWidth.js — page keys and the saved-width lookup
// (sidebar width icon → Síðubreidd).

let mockUser = null;

jest.mock('../../public/js/services/auth.js', () => ({
  getUser:          () => mockUser,
  isAuthenticated:  () => !!mockUser,
  updateCachedUser: (partial) => { if (mockUser) mockUser = { ...mockUser, ...partial }; },
  getCSRFToken:     async () => null,
}));
jest.mock('../../public/js/i18n/i18n.js', () => ({ SUPPORTED_LOCALES: ['en', 'is'] }));

const {
  pageWidthKey, getPageWidth, savePageWidth, saveAllPagesWidth, setPageRoute, inheritedWidth,
  getMotion, saveMotion, enterPageWidth, applyPageWidth,
  getAsideWidth, inheritedAsideWidth, saveAsideWidth, saveAllPagesAsideWidth,
} = require('../../public/js/services/pageWidth.js');

describe('pageWidthKey from the router pattern', () => {
  test('uses the matched pattern, lower-cased, whatever the URL holds', () => {
    expect(pageWidthKey('/is/admin/shop/orders/e2e-order-consign', '/admin/shop/orders/:id'))
      .toBe('/admin/shop/orders/:id');
    expect(pageWidthKey('/admin/accounts/company/x', '/admin/accounts/company/:companyId'))
      .toBe('/admin/accounts/company/:companyid');
  });

  test('a non-admin or unmatched route has no setting', () => {
    expect(pageWidthKey('/is/shop/cart', '/shop/cart')).toBeNull();
    expect(pageWidthKey('/is/nope', null)).toBeNull();
  });

  test('setPageRoute feeds the default', () => {
    setPageRoute('/admin/shop/orders/:id');
    expect(pageWidthKey('/admin/shop/orders/anything')).toBe('/admin/shop/orders/:id');
    setPageRoute(undefined);
    expect(pageWidthKey('/admin/shop/orders/1402')).toBe('/admin/shop/orders/:id');
  });
});

describe('savePageWidth', () => {
  afterEach(() => { delete global.fetch; });

  test('updates the cache before the write lands, and keeps the server answer', async () => {
    mockUser = { id: 'u1', page_widths: { '/admin/x': 'wide' } };
    let release;
    global.fetch = jest.fn(() => new Promise((r) => { release = r; }));
    const done = savePageWidth('/admin/shop/orders', 'full');
    expect(mockUser.page_widths).toEqual({ '/admin/x': 'wide', '/admin/shop/orders': 'full' });
    await new Promise((r) => setImmediate(r));
    release({ ok: true, json: async () => ({ page_widths: { '/admin/shop/orders': 'full' } }) });
    await expect(done).resolves.toBe(true);
    expect(mockUser.page_widths).toEqual({ '/admin/shop/orders': 'full' });
  });

  test('a failed write puts the key back and resolves false', async () => {
    mockUser = { id: 'u1', page_widths: { '/admin/shop/orders': 'normal' } };
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(savePageWidth('/admin/shop/orders', 'full')).resolves.toBe(false);
    expect(mockUser.page_widths).toEqual({ '/admin/shop/orders': 'normal' });

    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    await expect(savePageWidth('/admin/new', 'wide')).resolves.toBe(false);
    expect(mockUser.page_widths).toEqual({ '/admin/shop/orders': 'normal' });
  });

  test('a reset removes the key; nobody signed in means no request', async () => {
    mockUser = { id: 'u1', page_widths: { '/admin/shop/orders': 'full' } };
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ page_widths: {} }) }));
    await expect(savePageWidth('/admin/shop/orders', null)).resolves.toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ path: '/admin/shop/orders', width: null });
    expect(mockUser.page_widths).toEqual({});

    mockUser = null;
    global.fetch = jest.fn();
    await expect(savePageWidth('/admin/shop/orders', 'wide')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('pageWidthKey', () => {
  test.each([
    ['/admin/shop/orders', '/admin/shop/orders'],
    ['/is/admin/shop/orders', '/admin/shop/orders'],
    ['/en/admin/shop/orders/', '/admin/shop/orders'],
    ['/is/admin/shop/orders/3f2c9a1e-8b7d-4c6e-9f0a-1b2c3d4e5f60', '/admin/shop/orders/:id'],
    ['/admin/shop/orders/1402', '/admin/shop/orders/:id'],
    ['/admin/accounts/Some%20Thing', '/admin/accounts/:id'],
    ['/admin/shop/orders?page=2', '/admin/shop/orders'],
    ['/admin', '/admin'],
  ])('%s → %s', (path, key) => {
    expect(pageWidthKey(path)).toBe(key);
  });

  test('non-admin pages and over-long keys have no setting', () => {
    expect(pageWidthKey('/is/shop/cart')).toBeNull();
    expect(pageWidthKey('/')).toBeNull();
    expect(pageWidthKey('/admin/' + 'a'.repeat(130))).toBeNull();
  });

  test('every key it makes passes the server pattern', () => {
    const re = /^\/admin(\/[a-z0-9:-]+)*$/;
    for (const p of ['/is/admin/x/ÁÐ/12', '/admin/a_b/c.d', '/admin/shop/orders/abc-DEF']) {
      expect(pageWidthKey(p)).toMatch(re);
    }
  });
});

describe('getPageWidth', () => {
  test('falls back to the page default without a saved choice', () => {
    mockUser = null;
    expect(getPageWidth('/admin/shop/orders', 'wide')).toBe('wide');
    mockUser = { page_widths: {} };
    expect(getPageWidth('/admin/shop/orders', 'normal')).toBe('normal');
  });

  test('uses the saved choice, and ignores a value it does not know', () => {
    mockUser = { page_widths: { '/admin/shop/orders': 'full', '/admin/x': 'giant' } };
    expect(getPageWidth('/admin/shop/orders', 'wide')).toBe('full');
    expect(getPageWidth('/admin/x', 'normal')).toBe('normal');
    expect(getPageWidth(null, 'wide')).toBe('wide');
  });
});

describe('the all-pages width ("*")', () => {
  afterEach(() => { delete global.fetch; });

  test('sits between the page\'s own choice and the page default', () => {
    mockUser = { page_widths: { '*': 'wide', '/admin/shop/orders': 'full' } };
    expect(getPageWidth('/admin/shop/orders', 'normal')).toBe('full');
    expect(getPageWidth('/admin/shop/import', 'normal')).toBe('wide');
    expect(getPageWidth(null, 'normal')).toBe('wide');
    expect(inheritedWidth('normal')).toBe('wide');

    mockUser = { page_widths: { '*': 'giant' } };
    expect(getPageWidth('/admin/shop/import', 'normal')).toBe('normal');
  });

  test('saving it replaces the cached map at once; a failed write restores it', async () => {
    mockUser = { id: 'u1', page_widths: { '/admin/shop/orders': 'full' } };
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const done = saveAllPagesWidth('wide');
    expect(mockUser.page_widths).toEqual({ '*': 'wide' });
    await expect(done).resolves.toBe(false);
    expect(mockUser.page_widths).toEqual({ '/admin/shop/orders': 'full' });

    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ page_widths: { '*': 'wide' } }) }));
    await expect(saveAllPagesWidth('wide')).resolves.toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ path: '*', width: 'wide' });
    expect(mockUser.page_widths).toEqual({ '*': 'wide' });
  });
});

describe('Mjúk hreyfing (the slide)', () => {
  afterEach(() => { delete global.fetch; delete global.requestAnimationFrame; });

  const fakeShell = () => {
    const cls = new Set();
    return { isConnected: true, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: (c) => cls.has(c) } };
  };

  test('a detached shell (the user already left) does not move the slide start', () => {
    const frames = [];
    global.requestAnimationFrame = (fn) => frames.push(fn);
    mockUser = { page_widths: {} };
    setPageRoute('/admin/shop/orders');
    applyPageWidth(fakeShell(), 'normal');
    applyPageWidth({ ...fakeShell(), isConnected: false }, 'full');
    const shell = fakeShell();
    enterPageWidth(shell, 'normal');
    expect(shell.classList.has('admin-shell--full')).toBe(false);
    expect(frames).toHaveLength(0);
  });

  test('an older toggle failing does not undo a newer one', async () => {
    mockUser = { id: 'u1', page_width_motion: true };
    let n = 0;
    global.fetch = jest.fn(async () => ({ ok: ++n !== 1 }));
    const first = saveMotion(false);
    const second = saveMotion(true);
    const third = saveMotion(false);
    await expect(first).resolves.toBe(true);      // superseded: no toast
    await expect(second).resolves.toBe(true);
    await expect(third).resolves.toBe(true);
    expect(mockUser.page_width_motion).toBe(false);
  });

  test('is on unless the account turned it off', () => {
    mockUser = null;
    expect(getMotion()).toBe(true);
    mockUser = { page_width_motion: false };
    expect(getMotion()).toBe(false);
  });

  test('saveMotion updates the cache first and puts it back on a failed write', async () => {
    mockUser = { id: 'u1', page_width_motion: true };
    global.fetch = jest.fn(async () => ({ ok: false }));
    const done = saveMotion(false);
    expect(mockUser.page_width_motion).toBe(false);
    await expect(done).resolves.toBe(false);
    expect(mockUser.page_width_motion).toBe(true);

    global.fetch = jest.fn(async () => ({ ok: true }));
    await expect(saveMotion(false)).resolves.toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ on: false });
    expect(mockUser.page_width_motion).toBe(false);
  });

  test('a new shell starts at the previous page\'s width and moves on the next frames', () => {
    mockUser = { page_widths: {} };
    const frames = [];
    global.requestAnimationFrame = (fn) => frames.push(fn);
    setPageRoute('/admin/shop/orders');
    applyPageWidth(fakeShell(), 'wide');

    const shell = fakeShell();
    enterPageWidth(shell, 'normal');
    expect(shell.classList.has('admin-shell--motion')).toBe(true);
    expect(shell.classList.has('admin-shell--wide')).toBe(true);   // the old width first
    frames.shift()(); frames.shift()();
    expect(shell.classList.has('admin-shell--wide')).toBe(false);  // then its own
  });

  test('off, or arriving from outside the admin: straight to the width, no slide class', () => {
    const frames = [];
    global.requestAnimationFrame = (fn) => frames.push(fn);
    mockUser = { page_width_motion: false };
    setPageRoute('/admin/shop/orders');
    applyPageWidth(fakeShell(), 'wide');
    let shell = fakeShell();
    enterPageWidth(shell, 'normal');
    expect(shell.classList.has('admin-shell--motion')).toBe(false);
    expect(shell.classList.has('admin-shell--wide')).toBe(false);

    mockUser = { page_widths: {} };
    applyPageWidth(fakeShell(), 'wide');
    setPageRoute('/shop/cart');
    shell = fakeShell();
    enterPageWidth(shell, 'normal');
    expect(shell.classList.has('admin-shell--wide')).toBe(false);
    expect(frames).toHaveLength(0);
  });
});

describe('the right-hand column width (aside_widths)', () => {
  afterEach(() => { delete global.fetch; });

  test('own choice, then the all-pages width, then the page default', () => {
    mockUser = { aside_widths: { '*': 'wide', '/admin/shop/orders/:id': 'narrow' } };
    expect(getAsideWidth('/admin/shop/orders/:id', 'medium')).toBe('narrow');
    expect(getAsideWidth('/admin/accounts/company/:companyid', 'narrow')).toBe('wide');
    expect(inheritedAsideWidth('medium')).toBe('wide');

    mockUser = { aside_widths: { '/admin/shop/orders/:id': 'full' } };   // a page width, not a column width
    expect(getAsideWidth('/admin/shop/orders/:id', 'medium')).toBe('medium');
    mockUser = { page_widths: { '*': 'wide' } };                         // the page map is not read
    expect(getAsideWidth('/admin/shop/orders/:id', 'narrow')).toBe('narrow');
  });

  test('saves to its own endpoint and field; a failed write puts the key back', async () => {
    mockUser = { id: 'u1', page_widths: { '/admin/x': 'wide' }, aside_widths: {} };
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ aside_widths: { '/admin/shop/orders/:id': 'wide' } }) }));
    await expect(saveAsideWidth('/admin/shop/orders/:id', 'wide')).resolves.toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/users/me/aside-width');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ path: '/admin/shop/orders/:id', width: 'wide' });
    expect(mockUser.aside_widths).toEqual({ '/admin/shop/orders/:id': 'wide' });
    expect(mockUser.page_widths).toEqual({ '/admin/x': 'wide' });

    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(saveAsideWidth('/admin/shop/orders/:id', 'narrow')).resolves.toBe(false);
    expect(mockUser.aside_widths).toEqual({ '/admin/shop/orders/:id': 'wide' });
  });

  test('"all pages" replaces the cached map at once; a failed write restores it', async () => {
    mockUser = { id: 'u1', aside_widths: { '/admin/shop/orders/:id': 'narrow' } };
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const done = saveAllPagesAsideWidth('wide');
    expect(mockUser.aside_widths).toEqual({ '*': 'wide' });
    await expect(done).resolves.toBe(false);
    expect(mockUser.aside_widths).toEqual({ '/admin/shop/orders/:id': 'narrow' });
  });
});
