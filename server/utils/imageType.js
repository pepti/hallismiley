// Magic-byte sniffing for image files (ice #215, verbatim).
//
// Why: the Shopify CDN transcodes image formats but keeps the ORIGINAL
// filename, so a download named IMG_1435copy.heic can actually contain PNG
// bytes. express.static picks Content-Type by extension and helmet sets
// X-Content-Type-Options: nosniff, so a mis-named file is refused by the
// browser (bit for real on PROD 2026-08-24: geysir-ceramic-trivet). Sniffing
// the real format lets the importer store the file under an extension that
// matches its bytes.

// Sniffed format → canonical extension. jpeg deliberately maps to .jpg.
const CANONICAL_EXT = {
  png: '.png',
  jpeg: '.jpg',
  gif: '.gif',
  webp: '.webp',
  avif: '.avif',
  heic: '.heic',
};

// Extensions accepted as already-correct per format (never force .jpeg→.jpg).
const ACCEPTED_EXTS = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg', '.jpe'],
  gif: ['.gif'],
  webp: ['.webp'],
  avif: ['.avif'],
  heic: ['.heic', '.heif'],
};

// ISO BMFF (ftyp) major brands → format. AVIF and HEIC/HEIF share the
// container; the brand tells them apart.
const FTYP_BRANDS = {
  avif: 'avif',
  avis: 'avif',
  heic: 'heic',
  heix: 'heic',
  hevc: 'heic',
  hevx: 'heic',
  heim: 'heic',
  heis: 'heic',
  hevm: 'heic',
  hevs: 'heic',
  mif1: 'heic',
  msf1: 'heic',
};

function ascii(buf, start, end) {
  return buf.toString('latin1', start, end);
}

/**
 * Identify an image buffer by its magic bytes.
 * @param {Buffer} buf — at least the first 12 bytes of the file.
 * @returns {'png'|'jpeg'|'gif'|'webp'|'avif'|'heic'|null} null = not a
 *   recognised image format (don't touch the file).
 */
function sniffImageFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  const six = ascii(buf, 0, 6);
  if (six === 'GIF87a' || six === 'GIF89a') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12).trim().toLowerCase();
    return FTYP_BRANDS[brand] || null;
  }
  return null;
}

/**
 * True when the filename's extension is acceptable for the sniffed format
 * (e.g. both .jpg and .jpeg pass for 'jpeg').
 */
function extensionMatchesFormat(filename, format) {
  const exts = ACCEPTED_EXTS[format];
  if (!exts) return false;
  const m = String(filename || '').match(/\.[^.]+$/);
  const ext = m ? m[0].toLowerCase() : '';
  return exts.includes(ext);
}

/**
 * Return the filename an image buffer SHOULD be stored under: unchanged when
 * the bytes aren't a recognised format or the extension already matches,
 * otherwise the same stem with the sniffed format's canonical extension
 * (appended when the name has none).
 * @returns {{ name: string, format: string|null, mismatched: boolean }}
 */
function correctedImageName(filename, buf) {
  const name = String(filename || '');
  const format = sniffImageFormat(buf);
  if (!format || extensionMatchesFormat(name, format)) {
    return { name, format, mismatched: false };
  }
  const stem = name.replace(/\.[^.]+$/, '');
  return { name: stem + CANONICAL_EXT[format], format, mismatched: true };
}

module.exports = { sniffImageFormat, extensionMatchesFormat, correctedImageName, CANONICAL_EXT };
