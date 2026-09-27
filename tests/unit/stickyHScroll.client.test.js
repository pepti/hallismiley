'use strict';

/**
 * public/js/utils/stickyHScroll.js — keyboard reach for a region that scrolls
 * sideways (harvest 2 lane 4a; the pattern of icelandicstore #279, 39fe3d5).
 *
 * WCAG 2.1.1: a region a mouse user can scroll sideways must be reachable from
 * the keyboard. The wrap therefore carries tabindex="0" + role="region" + an
 * aria-label WHILE it overflows, and nothing when it does not. Overflow is
 * re-measured by a ResizeObserver, on window resize and on visibilitychange
 * (a tab that is not painting delivers no observer callbacks; ice #279 found
 * exactly that gap on TEST).
 *
 * No jsdom here: a minimal fake element with the attribute, classList and event
 * surface the module touches. babel-jest compiles the ESM module to CJS.
 */

function fakeEl(attrs = {}) {
  const a = new Map(Object.entries(attrs));
  const listeners = new Map();
  const classes = new Set();
  return {
    scrollWidth: 0,
    clientWidth: 0,
    scrollLeft: 0,
    hidden: false,
    style: {},
    className: '',
    setAttribute: (k, v) => a.set(k, String(v)),
    getAttribute: (k) => (a.has(k) ? a.get(k) : null),
    hasAttribute: (k) => a.has(k),
    removeAttribute: (k) => a.delete(k),
    classList: {
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    appendChild() {},
    after() {},
    remove() {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    listeners,
  };
}

describe('stickyHScroll — the wrap is a focusable region only while it overflows', () => {
  let docListeners;
  let winListeners;
  let observed;
  const saved = {};

  beforeEach(() => {
    docListeners = new Map();
    winListeners = new Map();
    observed = null;
    saved.document = global.document;
    saved.window = global.window;
    saved.RO = global.ResizeObserver;
    global.document = {
      createElement: () => fakeEl(),
      addEventListener: (type, fn) => docListeners.set(type, fn),
      removeEventListener: (type) => docListeners.delete(type),
    };
    global.window = {
      location: { pathname: '/is/admin/shop/orders', search: '' },
      addEventListener: (type, fn) => winListeners.set(type, fn),
      removeEventListener: (type) => winListeners.delete(type),
    };
    global.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe() { observed = this.cb; }
      disconnect() { observed = null; }
    };
  });

  afterEach(() => {
    global.document = saved.document;
    global.window = saved.window;
    global.ResizeObserver = saved.RO;
  });

  const load = () => require('../../public/js/utils/stickyHScroll.js');

  test('no overflow on attach: no tabindex, no role, no label', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 800; wrap.clientWidth = 800;
    load().attachStickyHScroll(wrap, { label: 'Pantanir' });
    expect(wrap.getAttribute('tabindex')).toBeNull();
    expect(wrap.getAttribute('role')).toBeNull();
    expect(wrap.getAttribute('aria-label')).toBeNull();
  });

  test('overflow on attach: tabindex 0, role region, the given label', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 1400; wrap.clientWidth = 800;
    load().attachStickyHScroll(wrap, { label: 'Pantanir' });
    expect(wrap.getAttribute('tabindex')).toBe('0');
    expect(wrap.getAttribute('role')).toBe('region');
    expect(wrap.getAttribute('aria-label')).toBe('Pantanir');
  });

  test('without a label the kit default (adminKit.scrollRegion) is used', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 1400; wrap.clientWidth = 800;
    load().attachStickyHScroll(wrap);
    // No locale is loaded in a unit test, so t() answers with the key itself.
    expect(wrap.getAttribute('aria-label')).toBe('adminKit.scrollRegion');
  });

  test('the ResizeObserver flips it both ways', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 800; wrap.clientWidth = 800;
    load().attachStickyHScroll(wrap, { label: 'x' });
    expect(typeof observed).toBe('function');
    wrap.clientWidth = 500; observed();
    expect(wrap.getAttribute('tabindex')).toBe('0');
    wrap.clientWidth = 900; observed();
    expect(wrap.getAttribute('tabindex')).toBeNull();
    expect(wrap.getAttribute('aria-label')).toBeNull();
  });

  test('a size change while hidden is caught on visibilitychange (ice #279)', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 800; wrap.clientWidth = 800;
    load().attachStickyHScroll(wrap, { label: 'x' });
    // The container shrinks while the tab is not painting: no observer callback.
    wrap.clientWidth = 500;
    expect(wrap.getAttribute('tabindex')).toBeNull();
    docListeners.get('visibilitychange')();
    expect(wrap.getAttribute('tabindex')).toBe('0');
    // …and restored, the next look removes it again.
    wrap.clientWidth = 800;
    docListeners.get('visibilitychange')();
    expect(wrap.getAttribute('tabindex')).toBeNull();
  });

  test('window resize re-measures too', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 800; wrap.clientWidth = 800;
    load().attachStickyHScroll(wrap, { label: 'x' });
    wrap.clientWidth = 400;
    winListeners.get('resize')();
    expect(wrap.getAttribute('tabindex')).toBe('0');
  });

  test("attributes the wrap already carried are its own and are never removed", () => {
    const wrap = fakeEl({ tabindex: '-1', 'aria-label': 'Eigin merking' });
    wrap.scrollWidth = 1400; wrap.clientWidth = 800;
    const h = load().attachStickyHScroll(wrap, { label: 'x' });
    expect(wrap.getAttribute('tabindex')).toBe('-1');
    expect(wrap.getAttribute('aria-label')).toBe('Eigin merking');
    expect(wrap.getAttribute('role')).toBe('region');
    wrap.clientWidth = 1500; h.refresh();
    expect(wrap.getAttribute('tabindex')).toBe('-1');
    expect(wrap.getAttribute('aria-label')).toBe('Eigin merking');
    expect(wrap.getAttribute('role')).toBeNull();
  });

  test('detach drops the listeners and the attributes it added', () => {
    const wrap = fakeEl();
    wrap.scrollWidth = 1400; wrap.clientWidth = 800;
    const h = load().attachStickyHScroll(wrap, { label: 'x' });
    expect(docListeners.has('visibilitychange')).toBe(true);
    h.detach();
    expect(docListeners.has('visibilitychange')).toBe(false);
    expect(winListeners.has('resize')).toBe(false);
    expect(observed).toBeNull();
    expect(wrap.getAttribute('tabindex')).toBeNull();
    expect(wrap.getAttribute('role')).toBeNull();
  });
});
