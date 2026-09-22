// Magic-byte image sniffing (server/utils/imageType.js) — guards the importer
// against Shopify-CDN files whose extension lies about their bytes (a PNG
// named .heic is served as image/heic and, with nosniff, refuses to render).
const { sniffImageFormat, extensionMatchesFormat, correctedImageName } = require('../../server/utils/imageType');

// Minimal valid-enough headers (12+ bytes) per format.
function pngBuf()  { return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]); }
function jpegBuf() { return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)]); }
function gifBuf(v = '89a') { return Buffer.concat([Buffer.from(`GIF${v}`, 'latin1'), Buffer.alloc(8)]); }
function webpBuf() { return Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(4)]); }
function ftypBuf(brand) {
  // [size:4]["ftyp"][brand:4] — brand padded to 4 chars like real files.
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(brand.padEnd(4, ' '), 'latin1'),
    Buffer.alloc(8),
  ]);
}

describe('sniffImageFormat', () => {
  test('recognises PNG', () => expect(sniffImageFormat(pngBuf())).toBe('png'));
  test('recognises JPEG', () => expect(sniffImageFormat(jpegBuf())).toBe('jpeg'));
  test('recognises GIF87a and GIF89a', () => {
    expect(sniffImageFormat(gifBuf('87a'))).toBe('gif');
    expect(sniffImageFormat(gifBuf('89a'))).toBe('gif');
  });
  test('recognises WebP (RIFF….WEBP)', () => expect(sniffImageFormat(webpBuf())).toBe('webp'));
  test('recognises AVIF ftyp brands', () => {
    expect(sniffImageFormat(ftypBuf('avif'))).toBe('avif');
    expect(sniffImageFormat(ftypBuf('avis'))).toBe('avif');
  });
  test('recognises HEIC/HEIF ftyp brands', () => {
    expect(sniffImageFormat(ftypBuf('heic'))).toBe('heic');
    expect(sniffImageFormat(ftypBuf('heix'))).toBe('heic');
    expect(sniffImageFormat(ftypBuf('mif1'))).toBe('heic');
  });
  test('unknown ftyp brand → null (e.g. an mp4)', () => {
    expect(sniffImageFormat(ftypBuf('isom'))).toBeNull();
  });
  test('unrecognised bytes → null', () => {
    expect(sniffImageFormat(Buffer.from('this is not an image, at all', 'latin1'))).toBeNull();
  });
  test('too-short or non-buffer input → null', () => {
    expect(sniffImageFormat(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageFormat(null)).toBeNull();
    expect(sniffImageFormat('GIF89a-but-a-string')).toBeNull();
  });
});

describe('extensionMatchesFormat', () => {
  test('jpeg accepts .jpg, .jpeg and .jpe (case-insensitive)', () => {
    expect(extensionMatchesFormat('a.jpg', 'jpeg')).toBe(true);
    expect(extensionMatchesFormat('a.JPEG', 'jpeg')).toBe(true);
    expect(extensionMatchesFormat('a.jpe', 'jpeg')).toBe(true);
    expect(extensionMatchesFormat('a.png', 'jpeg')).toBe(false);
  });
  test('heic accepts .heic and .heif', () => {
    expect(extensionMatchesFormat('a.heic', 'heic')).toBe(true);
    expect(extensionMatchesFormat('a.heif', 'heic')).toBe(true);
  });
  test('no extension or unknown format → false', () => {
    expect(extensionMatchesFormat('noext', 'png')).toBe(false);
    expect(extensionMatchesFormat('a.png', 'bmp')).toBe(false);
  });
});

describe('correctedImageName', () => {
  test('the real-world trap: PNG bytes in a .heic name → renamed .png', () => {
    expect(correctedImageName('IMG_1435copy.heic', pngBuf()))
      .toEqual({ name: 'IMG_1435copy.png', format: 'png', mismatched: true });
  });
  test('matching extension is left untouched (never .jpeg→.jpg)', () => {
    expect(correctedImageName('photo.jpeg', jpegBuf()))
      .toEqual({ name: 'photo.jpeg', format: 'jpeg', mismatched: false });
    expect(correctedImageName('photo.png', pngBuf()).mismatched).toBe(false);
  });
  test('unrecognised bytes leave the name alone', () => {
    expect(correctedImageName('readme.txt', Buffer.from('hello world, not an image')))
      .toEqual({ name: 'readme.txt', format: null, mismatched: false });
  });
  test('mismatch swaps only the extension, keeping dots in the stem', () => {
    expect(correctedImageName('my.photo.v2.webp', jpegBuf()).name).toBe('my.photo.v2.jpg');
  });
  test('a name with no extension gets one appended', () => {
    expect(correctedImageName('bareimage', webpBuf()))
      .toEqual({ name: 'bareimage.webp', format: 'webp', mismatched: true });
  });
});
