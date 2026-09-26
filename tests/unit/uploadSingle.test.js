'use strict';
// middleware/upload.js — ensureDestination and uploadSingle's branch table,
// without a server. Ported from icelandicstore #150 (ensureDestination) and
// #314 (tests/unit/uploadSingleClientAbort.test.js) in harvest 2, 2026-09-26.
const multer = require('multer');
const logger = require('../../server/logger');
const { ensureDestination, uploadSingle } = require('../../server/middleware/upload');
const { t } = require('../../server/i18n');

describe('ensureDestination', () => {
  test('creates the directory and hands it to multer', () => {
    const mkdir = jest.fn();
    const cb = jest.fn();
    ensureDestination('/uploads/products/p1', { mkdir })({}, {}, cb);
    expect(mkdir).toHaveBeenCalledWith('/uploads/products/p1', { recursive: true });
    expect(cb).toHaveBeenCalledWith(null, '/uploads/products/p1');
  });

  test('an mkdir failure goes to multer\'s callback — never thrown out of busboy', () => {
    const boom = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    const mkdir = jest.fn(() => { throw boom; });
    const cb = jest.fn();
    expect(() => ensureDestination('/full/mount', { mkdir })({}, {}, cb)).not.toThrow();
    expect(cb).toHaveBeenCalledWith(boom);
  });

  test('a directory computed per upload', () => {
    const mkdir = jest.fn();
    const cb = jest.fn();
    ensureDestination((req) => `/books/${req.bucket}`, { mkdir })({ bucket: '2026-09' }, {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '/books/2026-09');
  });

  test('a throwing path builder is also an upload failure', () => {
    const cb = jest.fn();
    ensureDestination(() => { throw new Error('bad segment'); }, { mkdir: jest.fn() })({}, {}, cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// A builder whose multer "single" immediately reports `err`.
const failingWith = (err) => () => ({ single: () => (req, res, cb) => cb(err) });

function fakeRes() {
  const res = {
    statusCode: 200, headersSent: false, destroyed: false, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
    end: jest.fn(),
  };
  return res;
}

describe('uploadSingle', () => {
  const req = { locale: 'en', originalUrl: '/api/v1/x', requestId: 'rid-1' };

  test('passes through when the upload succeeded', () => {
    const next = jest.fn();
    uploadSingle(failingWith(undefined), 'errors.upload.failed')(req, fakeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('a fileFilter INVALID_TYPE is a translated 400 from the map', () => {
    const res = fakeRes();
    const err = Object.assign(new Error('nope'), { code: 'INVALID_TYPE' });
    uploadSingle(failingWith(err), { INVALID_TYPE: 'errors.upload.avatar.invalidType' })(req, res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: t('en', 'errors.upload.avatar.invalidType'), code: 400 });
  });

  test('LIMIT_FILE_SIZE honours tooLargeStatus', () => {
    const res = fakeRes();
    uploadSingle(failingWith(new multer.MulterError('LIMIT_FILE_SIZE')),
      { LIMIT_FILE_SIZE: 'errors.upload.productImport.tooLarge' }, { tooLargeStatus: 413 })(req, res, jest.fn());
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: t('en', 'errors.upload.productImport.tooLarge'), code: 413 });
  });

  test('an unmapped multer code falls back to default, then errors.upload.failed', () => {
    const a = fakeRes();
    uploadSingle(failingWith(new multer.MulterError('LIMIT_FILE_COUNT')), { default: 'errors.upload.background.invalidType' })(req, a, jest.fn());
    expect(a.body.error).toBe(t('en', 'errors.upload.background.invalidType'));
    const b = fakeRes();
    uploadSingle(failingWith(new multer.MulterError('LIMIT_UNEXPECTED_FILE')), {})(req, b, jest.fn());
    expect(b.body).toEqual({ error: t('en', 'errors.upload.failed'), code: 400 });
  });

  test('an Object.prototype-colliding code cannot return a function as the message', () => {
    const res = fakeRes();
    const err = new multer.MulterError('LIMIT_PART_COUNT');
    err.code = 'constructor';
    uploadSingle(failingWith(err), {})(req, res, jest.fn());
    expect(res.body.error).toBe(t('en', 'errors.upload.failed'));
  });

  test('an infrastructure fault (EACCES) goes to the central error middleware', () => {
    const next = jest.fn();
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const res = fakeRes();
    uploadSingle(failingWith(err), 'errors.upload.failed')(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });

  test.each(['Request aborted', 'Request closed'])('a client hang-up (%s) ends 499, logged at info, never a 5xx', (message) => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const error = jest.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const res = fakeRes();
      const next = jest.fn();
      uploadSingle(failingWith(new Error(message)), 'errors.upload.failed')(req, res, next);
      expect(res.statusCode).toBe(499);
      expect(res.end).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.objectContaining({ reason: message, requestId: 'rid-1' }), 'upload: client aborted');
      expect(error).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });

  test('a hang-up after the socket is gone does not write', () => {
    const res = fakeRes();
    res.destroyed = true;
    const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      uploadSingle(failingWith(new Error('Request aborted')), 'errors.upload.failed')(req, res, jest.fn());
      expect(res.statusCode).toBe(499);
      expect(res.end).not.toHaveBeenCalled();
    } finally { info.mockRestore(); }
  });
});
