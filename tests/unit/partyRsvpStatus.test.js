'use strict';

/**
 * Unit tests for `_deriveRsvpStatus` at server/controllers/partyController.js.
 *
 * The function buckets a free-text `attend_when` answer into one of
 * 'waiting' | 'declined' | 'maybe' | 'going' for the admin guest-list
 * UI. It runs on every getAllRsvps response (one call per row) and on
 * the email-going recipient filter, so a regression here either silently
 * miscounts the headcount on the admin dashboard or — worse — emails
 * "you're coming!" to someone who declined.
 *
 * Imported as a non-public export (underscore prefix) — exposed solely
 * for testing, no callers outside this file.
 */

const { _deriveRsvpStatus } = require('../../server/controllers/partyController');

describe('_deriveRsvpStatus', () => {
  describe('missing or malformed input', () => {
    test('null answers returns waiting', () => {
      expect(_deriveRsvpStatus(null)).toBe('waiting');
    });

    test('undefined answers returns waiting', () => {
      expect(_deriveRsvpStatus(undefined)).toBe('waiting');
    });

    test('empty object (no attend_when) defaults to going', () => {
      // The function treats "answered the form but didn't fill attend_when"
      // as going — the form's other fields imply they engaged with the RSVP.
      expect(_deriveRsvpStatus({})).toBe('going');
    });

    test('non-string attend_when defaults to going (empty-string fallback)', () => {
      expect(_deriveRsvpStatus({ attend_when: 42 })).toBe('going');
      expect(_deriveRsvpStatus({ attend_when: null })).toBe('going');
      expect(_deriveRsvpStatus({ attend_when: ['array', 'of', 'strings'] })).toBe('going');
    });
  });

  describe('decline phrases (highest precedence)', () => {
    test('classic English: "can\'t"', () => {
      expect(_deriveRsvpStatus({ attend_when: "I can't make it" })).toBe('declined');
      expect(_deriveRsvpStatus({ attend_when: "Sorry — can't come" })).toBe('declined');
    });

    test('apostrophe-less "cant" also classifies as declined', () => {
      expect(_deriveRsvpStatus({ attend_when: 'cant make it sadly' })).toBe('declined');
    });

    test('"sorry" alone is enough to decline', () => {
      // Note: this is intentional in the regex — "sorry I'm late but I'll be
      // there!" misclassifies as declined. Pinning current behavior; if this
      // is wrong, the regex needs hardening, not this test.
      expect(_deriveRsvpStatus({ attend_when: 'sorry I cannot' })).toBe('declined');
    });

    test('Icelandic decline phrases', () => {
      expect(_deriveRsvpStatus({ attend_when: 'kemst ekki' })).toBe('declined');
      expect(_deriveRsvpStatus({ attend_when: 'því miður, afþakka' })).toBe('declined');
      expect(_deriveRsvpStatus({ attend_when: 'kem ekki' })).toBe('declined');
    });

    test('case-insensitive', () => {
      expect(_deriveRsvpStatus({ attend_when: "CAN'T MAKE IT" })).toBe('declined');
      expect(_deriveRsvpStatus({ attend_when: 'KEMST EKKI' })).toBe('declined');
    });

    test('decline beats maybe when both phrases co-occur', () => {
      // Order matters in the function — decline is checked first.
      expect(_deriveRsvpStatus({ attend_when: "sorry, maybe next time" })).toBe('declined');
      expect(_deriveRsvpStatus({ attend_when: "kemst ekki, kannski seinna" })).toBe('declined');
    });
  });

  describe('maybe phrases', () => {
    test('word-boundary "maybe" in English', () => {
      expect(_deriveRsvpStatus({ attend_when: 'maybe' })).toBe('maybe');
      expect(_deriveRsvpStatus({ attend_when: 'I think maybe Friday' })).toBe('maybe');
      expect(_deriveRsvpStatus({ attend_when: 'leaning toward yes, but maybe' })).toBe('maybe');
    });

    test('Icelandic "kannski" and "óvíst"', () => {
      expect(_deriveRsvpStatus({ attend_when: 'kannski' })).toBe('maybe');
      expect(_deriveRsvpStatus({ attend_when: 'er enn óvíst' })).toBe('maybe');
    });

    test('"maybe" embedded in another word does not match (word boundary)', () => {
      // The pattern is /\bmaybe\b/ in the function, so "maybellinemaybe" would
      // still match (word boundary at end). But "supermaybe" without trailing
      // boundary would not. Test the boundary semantics explicitly.
      expect(_deriveRsvpStatus({ attend_when: 'maybeornot' })).toBe('going');
    });

    test('case-insensitive', () => {
      expect(_deriveRsvpStatus({ attend_when: 'MAYBE' })).toBe('maybe');
      expect(_deriveRsvpStatus({ attend_when: 'Kannski' })).toBe('maybe');
    });
  });

  describe('default: going', () => {
    test('clear "going" answers', () => {
      expect(_deriveRsvpStatus({ attend_when: 'yes' })).toBe('going');
      expect(_deriveRsvpStatus({ attend_when: 'absolutely' })).toBe('going');
      expect(_deriveRsvpStatus({ attend_when: 'see you Friday' })).toBe('going');
      expect(_deriveRsvpStatus({ attend_when: 'will be there' })).toBe('going');
      expect(_deriveRsvpStatus({ attend_when: 'ég kem' })).toBe('going');
    });

    test('empty string defaults to going', () => {
      expect(_deriveRsvpStatus({ attend_when: '' })).toBe('going');
    });
  });
});
