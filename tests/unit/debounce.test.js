/**
 * public/js/utils/debounce.js replaces ~10 hand-rolled copies across the admin
 * views. The behaviours that matter are the ones the copies got subtly
 * different: last-args-win, and a cancel() a view can call from destroy() so a
 * pending search cannot fire against a torn-down DOM.
 *
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 */
const { debounce } = require('../../public/js/utils/debounce.js');

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('debounce', () => {
  test('fires once, on the trailing edge', () => {
    const fn = jest.fn();
    const d = debounce(fn, 250);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('the LAST arguments win — the point of a search box', () => {
    const fn = jest.fn();
    const d = debounce(fn, 250);
    d('h'); d('ha'); d('hal');
    jest.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledWith('hal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a gap longer than the delay starts a new run', () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);
    d('a');
    jest.advanceTimersByTime(100);
    d('b');
    jest.advanceTimersByTime(100);
    expect(fn.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  test('cancel() stops a queued call — a destroyed view fires nothing', () => {
    const fn = jest.fn();
    const d = debounce(fn, 250);
    d('typed');
    d.cancel();
    jest.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  test('cancel() is safe with nothing queued, and reusable afterwards', () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);
    expect(() => d.cancel()).not.toThrow();
    d('after');
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('after');
  });

  test('pending() reports whether a run is queued', () => {
    const d = debounce(() => {}, 100);
    expect(d.pending()).toBe(false);
    d();
    expect(d.pending()).toBe(true);
    jest.advanceTimersByTime(100);
    expect(d.pending()).toBe(false);
  });

  test('defaults to the house 250 ms', () => {
    const fn = jest.fn();
    const d = debounce(fn);
    d();
    jest.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
