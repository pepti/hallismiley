'use strict';

/**
 * What the two-factor code step does after a failed verification.
 *
 * This exists because of a real, reported bug: a mistyped code left the submit
 * button DISABLED, so the user got exactly one attempt and then a dead form —
 * while the server happily allowed five. The failure was silent (no error, just
 * a greyed-out button), the happy path still worked, and the guard that caused
 * it read plausibly:
 *
 *     if (!btn.disabled || errEl.textContent === '') { re-enable }
 *
 * On a wrong code both sides are false — the button was disabled a few lines
 * earlier, and the error text has just been set — so it never re-enabled.
 *
 * The rule now lives in a pure module (no DOM, no imports) so it can be tested
 * in plain Node, the same reason rateLimitDecide.js is split out of
 * rateLimitGuard.js.
 */

const { decideTotpFailure } = require('../../public/js/components/totpFailure');

describe('decideTotpFailure — a wrong code must leave the form usable', () => {
  test('THE REGRESSION: a plain wrong code re-enables the submit button', () => {
    const d = decideTotpFailure({ message: 'That code is not right.', attemptsRemaining: 4 });
    expect(d.reEnableSubmit).toBe(true);
    expect(d.restart).toBe(false);
  });

  test('the input is cleared so the next attempt can be typed straight away', () => {
    expect(decideTotpFailure({ attemptsRemaining: 3 }).clearInput).toBe(true);
  });

  test('every one of the server\'s five attempts leaves the form usable', () => {
    // MAX_CHALLENGE_ATTEMPTS is 5, so the server reports 4..0 remaining. The UI
    // must stay usable for all of them — the challenge is only gone once the
    // server says so via `restart`, not when the counter happens to reach zero.
    for (const n of [4, 3, 2, 1, 0]) {
      const d = decideTotpFailure({ attemptsRemaining: n });
      expect(d.reEnableSubmit).toBe(true);
      expect(d.attemptsRemaining).toBe(n);
    }
  });
});

describe('decideTotpFailure — a dead challenge stops the form', () => {
  test('restart leaves the button disabled', () => {
    // Expired, spent, or attempts exhausted: there is nothing left to submit to,
    // so collecting more guesses would only mislead.
    const d = decideTotpFailure({ message: 'That sign-in attempt timed out.', restart: true });
    expect(d.restart).toBe(true);
    expect(d.reEnableSubmit).toBe(false);
    expect(d.clearInput).toBe(false);
  });

  test('restart wins even if an attempt count is somehow also present', () => {
    const d = decideTotpFailure({ restart: true, attemptsRemaining: 2 });
    expect(d.reEnableSubmit).toBe(false);
  });
});

describe('decideTotpFailure — odd inputs fail open, not closed', () => {
  test.each([
    ['undefined', undefined],
    ['null',      null],
    ['bare object', {}],
    ['a plain Error', new Error('network down')],
  ])('%s still re-enables the button', (_label, err) => {
    // A network blip or an unexpected error shape must not strand the user with
    // a dead form. Failing open is right here: the server, not the client, is
    // what limits attempts.
    const d = decideTotpFailure(err);
    expect(d.reEnableSubmit).toBe(true);
    expect(d.restart).toBe(false);
  });

  test('a non-numeric attemptsRemaining is reported as absent, not rendered', () => {
    // Otherwise the UI would print "undefined attempts left".
    expect(decideTotpFailure({ attemptsRemaining: 'three' }).attemptsRemaining).toBeNull();
    expect(decideTotpFailure({}).attemptsRemaining).toBeNull();
  });
});
