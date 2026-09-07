/**
 * The admin kit's string half: adminTable, adminPager, listState.
 *
 * These are pure builders precisely so they can be tested here —
 * testEnvironment is 'node' with no jsdom, so the bind*() halves are e2e's job
 * (e2e/admin-list-kit.spec.js) and everything that returns a string is pinned
 * below.
 *
 * t() falls back to returning the key when no dictionary is loaded, which is
 * exactly what happens under node. That keeps these assertions about STRUCTURE
 * — aria-sort, data-sort-field, disabled state, page arithmetic — rather than
 * about translated prose. check:i18n separately proves the keys exist.
 *
 * babel-jest compiles the ESM modules to CJS for require() (see money.client.test.js).
 */
const { sortableTh, cycleSort } = require('../../public/js/components/adminTable.js');
const { pagerHtml, pageCount, clampPageSize, showingRange, PAGE_SIZES } = require('../../public/js/components/adminPager.js');
const { readListState, syncListState, pageSizeKey } = require('../../public/js/utils/listState.js');

describe('sortableTh', () => {
  const SORT = { field: 'created_at', dir: 'desc' };

  test('marks only the active column, and says which way', () => {
    const active = sortableTh('Date', 'created_at', SORT);
    expect(active).toContain('aria-sort="descending"');
    expect(active).toContain('is-active');
    expect(active).toContain('▼');

    const idle = sortableTh('Email', 'email', SORT);
    expect(idle).toContain('aria-sort="none"');
    expect(idle).not.toContain('is-active');
  });

  test('ascending shows the up arrow and the matching aria-sort', () => {
    const th = sortableTh('Email', 'email', { field: 'email', dir: 'asc' });
    expect(th).toContain('aria-sort="ascending"');
    expect(th).toContain('▲');
  });

  test('the control is a real button — Enter and Space come free, no keydown branch', () => {
    const th = sortableTh('Email', 'email', SORT);
    expect(th).toContain('<button type="button"');
    expect(th).toContain('data-sort-field="email"');
    // aria-sort belongs on the th, where the accessibility tree expects it.
    expect(th.indexOf('aria-sort')).toBeLessThan(th.indexOf('<button'));
  });

  test('the arrow is always present so column widths do not jump', () => {
    expect(sortableTh('Email', 'email', SORT)).toContain('admin-table__sort-arrow');
  });

  test('the arrow is hidden from assistive tech; the button carries the intent', () => {
    const th = sortableTh('Email', 'email', SORT);
    expect(th).toContain('aria-hidden="true"');
    expect(th).toContain('aria-label=');
  });

  test('escapes a hostile label and field rather than interpolating them raw', () => {
    const th = sortableTh('<img src=x onerror=alert(1)>', 'a"b', SORT);
    expect(th).not.toContain('<img');
    expect(th).toContain('&lt;img');
    expect(th).not.toContain('data-sort-field="a"b"');
  });

  test('carries scope="col" by default', () => {
    expect(sortableTh('Email', 'email', SORT)).toContain('scope="col"');
  });

  test('survives a missing sort object', () => {
    expect(() => sortableTh('Email', 'email', null)).not.toThrow();
    expect(sortableTh('Email', 'email', null)).toContain('aria-sort="none"');
  });
});

describe('cycleSort', () => {
  test('a new column starts ascending', () => {
    expect(cycleSort({ field: 'created_at', dir: 'desc' }, 'email')).toEqual({ field: 'email', dir: 'asc' });
  });

  test('the same column toggles, and keeps toggling', () => {
    let s = { field: 'email', dir: 'asc' };
    s = cycleSort(s, 'email');
    expect(s).toEqual({ field: 'email', dir: 'desc' });
    s = cycleSort(s, 'email');
    expect(s).toEqual({ field: 'email', dir: 'asc' });
  });

  test('two-state: it never lands on an unsorted view the user did not ask for', () => {
    // A default of Date-descending must be invertible to ascending; a
    // three-state cycle would strand the user on "no sort" in between.
    let s = { field: 'created_at', dir: 'desc' };
    for (let i = 0; i < 6; i++) {
      s = cycleSort(s, 'created_at');
      expect(['asc', 'desc']).toContain(s.dir);
      expect(s.field).toBe('created_at');
    }
  });

  test('handles a null starting sort', () => {
    expect(cycleSort(null, 'name')).toEqual({ field: 'name', dir: 'asc' });
  });
});

describe('pageCount and clampPageSize', () => {
  test('counts pages, never returning zero', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(100, 25)).toBe(4);
    expect(pageCount(101, 25)).toBe(5);
  });

  test('a missing or negative total is one empty page, not a crash', () => {
    expect(pageCount(null, 25)).toBe(1);
    expect(pageCount(-5, 25)).toBe(1);
    expect(pageCount(undefined, 25)).toBe(1);
  });

  test('clamps to the range the SERVER accepts', () => {
    // leadsController.js: Math.min(Math.max(limit || 50, 1), 200). Offering a
    // size beyond that would let the client ask for a page the server silently
    // truncates — and the pager would then lie about how many pages exist.
    expect(clampPageSize(500)).toBe(200);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-10)).toBe(1);
    expect(clampPageSize('banana')).toBe(50);
    expect(clampPageSize(undefined)).toBe(50);
    expect(clampPageSize('100')).toBe(100);
  });

  test('every offered size is one the server will honour', () => {
    for (const size of PAGE_SIZES) expect(clampPageSize(size)).toBe(size);
    expect(Math.max(...PAGE_SIZES)).toBe(200);
  });
});

