// A password for a login that has NO MAILBOX — the shared workshop tablet
// (role 'workshop', migration 119). Every other account gets a set-password
// link by email; a tablet has nowhere to send one, so the server mints the
// password, hashes it, and shows it to the admin exactly once.
//
// Two properties matter, and they pull against each other:
//
//   * It must be unguessable. This is a real credential on a real account and
//     nobody will think to rotate it, so it comes from crypto.randomBytes,
//     never Math.random. 20 symbols out of a 30-symbol alphabet is ~98 bits —
//     far past anything a password policy would ask for.
//   * It must survive being written on a note and typed on a tablet by someone
//     in the warehouse. So: no lookalikes (0/O, 1/I/L, and U, which reads as V
//     in handwriting), upper case only, and dashed into groups of five so the
//     eye can keep its place.
//
// The result looks like  H7KM2-PQ4RT-9WXZ3-BCDF6 .
const crypto = require('crypto');

// Crockford's base32 alphabet minus U — 30 symbols, no lookalike pairs.
const ALPHABET  = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS    = 4;
const GROUP_LEN = 5;

// 256 is not a multiple of 30, so `byte % 30` alone would make the first six
// symbols ~17% likelier than the rest. Reject the tail instead of skewing it.
const LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // 240

/** @returns {string} a fresh, dashed, ~98-bit password. Never logged, never stored. */
function generatePassword() {
  const want = GROUPS * GROUP_LEN;
  const out  = [];
  while (out.length < want) {
    for (const byte of crypto.randomBytes(want)) {
      if (byte >= LIMIT) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === want) break;
    }
  }
  const groups = [];
  for (let i = 0; i < want; i += GROUP_LEN) groups.push(out.slice(i, i + GROUP_LEN).join(''));
  return groups.join('-');
}

module.exports = { generatePassword, ALPHABET, GROUPS, GROUP_LEN };
