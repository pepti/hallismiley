// Per-id upload directories interpolate a row id that started life as a route
// param. path.join() resolves `..` segments happily, so an id carrying a
// separator would place uploads outside UPLOAD_ROOT — these pin the guard that
// rejects such ids instead of sanitising them.
const path = require('path');
const {
  UPLOAD_ROOT,
  BOOKS_UPLOAD_ROOT,
  productUploadDir,
  newsUploadDir,
  projectUploadDir,
  booksDocumentDir,
  userAvatarDir,
  backgroundUploadDir,
} = require('../../server/config/paths');

const PER_ID_DIRS = [
  ['productUploadDir',         productUploadDir],
  ['newsUploadDir',            newsUploadDir],
  ['projectUploadDir',         projectUploadDir],
];

// An id that decodes out of one path segment. `/products/..%2F..%2Fevil/images`
// arrives at Express as a single param with the slashes already decoded.
const REJECTED_IDS = [
  '../../evil',
  '..\\..\\evil',
  '..',
  '.',
  'a/b',
  'a\\b',
  'x/../../..',
  '',
  'abc\0def',
  // win32 strips a trailing dot or space, so these would silently collide with
  // 'abc' / write into the parent directory rather than a child.
  'abc.',
  'abc ',
  ' ',
  // Not directories on Windows — these fail at mkdir with an opaque errno.
  'CON', 'nul', 'COM1', 'LPT9',
  // Drive-relative and alternate-data-stream shapes.
  'C:', 'a:b',
];

// String(undefined) is 'undefined' — a perfectly legal-looking directory name.
// Left unguarded these silently funnel unrelated rows into one shared folder,
// which is the orphan growth the guard exists to prevent, so they must throw.
const NON_SCALAR_IDS = [undefined, null, {}, [], ['a', 'b'], true];

describe('per-id upload directories', () => {
  test.each(PER_ID_DIRS)('%s accepts a uuid id and stays under UPLOAD_ROOT', (_name, dirFn) => {
    const id  = '9f3a1c2e-6b41-4d0a-9c77-2b1e5f0a8d34';
    const dir = dirFn(id);
    // Compare on the relative path, not a bare startsWith: '<root>-evil' is a
    // prefix match but is NOT inside the root.
    const rel = path.relative(path.resolve(UPLOAD_ROOT), path.resolve(dir));
    expect(rel.startsWith('..')).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
    expect(path.basename(dir)).toBe(id);
  });

  test.each(PER_ID_DIRS)('%s accepts a numeric id (SERIAL tables)', (_name, dirFn) => {
    expect(path.basename(dirFn(42))).toBe('42');
  });

  describe.each(PER_ID_DIRS)('%s rejects ids that escape or confuse their segment', (_name, dirFn) => {
    test.each(REJECTED_IDS)('throws on %p', (badId) => {
      expect(() => dirFn(badId)).toThrow(/Unsafe .* upload path/);
    });
  });

  describe.each(PER_ID_DIRS)('%s rejects a missing or non-scalar id', (_name, dirFn) => {
    test.each(NON_SCALAR_IDS)('throws on %p', (badId) => {
      expect(() => dirFn(badId)).toThrow(/Missing or non-scalar .* upload path/);
    });
  });

  test('the flat (non-per-id) dirs take no argument and stay inside the root', () => {
    for (const dir of [userAvatarDir(), backgroundUploadDir()]) {
      const rel = path.relative(path.resolve(UPLOAD_ROOT), path.resolve(dir));
      expect(rel.startsWith('..')).toBe(false);
    }
  });
});

// booksDocumentDir lives under its OWN root (BOOKS_UPLOAD_ROOT, deliberately
// outside UPLOAD_ROOT — fylgiskjöl are never served by express.static), so it
// gets its own containment check. Its bucket is server-generated (YYYY-MM or
// 'demo'), but the segment guard still applies as defence-in-depth.
describe('booksDocumentDir', () => {
  test('stays under BOOKS_UPLOAD_ROOT for a year-month bucket', () => {
    const dir = booksDocumentDir('2026-08');
    const rel = path.relative(path.resolve(BOOKS_UPLOAD_ROOT), path.resolve(dir));
    expect(rel.startsWith('..')).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
    expect(path.basename(dir)).toBe('2026-08');
  });

  test.each(REJECTED_IDS)('throws on %p', (bad) => {
    expect(() => booksDocumentDir(bad)).toThrow(/Unsafe .* upload path/);
  });

  test.each(NON_SCALAR_IDS)('throws on non-scalar %p', (bad) => {
    expect(() => booksDocumentDir(bad)).toThrow(/Missing or non-scalar .* upload path/);
  });
});
