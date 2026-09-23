'use strict';

// Circuit-breaker classification: query() feeds the DB circuit breaker, but it
// must only count a failure as "database unreachable" when it genuinely is.
// The load-bearing case is the codeless pool-acquisition timeout — that means
// the pool is saturated under load, NOT that the DB is down, so it must NOT
// trip the breaker (else a load spike would shed all traffic and worsen).
const { isConnectivityError } = require('../../server/config/database');

describe('isConnectivityError (circuit-breaker classification)', () => {
  test('trips on socket-level connection failures', () => {
    expect(isConnectivityError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isConnectivityError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isConnectivityError({ code: 'ENOTFOUND' })).toBe(true);
  });

  test('trips on PostgreSQL connection-class (08xxx) + admin-shutdown SQLSTATEs', () => {
    expect(isConnectivityError({ code: '08006' })).toBe(true);
    expect(isConnectivityError({ code: '57P01' })).toBe(true);
  });

  test('does NOT trip on ordinary SQL errors — the DB responded', () => {
    expect(isConnectivityError({ code: '23505' })).toBe(false); // unique violation
    expect(isConnectivityError({ code: '42601' })).toBe(false); // syntax error
    expect(isConnectivityError({ code: '57014' })).toBe(false); // statement_timeout / canceled
  });

  test('does NOT trip on a codeless pool-acquisition timeout (saturation ≠ DB down)', () => {
    expect(isConnectivityError(new Error('timeout exceeded when trying to connect'))).toBe(false);
    expect(isConnectivityError(new Error('Connection terminated unexpectedly'))).toBe(false);
  });

  test('handles null / undefined safely', () => {
    expect(isConnectivityError(null)).toBe(false);
    expect(isConnectivityError(undefined)).toBe(false);
  });
});
