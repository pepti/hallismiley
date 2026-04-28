/**
 * Unit tests for the pure rate-limit decision logic that powers the
 * client-side low-quota toast wrapper.
 *
 * The module is browser-shaped (ESM, lives in public/js) but contains no
 * DOM or fetch deps, so babel-jest transpiles it transparently and we can
 * exercise every branch without jsdom.
 */
import { decideWarn, RATE_LIMIT } from '../../public/js/api/rateLimitDecide.js';

describe('decideWarn — pure rate-limit warning decision', () => {
  // ── invalid headers → noop ──────────────────────────────────────────────
  test('NaN limit returns noop', () => {
    expect(decideWarn({ limit: NaN, remaining: 5, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  test('NaN remaining returns noop', () => {
    expect(decideWarn({ limit: 90, remaining: NaN, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  test('zero limit returns noop (would divide by zero)', () => {
    expect(decideWarn({ limit: 0, remaining: 0, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  test('negative limit returns noop', () => {
    expect(decideWarn({ limit: -10, remaining: 0, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  // Number(null) === 0 in JS, so a missing header parses to 0. Same path
  // as the explicit-zero case, but worth pinning so a future header parser
  // change doesn't silently regress.
  test('header parsed as 0 (Number(null)) returns noop', () => {
    expect(decideWarn({ limit: Number(null), remaining: Number(null), now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  // ── recover branch ──────────────────────────────────────────────────────
  test('ratio above recover threshold returns rearm', () => {
    // 50/90 ≈ 0.555 > 0.5
    expect(decideWarn({ limit: 90, remaining: 50, now: 1e9, lastWarnAt: 1234 }))
      .toEqual({ action: 'rearm' });
  });

  test('ratio exactly at recover threshold does NOT rearm (strict gt)', () => {
    // 50/100 === 0.5 — falls through to warn-band check, not low enough to warn
    expect(decideWarn({ limit: 100, remaining: 50, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  test('ratio just above recover threshold rearms', () => {
    // 51/100 === 0.51
    expect(decideWarn({ limit: 100, remaining: 51, now: 1e9, lastWarnAt: 1234 }))
      .toEqual({ action: 'rearm' });
  });

  // ── healthy band (between warn and recover) → noop ──────────────────────
  test('ratio between warn and recover thresholds returns noop', () => {
    // 30/90 ≈ 0.33 — between 0.15 and 0.5
    expect(decideWarn({ limit: 90, remaining: 30, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  test('ratio just above warn threshold returns noop', () => {
    // 16/100 === 0.16 > 0.15
    expect(decideWarn({ limit: 100, remaining: 16, now: 1e9, lastWarnAt: null }))
      .toEqual({ action: 'noop' });
  });

  // ── warn band ───────────────────────────────────────────────────────────
  test('ratio at-or-below warn threshold with cooldown elapsed returns warn', () => {
    // 5/90 ≈ 0.056
    const now = 1e9;
    expect(decideWarn({ limit: 90, remaining: 5, now, lastWarnAt: null }))
      .toEqual({ action: 'warn', at: now });
  });

  test('ratio exactly at warn threshold (0.15) returns warn (the spec says "≤ 15%")', () => {
    // 15/100 === 0.15 — strict gt above means equality falls through to warn
    const now = 1e9;
    expect(decideWarn({ limit: 100, remaining: 15, now, lastWarnAt: null }))
      .toEqual({ action: 'warn', at: now });
  });

  // ── cooldown ────────────────────────────────────────────────────────────
  test('within cooldown returns noop', () => {
    const now = 100_000;
    expect(decideWarn({ limit: 90, remaining: 5, now, lastWarnAt: now - 1000 }))
      .toEqual({ action: 'noop' });
  });

  test('cooldown boundary — just inside is noop', () => {
    const now = 100_000;
    // Date.now() - lastWarnAt = cooldownMs - 1 → still less than → noop
    expect(decideWarn({
      limit: 90, remaining: 5, now,
      lastWarnAt: now - RATE_LIMIT.cooldownMs + 1,
    })).toEqual({ action: 'noop' });
  });

  test('cooldown boundary — exactly at threshold warns (strict less-than gate)', () => {
    const now = 100_000;
    expect(decideWarn({
      limit: 90, remaining: 5, now,
      lastWarnAt: now - RATE_LIMIT.cooldownMs,
    })).toEqual({ action: 'warn', at: now });
  });

  test('cooldown boundary — just outside warns', () => {
    const now = 100_000;
    expect(decideWarn({
      limit: 90, remaining: 5, now,
      lastWarnAt: now - RATE_LIMIT.cooldownMs - 1,
    })).toEqual({ action: 'warn', at: now });
  });

  // ── full simulated session ──────────────────────────────────────────────
  test('full session: low burst → recovery → redip warns again', () => {
    let lastWarnAt = null;

    // Low #1 — first warn fires
    let r = decideWarn({ limit: 90, remaining: 5, now: 1000, lastWarnAt });
    expect(r).toEqual({ action: 'warn', at: 1000 });
    lastWarnAt = r.at;

    // Lows #2–#5 within 30s cooldown — silent
    for (const t of [1500, 2000, 5000, 28_000]) {
      expect(decideWarn({ limit: 90, remaining: 5, now: t, lastWarnAt }))
        .toEqual({ action: 'noop' });
    }

    // Quota recovers — caller resets lastWarnAt on rearm
    expect(decideWarn({ limit: 90, remaining: 50, now: 30_000, lastWarnAt }))
      .toEqual({ action: 'rearm' });
    lastWarnAt = null;

    // Redip — fresh warn fires (cooldown was reset by caller on rearm)
    r = decideWarn({ limit: 90, remaining: 4, now: 31_000, lastWarnAt });
    expect(r).toEqual({ action: 'warn', at: 31_000 });
  });

  // ── decrementing-reset stress test ──────────────────────────────────────
  // The whole reason the cooldown is time-based: draft-7 standard headers
  // emit Reset as decrementing seconds. A burst of low-quota responses with
  // distinct Reset values must still produce only one warn — proven here
  // by NOT consulting Reset at all in the decision.
  test('decrementing reset values do not affect the decision', () => {
    let lastWarnAt = null;
    let warnCount  = 0;
    // 10 low-quota responses inside one second
    for (let i = 0; i < 10; i++) {
      const r = decideWarn({ limit: 90, remaining: 5, now: 1000 + i * 10, lastWarnAt });
      if (r.action === 'warn') { warnCount++; lastWarnAt = r.at; }
    }
    expect(warnCount).toBe(1);
  });
});
