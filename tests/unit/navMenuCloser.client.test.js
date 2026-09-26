'use strict';
/* global document */

// public/js/components/NavBar.js + navMenuCloser.js — the nav's account menu
// is closed by ONE document-level click listener, however often the auth area
// re-renders (ported from icelandicstore #379). Before, every _renderAuthInto
// run (top bar + drawer, on each authchange / userchange / locale switch)
// added its own, and a long-lived tab piled them up. This repo has no jsdom:
// a minimal fake DOM stands in, enough for the nav's auth render to run.

let mockAuthed = true;

jest.mock('../../public/js/services/auth.js', () => ({
  isAuthenticated: () => mockAuthed,
  getUser:         () => ({ id: 'u1', username: 'halli', avatar: null }),
  logout:          async () => {},
  updateProfile:   jest.fn(async () => {}),
  hasAnyAdminView: () => true,
  isSeller:        () => false,
}));
jest.mock('../../public/js/utils/identity.js', () => ({
  getIdentity: () => ({ surface: { navSignIn: true } }),
  publicNav:   () => [],
}));
jest.mock('../../public/js/components/LoginModal.js', () => ({ LoginModal: class { open() {} } }));
jest.mock('../../public/js/components/CartIcon.js', () => ({ CartIcon: class { render() { return {}; } } }));
jest.mock('../../public/js/utils/modules.js', () => ({ moduleEnabled: () => true }));
jest.mock('../../public/js/i18n/i18n.js', () => ({
  t:                 (k) => k,
  getLocale:         () => 'is',
  switchLocale:      jest.fn(),
  href:              (r) => r,
  SUPPORTED_LOCALES: ['is', 'en'],
  forcedLocaleFor:   () => null,
}));
jest.mock('../../public/js/navigate.js', () => ({ navigate: jest.fn() }));

// The smallest element the auth render touches.
function fakeEl(tag = 'div') {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    innerHTML: '',
    dataset: {},
    attrs: {},
    children: [],
    listeners: {},
    parentElement: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    querySelector() { return fakeEl('button'); },
    querySelectorAll() { return []; },
  };
  return el;
}

let NavBar, closer;

beforeEach(() => {
  jest.resetModules();
  global.window = { addEventListener: jest.fn() };
  global.document = {
    createElement: (tag) => fakeEl(tag),
    addEventListener: jest.fn(),
    querySelectorAll: jest.fn(() => []),
  };
  ({ NavBar } = require('../../public/js/components/NavBar.js'));
  closer = require('../../public/js/components/navMenuCloser.js');
  closer._resetMenuCloserForTests();
});

const clickListeners = () => document.addEventListener.mock.calls.filter(([type]) => type === 'click');

test('one document click listener after N signed-in auth renders (top bar + drawer)', () => {
  mockAuthed = true;
  const container = fakeEl();
  for (let i = 0; i < 12; i++) {
    NavBar.prototype._renderAuthInto.call({}, container, i % 2 ? 'drawer' : 'top');
  }
  expect(clickListeners()).toHaveLength(1);
});

test('installMenuCloser is idempotent', () => {
  for (let i = 0; i < 5; i++) closer.installMenuCloser();
  expect(clickListeners()).toHaveLength(1);
});

test('the closer closes every open menu, and aria-expanded follows', () => {
  closer.installMenuCloser();
  const btn = fakeEl('button');
  const wrap = { querySelector: () => btn };
  const menu = fakeEl();
  menu.parentElement = wrap;
  menu.classList.add('open');
  document.querySelectorAll.mockReturnValue([menu]);
  const [[, onClick]] = clickListeners();
  onClick();
  expect(document.querySelectorAll).toHaveBeenCalledWith('.lol-nav__dropdown.open');
  expect(menu.classList.contains('open')).toBe(false);
  expect(btn.attrs['aria-expanded']).toBe('false');
});

test('closeMenus(except) leaves the menu being toggled alone', () => {
  const a = fakeEl(); a.parentElement = { querySelector: () => null }; a.classList.add('open');
  const b = fakeEl(); b.parentElement = { querySelector: () => null }; b.classList.add('open');
  document.querySelectorAll.mockReturnValue([a, b]);
  closer.closeMenus(b);
  expect(a.classList.contains('open')).toBe(false);
  expect(b.classList.contains('open')).toBe(true);
});

test('the language switcher binds each button once however often it is re-bound', () => {
  const opt = fakeEl('button');
  opt.dataset.locale = 'en';
  const nav = { querySelectorAll: (sel) => (sel === '.lol-nav__lang-opt' ? [opt] : []) };
  for (let i = 0; i < 4; i++) NavBar.prototype._bindLangSwitcher.call({}, nav);
  expect(opt.listeners.click).toHaveLength(1);
});
