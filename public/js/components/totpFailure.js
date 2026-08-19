// Pure decision logic for what the two-factor code step should do after a failed
// verification. Kept in a separate file from LoginModal.js — no DOM, no imports —
// so it can be unit-tested in plain Node, the same reason rateLimitDecide.js is
// split out of rateLimitGuard.js.
//
// This exists because the inline version got it wrong in a way that mattered: a
// mistyped code left the submit button disabled, so the user got ONE attempt and
// then a dead form, even though the server allows five. The failure was silent —
// no error, just a greyed-out button — and it is precisely the sort of thing that
// is easy to reintroduce and hard to notice, since the happy path still works.

/**
 * @param {{restart?: boolean, attemptsRemaining?: number}} err
 *   The error thrown by loginTotp(). `restart` means the challenge itself is gone
 *   (expired, spent, or out of attempts) and there is nothing left to submit to.
 * @returns {{restart: boolean, reEnableSubmit: boolean, clearInput: boolean, attemptsRemaining: number|null}}
 */
export function decideTotpFailure(err) {
  const restart = !!(err && err.restart);

  // The ONLY reason to leave the button dead is that the challenge is gone and
  // we are bouncing back to the password step. Every other failure — above all a
  // simple typo — must leave the form usable.
  return {
    restart,
    reEnableSubmit: !restart,
    clearInput:     !restart,
    attemptsRemaining:
      err && typeof err.attemptsRemaining === 'number' ? err.attemptsRemaining : null,
  };
}
