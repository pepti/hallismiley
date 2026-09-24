// Reserved stand-in addresses for logins that have no mailbox.
//
// users.email is TEXT NOT NULL UNIQUE and is read unconditionally by login, the
// invite senders, Lucia's session payload and every admin list, so a login with
// no email still needs SOMETHING in the column (dropping the NOT NULL was
// rejected in #382: it is a contract-phase change dressed as an expand-only one,
// and it breaks the weekly clone's reapply.sql). RFC 2606 permanently reserves
// the .invalid TLD, so no MX for these can ever exist and nothing can deliver to
// them even by accident.
//
// Two domains, deliberately distinct, so the rules of one never leak onto the
// other:
//   @pressan.invalid  — a DEVICE (the press-room tablet, role 'workshop', #382).
//   @noemail.invalid  — a PERSON the admin created with only a name: a wholesale
//                       customer who signs in with a generated username and a
//                       one-time password the admin handed over (2026-09-21).
//
// Every place that would MAIL, SHOW or EXPORT an address asks this module first:
// a placeholder is "no email", never an address.
const DEVICE_DOMAIN   = '@pressan.invalid';
const NO_EMAIL_DOMAIN = '@noemail.invalid';
const PLACEHOLDER_DOMAINS = [DEVICE_DOMAIN, NO_EMAIL_DOMAIN];

const norm = (email) => String(email == null ? '' : email).trim().toLowerCase();

function isPlaceholderEmail(email) {
  const e = norm(email);
  return PLACEHOLDER_DOMAINS.some(d => e.endsWith(d));
}

// The address, or null when there is none worth using (blank or placeholder).
function realEmail(email) {
  if (email == null) return null;
  const e = String(email).trim();
  if (!e || isPlaceholderEmail(e)) return null;
  return e;
}

const deviceEmail  = (username) => `${username}${DEVICE_DOMAIN}`;
const noEmailEmail = (username) => `${username}${NO_EMAIL_DOMAIN}`;

// A SQL predicate that is TRUE when `col` holds a real address. `col` is always
// a literal column name from our own code, never user input. The domains contain
// no LIKE wildcards (`_`/`%`), so they match literally; emails are stored
// lowercased, and lower(btrim()) makes the predicate hold even for a hand-edited
// row — the same normalisation isPlaceholderEmail applies in JS.
function realEmailSql(col) {
  return PLACEHOLDER_DOMAINS.map(d => `lower(btrim(${col})) NOT LIKE '%${d}'`).join(' AND ');
}

// `col` as a SQL expression, NULL when it holds a placeholder — for lists and
// search blobs that must treat such a row as having no address at all.
function realEmailExpr(col) {
  return `(CASE WHEN ${realEmailSql(col)} THEN ${col} END)`;
}

module.exports = {
  realEmailExpr,
  DEVICE_DOMAIN,
  NO_EMAIL_DOMAIN,
  PLACEHOLDER_DOMAINS,
  isPlaceholderEmail,
  realEmail,
  deviceEmail,
  noEmailEmail,
  realEmailSql,
};
