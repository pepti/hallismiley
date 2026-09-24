// Derive a login username from a person's name (or an email's local part).
//
// The old slug simply dropped every character outside [a-z0-9._-], so
// "Þórður Ólafsson" became "rurlafsson" — unreadable to the person who has to
// type it, and for a name-only login (2026-09-21) the username IS the thing the
// admin reads out to them. Icelandic letters are transliterated the way
// Icelanders write them in ASCII (þ → th, ð → d, æ → ae, ö → o), every other
// accent is stripped by Unicode decomposition, and spaces are dropped as they
// always were: "Þórður Ólafsson" → "thordurolafsson".
const crypto = require('crypto');

const TRANSLIT = { þ: 'th', ð: 'd', æ: 'ae', ö: 'o', ø: 'o', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd' };
const MAX_LEN = 24;

function usernameSlug(base) {
  const lower = String(base == null ? '' : base).toLowerCase();
  const translit = lower.replace(/[þðæöøœßłđ]/g, ch => TRANSLIT[ch]);
  const slug = translit
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // á → a, é → e, ü → u …
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/([._-])[._-]+/g, '$1')                      // no "..", ".-" runs
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, MAX_LEN)
    .replace(/[._-]+$/g, '');                             // the cut can end on a dot
  return slug || 'user';
}

// A free username derived from `base`, suffixing 2, 3, … on collision.
// `client` lets a caller enlist in its transaction (uniqueUsername then sees
// rows that transaction inserted but has not committed). `emailDomain`, when
// given, also requires `<candidate><emailDomain>` to be free: a name-only login's
// placeholder address is derived from its username, and a row that already
// holds that address (a signup, a hand edit) would otherwise surface as a
// unique-violation on INSERT instead of simply being skipped here.
async function uniqueUsername(base, client, { emailDomain = null } = {}) {
  // Both a pooled client and the database module answer .query(sql, params).
  const db = client || require('../config/database');
  const q = (sql, params) => db.query(sql, params);
  const slug = usernameSlug(base);
  let candidate = slug;
  for (let i = 0; i < 50; i++) {
    const { rows } = emailDomain
      ? await q('SELECT 1 FROM users WHERE username = $1 OR email = $2', [candidate, `${candidate}${emailDomain}`])
      : await q('SELECT 1 FROM users WHERE username = $1', [candidate]);
    if (rows.length === 0) return candidate;
    candidate = `${slug}${i + 2}`;
  }
  return `${slug}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = { usernameSlug, uniqueUsername };
