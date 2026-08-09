'use strict';

const logger = require('./logger');
const { alert } = require('./alerts');

/**
 * Simple circuit breaker for the database connection.
 *
 * States:
 *   closed   — normal operation
 *   open     — DB is failing; reject immediately with 503
 *   half-open — cooldown elapsed; allow one probe request through
 */
class CircuitBreaker {
  constructor({ failureThreshold = 3, retryAfterMs = 30000 } = {}) {
    this._failureThreshold = failureThreshold;
    this._retryAfterMs     = retryAfterMs;
    this._state            = 'closed';
    this._failures         = 0;
    this._openedAt         = null;
  }

  get state() { return this._state; }

  /** Returns true when the circuit is open and requests should be rejected. */
  isOpen() {
    if (this._state === 'open') {
      if (Date.now() - this._openedAt >= this._retryAfterMs) {
        logger.info({ event: 'circuit_breaker_half_open' }, 'Circuit breaker: half-open, probing DB');
        this._state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  /** Call when a DB operation succeeds. */
  recordSuccess() {
    if (this._state !== 'closed') {
      logger.info({ event: 'circuit_breaker_closed' }, 'Circuit breaker: closed — DB recovered');
      alert('info', 'Database circuit breaker closed (recovered)', { previousState: this._state });
    }
    this._state    = 'closed';
    this._failures = 0;
    this._openedAt = null;
  }

  /** Call when a DB operation fails. */
  recordFailure(err) {
    this._failures++;
    if (this._failures >= this._failureThreshold && this._state !== 'open') {
      this._state    = 'open';
      this._openedAt = Date.now();
      logger.error(
        { event: 'circuit_breaker_open', failures: this._failures, err },
        'Circuit breaker: open — DB is unavailable',
      );
      alert('critical', 'Database circuit breaker opened', {
        consecutiveFailures: this._failures,
        retryAfterSeconds: this._retryAfterMs / 1000,
      });
    }
  }
}

// Singleton shared across the application
const dbCircuitBreaker = new CircuitBreaker({ failureThreshold: 3, retryAfterMs: 30000 });

/**
 * Express middleware that returns 503 when the DB circuit is open.
 * Apply to all routes that touch the database.
 */
function dbCircuitBreakerMiddleware(req, res, next) {
  if (dbCircuitBreaker.isOpen()) {
    return res.status(503).json({ error: 'Service temporarily unavailable', code: 503 });
  }
  next();
}

module.exports = { dbCircuitBreaker, dbCircuitBreakerMiddleware };