describe('pagerHtml', () => {
  test('renders nothing for a single page with no size picker', () => {
    expect(pagerHtml({ page: 1, total: 10, pageSize: 25 })).toBe('');
    expect(pagerHtml({ page: 1, total: 0, pageSize: 25 })).toBe('');
  });

  test('still renders for a single page when the size picker is wanted', () => {
    const html = pagerHtml({ page: 1, total: 10, pageSize: 25, showSizePicker: true });
    expect(html).toContain('data-page-size');
  });

  test('disables prev on the first page and next on the last', () => {
    const first = pagerHtml({ page: 1, total: 100, pageSize: 25 });
    expect(first).toMatch(/data-page="0"[^>]*disabled/);
    expect(first).not.toMatch(/data-page="2"[^>]*disabled/);

    const last = pagerHtml({ page: 4, total: 100, pageSize: 25 });
    expect(last).toMatch(/data-page="5"[^>]*disabled/);
    expect(last).not.toMatch(/data-page="3"[^>]*disabled/);
  });

  test('the showing-range is arithmetically honest on the last, partial page', () => {
    // 101 rows at 25: page 5 holds exactly one row, and must say so.
    expect(showingRange(5, 101, 25)).toEqual({ from: 101, to: 101 });
    expect(showingRange(1, 101, 25)).toEqual({ from: 1, to: 25 });
    expect(showingRange(4, 101, 25)).toEqual({ from: 76, to: 100 });
  });

  test('an empty list shows a zero range rather than 1–0', () => {
    expect(showingRange(1, 0, 25)).toEqual({ from: 0, to: 0 });
  });

  test('the range clamps with the page rather than running off the end', () => {
    expect(showingRange(99, 30, 25)).toEqual({ from: 26, to: 30 });
  });

  test('clamps a page beyond the end rather than rendering a phantom page', () => {
    const html = pagerHtml({ page: 99, total: 30, pageSize: 25 });
    // 2 pages exist; page 99 collapses to 2, so "next" is disabled.
    expect(html).toMatch(/data-page="3"[^>]*disabled/);
  });

  test('the glyph-only controls carry accessible names', () => {
    const html = pagerHtml({ page: 2, total: 100, pageSize: 25 });
    expect(html).toContain('aria-label=');
    expect(html).toContain('aria-live="polite"');
  });

  test('marks the current size as selected in the picker', () => {
    const html = pagerHtml({ page: 1, total: 500, pageSize: 100, showSizePicker: true });
    expect(html).toContain('<option value="100" selected>');
    expect(html).not.toContain('<option value="25" selected>');
  });
});

describe('listState', () => {
  test('reads values back in the type of their default', () => {
    const st = readListState({ page: 1, q: '', mine: false }, '?page=3&q=hall&mine=1');
    expect(st).toEqual({ page: 3, q: 'hall', mine: true });
  });

  test('an absent key keeps its default', () => {
    expect(readListState({ page: 1, q: '' }, '?q=x')).toEqual({ page: 1, q: 'x' });
  });

  test('junk in a numeric slot falls back instead of asking the API for NaN', () => {
    expect(readListState({ page: 1 }, '?page=banana').page).toBe(1);
  });

  test('ignores parameters the view did not declare', () => {
    expect(readListState({ page: 1 }, '?page=2&evil=1')).toEqual({ page: 2 });
  });

  test('writes only what differs from the defaults, so a pristine list is a clean URL', () => {
    const calls = [];
    global.window = { history: { state: null, replaceState: (a, b, url) => calls.push(url) } };
    const defaults = { page: 1, q: '', sort: 'created_at', dir: 'desc' };

    syncListState('/admin/users', { ...defaults }, defaults);
    expect(calls.pop()).toBe('/admin/users');

    syncListState('/admin/users', { ...defaults, page: 3, q: 'hall' }, defaults);
    const url = calls.pop();
    expect(url).toContain('page=3');
    expect(url).toContain('q=hall');
    expect(url).not.toContain('sort=');
    delete global.window;
  });

  test('a refused history write does not take the list down with it', () => {
    global.window = { history: { state: null, replaceState: () => { throw new Error('SecurityError'); } } };
    expect(() => syncListState('/admin/users', { page: 2 }, { page: 1 })).not.toThrow();
    delete global.window;
  });

  test('page size is namespaced per view', () => {
    expect(pageSizeKey('users')).toBe('admin.users.pageSize');
    expect(pageSizeKey('leads')).not.toBe(pageSizeKey('users'));
  });
});
