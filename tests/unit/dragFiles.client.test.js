'use strict';

/**
 * public/js/utils/dragFiles.js — the drag-time file check a drop zone uses to
 * refuse an unsupported type while it is still in the air (ported from
 * icelandicstore #193; first engine user: the product-image drop zone in
 * AdminProductsView). The drag-and-drop spec hides file NAMES until the drop,
 * so the check is on DataTransferItem.type alone. babel-jest compiles the ESM.
 */
const { dragHasFiles, dragHasUsableFile } = require('../../public/js/utils/dragFiles.js');

const IMAGE = /^image\/(jpeg|png|webp)$/;
const dt = (...types) => ({ items: types.map((type) => ({ kind: 'file', type })) });

describe('dragHasFiles', () => {
  test('a file drag carries the Files type', () => {
    expect(dragHasFiles({ dataTransfer: { types: ['Files'] } })).toBe(true);
  });
  test('dragged text or a link is left alone', () => {
    expect(dragHasFiles({ dataTransfer: { types: ['text/plain', 'text/uri-list'] } })).toBe(false);
    expect(dragHasFiles({})).toBe(false);
  });
});

describe('dragHasUsableFile', () => {
  test('a supported type is accepted', () => {
    expect(dragHasUsableFile(dt('image/png'), IMAGE)).toBe(true);
  });

  test('an unsupported type is refused while dragging', () => {
    expect(dragHasUsableFile(dt('application/zip'), IMAGE)).toBe(false);
    expect(dragHasUsableFile(dt('image/gif'), IMAGE)).toBe(false);
    expect(dragHasUsableFile(dt('application/pdf', 'text/plain'), IMAGE)).toBe(false);
  });

  test('one usable file in a mixed drag is enough (the drop skips the rest and counts them)', () => {
    expect(dragHasUsableFile(dt('application/zip', 'image/webp'), IMAGE)).toBe(true);
  });

  test('an untyped file is let through to the drop, which re-checks it', () => {
    expect(dragHasUsableFile(dt(''), IMAGE)).toBe(true);
  });

  test('a browser that exposes no items until the drop is let through', () => {
    expect(dragHasUsableFile({ items: [] }, IMAGE)).toBe(true);
    expect(dragHasUsableFile(undefined, IMAGE)).toBe(true);
  });

  test('non-file items (a string payload) are ignored', () => {
    expect(dragHasUsableFile({ items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'application/zip' }] }, IMAGE)).toBe(false);
  });
});
