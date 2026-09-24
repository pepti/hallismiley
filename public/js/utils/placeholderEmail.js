// Client twin of server/utils/placeholderEmail.js — the reserved stand-in
// addresses for logins with no mailbox:
//   <username>@pressan.invalid  — the Pressan tablet (#382)
//   <username>@noemail.invalid  — a name-only customer (2026-09-21)
// Neither is ever SHOWN as an address: the admin UI prints "— No email" instead,
// and actions that would mail one are swapped for "New password".
const DOMAINS = ['@pressan.invalid', '@noemail.invalid'];

export function isPlaceholderEmail(email) {
  const e = String(email == null ? '' : email).trim().toLowerCase();
  return DOMAINS.some(d => e.endsWith(d));
}

// The address, or '' when there is none worth showing.
export function realEmail(email) {
  if (email == null) return '';
  const e = String(email).trim();
  return isPlaceholderEmail(e) ? '' : e;
}
