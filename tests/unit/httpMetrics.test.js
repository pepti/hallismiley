'use strict';

// The httpMetrics middleware is the single place that sees every finished
// request, so it must feed the error-rate window: 5xx → trackRequest(true),
// anything else → trackRequest(false). (Previously the only trackRequest call
// lived on the /metrics route and always passed `false`, so the 5% error-rate
// alert could never fire.)
jest.mock('../../server/observability/alerts', () => ({
  trackRequest: jest.fn(),
}));

const { EventEmitter } = require('events');
const httpMetrics = require('../../server/observability/httpMetrics');
const { trackRequest } = require('../../server/observability/alerts');

function runRequest(statusCode) {
  const req = { method: 'GET', path: '/unit-test', headers: {}, route: null };
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.getHeader = () => undefined;
  const next = jest.fn();
  httpMetrics(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  res.emit('finish');
}

describe('httpMetrics → trackRequest wiring', () => {
  beforeEach(() => trackRequest.mockClear());

  test('reports an error for 5xx responses', () => {
    runRequest(500);
    expect(trackRequest).toHaveBeenCalledWith(true);
  });

  test('reports success for 2xx responses', () => {
    runRequest(200);
    expect(trackRequest).toHaveBeenCalledWith(false);
  });

  test('reports success for 4xx (a client error is not a server error)', () => {
    runRequest(404);
    expect(trackRequest).toHaveBeenCalledWith(false);
  });
});
