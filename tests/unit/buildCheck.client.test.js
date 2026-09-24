'use strict';

/**
 * public/js/utils/buildCheck.js — the decisions behind the stale-release guard
 * (services/buildGuard.js). A page that booted from release A and sees responses
 * from release B reloads onto B — but never over unsaved typing, never on a
 * checkout/unstamped build, and never in a loop.
 */
const {
  isRealBuild, isStale, isQuiet, decideOnFocus, reloadBlocked, RELOAD_WINDOW_MS, QUIET_AFTER_MS,
} = require('../../public/js/utils/buildCheck.js');

const A = '37f441eb786f8ba0036bf0bc883674ebef8bdadf';
const B = 'aad57e002497983a9ef420017851190c56e96e38';

describe('isRealBuild', () => {
  test('a SHA is a real build', () => {
    expect(isRealBuild(A)).toBe(true);
  });
  test.each([['dev'], ['unknown'], [''], ['   '], [null], [undefined], [42]])('%p is not', (v) => {
    expect(isRealBuild(v)).toBe(false);
  });
});

describe('isStale', () => {
  test('different real builds → stale', () => {
    expect(isStale(A, B)).toBe(true);
  });
  test('same build (whitespace-insensitive) → not stale', () => {
    expect(isStale(A, ` ${A} `)).toBe(false);
  });
  test('either side dev/unknown/missing → never stale', () => {
    expect(isStale('dev', B)).toBe(false);
    expect(isStale(A, 'dev')).toBe(false);
    expect(isStale(A, 'unknown')).toBe(false);
    expect(isStale(null, B)).toBe(false);
    expect(isStale(A, null)).toBe(false);
  });
});

// Before a navigation or on refocus the guard asks the server which release it is
// only when nothing has said so for a minute — the case the TEST run found (M1):
// a deploy that lands while the user reads a page, then one click.
describe('isQuiet', () => {
  const now = 1_800_000_000_000;
  test('never heard a real build → quiet (ask)', () => {
    expect(isQuiet(0, now)).toBe(true);
  });
  test('heard within the window → not quiet (trust what we saw)', () => {
    expect(isQuiet(now - 5_000, now)).toBe(false);
    expect(isQuiet(now - QUIET_AFTER_MS, now)).toBe(false);
  });
  test('heard longer ago than the window → quiet', () => {
    expect(isQuiet(now - QUIET_AFTER_MS - 1, now)).toBe(true);
  });
  test('a non-number timestamp is treated as never heard', () => {
    expect(isQuiet(NaN, now)).toBe(true);
    expect(isQuiet(undefined, now)).toBe(true);
  });
});

describe('decideOnFocus', () => {
  test('not stale → none, whatever else is true', () => {
    expect(decideOnFocus({ stale: false, edited: true, reloadBlocked: true })).toBe('none');
    expect(decideOnFocus({ stale: false, edited: false, reloadBlocked: false })).toBe('none');
  });
  test('stale and nothing typed → reload', () => {
    expect(decideOnFocus({ stale: true, edited: false, reloadBlocked: false })).toBe('reload');
  });
  test('stale but something typed → banner, the input is kept', () => {
    expect(decideOnFocus({ stale: true, edited: true, reloadBlocked: false })).toBe('banner');
  });
  test('stale but a reload for this build just failed to take → banner, no loop', () => {
    expect(decideOnFocus({ stale: true, edited: false, reloadBlocked: true })).toBe('banner');
  });
});

describe('reloadBlocked (loop guard)', () => {
  const now = 1_800_000_000_000;
  test('no previous attempt → not blocked', () => {
    expect(reloadBlocked(null, B, now)).toBe(false);
    expect(reloadBlocked(undefined, B, now)).toBe(false);
    expect(reloadBlocked('garbage', B, now)).toBe(false);
  });
  test('same build reloaded moments ago → blocked', () => {
    expect(reloadBlocked({ build: B, at: now - 5_000 }, B, now)).toBe(true);
  });
  test('same build but outside the window → allowed again', () => {
    expect(reloadBlocked({ build: B, at: now - RELOAD_WINDOW_MS - 1 }, B, now)).toBe(false);
  });
  test('an attempt for a different (older) build does not block the newer one', () => {
    expect(reloadBlocked({ build: A, at: now - 5_000 }, B, now)).toBe(false);
  });
  test('a malformed timestamp never blocks', () => {
    expect(reloadBlocked({ build: B, at: 'yesterday' }, B, now)).toBe(false);
  });
});
