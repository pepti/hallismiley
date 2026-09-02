// server/middleware/verifyImageBytes.js — the bytes of an upload must match
// the MIME type multer accepted, or the file is removed and the request 400s.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { verifyUploadedImages, verifyImageBytes } = require('../../server/middleware/verifyImageBytes');

const PNG  = Buffer.from('89504e470d0a1a0a', 'hex');                 // 8-byte signature only
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)]);
const TEXT = Buffer.from('this is not an image, at all', 'latin1');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function stored(name, bytes, mimetype) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return { path: p, mimetype, fieldname: 'file', originalname: name };
}

describe('verifyUploadedImages', () => {
  test('a PNG declared image/png passes (even with only the 8-byte signature)', async () => {
    const req = { file: stored('a.png', PNG, 'image/png') };
    await expect(verifyUploadedImages(req)).resolves.toBeNull();
    expect(fs.existsSync(req.file.path)).toBe(true);
  });

  test('PNG bytes declared image/jpeg → message, file removed', async () => {
    const req = { file: stored('a.jpg', PNG, 'image/jpeg') };
    await expect(verifyUploadedImages(req)).resolves.toMatch(/not a valid JPEG image/);
    expect(fs.existsSync(req.file.path)).toBe(false);
  });

  test('text bytes declared image/png → rejected', async () => {
    const req = { file: stored('a.png', TEXT, 'image/png') };
    await expect(verifyUploadedImages(req)).resolves.toMatch(/not a valid PNG image/);
  });

  test('non-image declared types are not inspected (video, pdf)', async () => {
    const req = { file: stored('clip.mp4', TEXT, 'video/mp4') };
    await expect(verifyUploadedImages(req)).resolves.toBeNull();
    const req2 = { file: stored('doc.pdf', TEXT, 'application/pdf') };
    await expect(verifyUploadedImages(req2)).resolves.toBeNull();
  });

  test('.fields() shape: a bad thumb removes EVERY file of the request', async () => {
    const req = {
      files: {
        file:  [stored('clip.mp4', TEXT, 'video/mp4')],
        thumb: [stored('thumb.png', JPEG, 'image/png')],
      },
    };
    await expect(verifyUploadedImages(req)).resolves.toMatch(/PNG/);
    expect(fs.existsSync(req.files.file[0].path)).toBe(false);
    expect(fs.existsSync(req.files.thumb[0].path)).toBe(false);
  });

  test('memory-storage files (no path) are skipped, request without files passes', async () => {
    await expect(verifyUploadedImages({ file: { mimetype: 'image/png', buffer: TEXT } })).resolves.toBeNull();
    await expect(verifyUploadedImages({})).resolves.toBeNull();
  });
});

describe('verifyImageBytes middleware', () => {
  function run(req) {
    return new Promise((resolve) => {
      const res = {
        status(code) { this.code = code; return this; },
        json(body) { resolve({ code: this.code, body }); },
      };
      verifyImageBytes(req, res, (err) => resolve({ next: true, err }));
    });
  }

  test('calls next() on a match', async () => {
    const out = await run({ file: stored('ok.jpg', JPEG, 'image/jpeg') });
    expect(out).toEqual({ next: true, err: undefined });
  });

  test('answers 400 in the multer-wrapper error shape on a mismatch', async () => {
    const out = await run({ file: stored('bad.jpg', PNG, 'image/jpeg') });
    expect(out.code).toBe(400);
    expect(out.body).toEqual({ error: expect.stringMatching(/JPEG/), code: 400 });
  });
});
