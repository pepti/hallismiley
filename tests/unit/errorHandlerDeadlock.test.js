'use strict';

// A Postgres deadlock victim (40P01) was rolled back whole: the honest answer
// is a retryable 409, never a 500 — it must not reach the event log as a
// server fault, and it must not leak the pg message (harvested from
// icelandicstore #380, harvest-ice-c-2026-09-24).
jest.mock('../../server/models/EventLog', () => ({ record: jest.fn() }));
const EventLog = require('../../server/models/EventLog');
const errorHandler = require('../../server/middleware/errorHandler');
const logger = require('../../server/logger');

const run = (err, locale = 'en') => {
  const res = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler(err, { method: 'PATCH', originalUrl: '/api/v1/admin/shop/orders/x/status', headers: {}, locale }, res, () => {});
  return res;
};

let warn, error;
beforeEach(() => {
  EventLog.record.mockClear();
  // The handler logs every error server-side through pino (invariant 6); the
  // spies keep the output quiet and pin the level.
  warn  = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  error = jest.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

test('40P01 → 409 { reason: BUSY, retryable: true }, localised, not recorded as a 5xx', () => {
  const err = Object.assign(new Error('deadlock detected'), { code: '40P01', detail: 'Process 1 waits for ShareLock…' });
  const res = run(err);
  expect(res.status).toHaveBeenCalledWith(409);
  const body = res.json.mock.calls[0][0];
  expect(body).toMatchObject({ code: 409, reason: 'BUSY', retryable: true });
  expect(body.error).not.toMatch(/deadlock|ShareLock/i);
  expect(EventLog.record).not.toHaveBeenCalled();
  // Logged as a warn with the status it was answered with, never as an error.
  expect(error).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }), expect.stringMatching(/40P01/));
  expect(run(err, 'is').json.mock.calls[0][0].error).not.toBe(body.error);
});

test('an error that already chose its status keeps it, and any other pg failure is still a 500', () => {
  expect(run(Object.assign(new Error('x'), { code: '40P01', status: 503 })).status).toHaveBeenCalledWith(503);
  EventLog.record.mockClear();
  const res = run(Object.assign(new Error('relation "nope" does not exist'), { code: '42P01' }));
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json.mock.calls[0][0]).toEqual({ error: 'Internal Server Error', code: 500 });
  expect(EventLog.record).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }), expect.any(String));
});
