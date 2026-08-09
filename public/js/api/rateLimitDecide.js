// Pure decision logic for the rate-limit warning toast. Kept in a separate
// file from rateLimitGuard.js — no browser imports — so it can be unit-tested
// in plain Node without jsdom or hand-rolled global mocks.

export const RATE_LIMIT = {
  // Ratio above which we re-arm the cooldown (a fresh window or another tab
  // refilling the bucket should let the next dip warn again).
  recoverRatio: 0.5,
  // Ratio at-or-below which we may show the warning toast.
  warnRatio:    0.15,
  // Cooldown between toasts so a burst of low-quota responses produces one
  // warning, not many. Time-based — not RateLimit-Reset-based — because
  // draft-7 standard headers emit Reset as decrementing seconds.
  cooldownMs:   30 * 1000,
};

/**
 * Decide whether to fire a low-quota toast given current rate-limit state.
 *
 * The function is pure: it returns an action describing what the caller
 * should do, without mutating anything itself. The caller owns the
 * `lastWarnAt` state and updates it in response to `{ action: 'warn', at }`
 * or resets it to 0 in response to `{ action: 'rearm' }`.
 *
 * @param {object} args
 * @param {number} args.limit       RateLimit-Limit header (per-window cap)
 * @param {number} args.remaining   RateLimit-Remaining header
 * @param {number} args.now         Current timestamp (ms since epoch)
 * @param {number|null} args.lastWarnAt  Timestamp of last warning, or null = never
 * @returns {{action: 'noop'} | {action: 'rearm'} | {action: 'warn', at: number}}
 */
export function decideWarn({ limit, remaining, now, lastWarnAt }) {
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) {
    return { action: 'noop' };
  }
  const ratio = remaining / limit;
  if (ratio > RATE_LIMIT.recoverRatio) return { action: 'rearm' };
  if (ratio > RATE_LIMIT.warnRatio)    return { action: 'noop' };
  // null = never warned, so the cooldown gate doesn't apply.
  if (lastWarnAt !== null && now - lastWarnAt < RATE_LIMIT.cooldownMs) {
    return { action: 'noop' };
  }
  return { action: 'warn', at: now };
}
