'use strict';

// The central error middleware answers aiGate's AiBusyError (harvest2, ported
// from icelandicstore #218) as a 429 in the standard envelope: Retry-After in
// seconds, a localised message, reason AI_BUSY — and never as a 5xx.
jest.mock('../../server/models/EventLog', () => ({ record: jest.fn() }));
const EventLog = require('../../server/models/EventLog');
const errorHandler = require('../../server/middleware/errorHandler');
const logger = require('../../server/logger');
const { AiBusyError, RETRY_AFTER_SECONDS } = require('../../server/services/aiGate');

const run = (err, locale = 'en') => {
  const headers = {};
  const res = {
    locals: {},
    headers,
    setHeader: jest.fn((k, v) => { headers[k] = v; }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  errorHandler(err, { method: 'POST', originalUrl: '/api/v1/x', headers: {}, locale }, res, () => {});
  return res;
};

let warn, error;
beforeEach(() => {
  EventLog.record.mockClear();
  warn  = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  error = jest.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

test('AiBusyError → 429, Retry-After, localised message, reason AI_BUSY', () => {
  const res = run(new AiBusyError());
  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.headers['Retry-After']).toBe(String(RETRY_AFTER_SECONDS));
  const body = res.json.mock.calls[0][0];
  expect(body).toMatchObject({ code: 429, reason: 'AI_BUSY', retryable: true });
  expect(body.error).toBe('The AI is busy with other requests — try again in a moment');
  expect(run(new AiBusyError(), 'is').json.mock.calls[0][0].error).not.toBe(body.error);
  expect(EventLog.record).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

test('a 5xx carrying a messageKey still gets the generic message', () => {
  const err = Object.assign(new Error('secret internals'), { status: 500, messageKey: 'errors.ai.busy', retryAfterSeconds: 5 });
  const res = run(err);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json.mock.calls[0][0]).toEqual({ error: 'Internal Server Error', code: 500 });
  expect(res.setHeader).not.toHaveBeenCalled();
});
