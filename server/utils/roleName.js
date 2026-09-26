// Display names and slugs for admin roles (/admin/roles).
//
// Ported from icelandicstore #421 (server/utils/companyRoleName.js, where the
// same problem hit the customer-side company roles): a role is created from the
// name a person types ("Bókari"). The slug the database keys on (`roles.name`,
// the FK target of users.role and user_roles.role_name) is DERIVED from it on
// the server; the typed text is kept as the role's `label` (migration
// 116_role_label). Before 2026-09-26 the form asked for the slug itself and the
// server refused any capital, space or Icelandic letter.
//
// Slugs are never renamed afterwards: users.role, user_roles and the seeded
// role names all hang off them. Only the label is editable.
const { foldSlug, foldIcelandic } = require('./slug');

const NAME_RE = /^[a-z0-9_-]{2,32}$/;
const LABEL_MIN = 2;
const LABEL_MAX = 30;

// The engine's built-in role slugs. A custom role can never take one.
const RESERVED_SLUGS = new Set(['admin', 'moderator', 'user']);

// Names a role may not use, compared FOLDED (lower case, Icelandic letters and
// accents folded, spaces and punctuation dropped), for the typed label AND the
// slug. These are the words that read as "this person runs the system" — a
// custom role called "Kerfisstjóri" that grants two screens is exactly the
// confusion ice #421 rebuilt its page to remove. G4 of harvest 2 (2026-09-26).
const DENIED_FOLDED = new Set([
  'admin', 'administrator', 'administrators', 'administration',
  'moderator', 'moderators', 'staff', 'system', 'systemadmin', 'sysadmin',
  'root', 'superuser', 'superadmin', 'owner', 'owners', 'support',
  'kerfi', 'kerfisstjori', 'kerfisstjorn', 'stjornandi', 'stjornendur',
  'starfsmadur', 'starfsmenn', 'starfsfolk', 'eigandi', 'adstod',
  'user', 'users', 'notandi', 'notendur',
]);
// Anything that STARTS with "admin" once folded ("Admin-2", "Administratorar",
// "adminsala") is reserved too.
const DENIED_PREFIXES = ['admin'];

// Letters (any Latin-script letter, Icelandic included), digits, spaces and a
// little punctuation. Latin only on purpose: a Cyrillic "о" looks exactly like
// a Latin "o", and two roles reading "Bókari" that are different roles is how
// an admin grants the wrong one.
const LABEL_RE = /^[\p{Script=Latin}0-9 .,&'()/+-]+$/u;
const HAS_LETTER = /\p{Script=Latin}/u;

function folded(s) {
  return foldIcelandic(s).replace(/[^a-z0-9]+/g, '');
}

function deniedFolded(f) {
  return DENIED_FOLDED.has(f) || DENIED_PREFIXES.some(p => f.startsWith(p));
}

/**
 * Normalise a typed label: NFKC (so full-width and ligature look-alikes become
 * the plain letter), drop control and invisible format characters (bidi
 * overrides, zero-width joiners, BOM), collapse whitespace.
 * @returns {string}
 */
function cleanLabel(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
}

/**
 * Check a cleaned label. Returns null when it may be used, else
 * { status, key } for the error response.
 */
function labelProblem(label) {
  if (label.length < LABEL_MIN || label.length > LABEL_MAX || !LABEL_RE.test(label) || !HAS_LETTER.test(label)) {
    return { status: 400, key: 'errors.admin.roleLabelInvalid' };
  }
  if (deniedFolded(folded(label)) || RESERVED_SLUGS.has(foldSlug(label).replace(/-/g, '_'))) {
    return { status: 409, key: 'errors.admin.roleNameReserved' };
  }
  return null;
}

/** Is a ready slug (the legacy { name } create) a reserved or back-office name? */
function slugReserved(slug) {
  return RESERVED_SLUGS.has(slug) || deniedFolded(folded(slug));
}

/**
 * The key two names are "the same" under: case, accents and punctuation
 * folded away, so "Bókari" and "Bokari!" cannot both be roles.
 */
function labelKey(label) {
  return folded(label);
}

/**
 * The slugs to try for a label, in order: "bokari", "bokari-2", … Always valid
 * against NAME_RE, never reserved. A label that folds to fewer than two usable
 * characters starts from "role".
 */
function slugCandidates(label, count = 20) {
  let base = foldSlug(label).slice(0, 28).replace(/-+$/, '');
  if (base.length < 2) base = 'role';
  const out = [];
  for (let i = 1; out.length < count && i <= count + RESERVED_SLUGS.size; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (NAME_RE.test(slug) && !slugReserved(slug)) out.push(slug);
  }
  return out;
}

module.exports = {
  NAME_RE, RESERVED_SLUGS, LABEL_MAX,
  cleanLabel, labelProblem, slugCandidates, slugReserved, labelKey,
};
