<a id="login-expiry-2026-09-26"></a>
## 2026-09-26 — Time-limited logins (R2b, D-020)

On the demo instance (`demo.rekstrarkerfi.is`, D-020) a seller gives a
prospect their own login after a guided demo, and that login must stop
working after N days. Built generically in the engine, so every product and
customer instance has it.

**What changed:**
- **Migration 114 `114_user_expires_at`** (engine array): `users.expires_at
  TIMESTAMPTZ NULL`, NULL = never expires. Expand-only (invariant 14): the
  previous release neither reads nor writes it. No index — it is only ever
  read off a row already loaded by primary key. Rolling back to the previous
  image re-opens expired logins for the length of the rollback: the old code
  ignores the column (the values stay and apply again on roll-forward).
- **`server/auth/accountExpiry.js`** is the one place the rule lives:
  `isExpired(user)` (fails closed on a non-date), `AccountExpiredError` (the
  typed refusal: 403 on a sign-in, 401 when a live session dies, `reason:
  'account_expired'`, message key `errors.auth.accountExpired`),
  `validateSession()` (Lucia's, plus the rule) and `parseExpiresAt()` (the
  admin input).
- **The central error handler** (`middleware/errorHandler.js`) now renders a
  TYPED client error — one carrying an i18n `messageKey` — translated for the
  request's locale, with its string `reason` next to `error`/`code`. Untyped
  errors keep the old shape exactly.
- **Every sign-in path refuses an expired login:** the password login, the
  2FA step (the login can run out between the two), the party magic link,
  the Google and Facebook callbacks (`?error=account_expired`, a toast via
  `main.js`; the Google by-email branch refuses BEFORE linking the Google id)
  and the MCP owner check (`mcp/owner.js`, so a connector token dies with its
  login). **Only after the credential checked out** (Halli's copy review): a
  wrong password on an expired account gets the ordinary invalid-credentials
  answer, byte-for-byte, so the refusal never tells a guesser that the
  account exists. The same holds for an unknown magic-link token.
- **A live session dies:** every session reader — `requireAuth`,
  `optionalAuth`, `softAuth`, the shop's private `requireAuth` and
  `GET /auth/session` — calls `accountExpiry.validateSession` instead of
  `lucia.validateSession`. The expiry costs no extra query on the hot path:
  Lucia's session join already selects `users.*`, and `expires_at` now rides
  in `getUserAttributes`. Once expired, all the user's sessions are deleted
  (one DELETE) and the request is answered as signed out: `requireAuth` says
  401 `account_expired` (the SPA's session guard shows the expiry message
  instead of "session expired"), `/auth/session` says `{ authenticated: false,
  reason: 'account_expired' }` (the SPA shows the message on page load).
  Extending the login later does not revive the deleted sessions.
- **Admin API:** `PATCH /api/v1/admin/users/:id/expiry { expires_at }` (admin +
  CSRF) sets or clears it — an ISO date-time, a bare `YYYY-MM-DD` (the end of
  that day, UTC = Iceland), or `null`. A value must lie in the future and
  within ten years; never on your own account; audited as `user.expiry_set` /
  `user.expiry_cleared`. `POST /api/v1/admin/customers` (the create path,
  emailed invite and name-only login alike) takes the same optional
  `expires_at`. The users list returns `expires_at`.
- **Admin UI:** the Users list has a "Gildir til" column with the badge
  "rennur út eftir N daga" (Icelandic plural rule through `plural()`) or
  "útrunninn", and a "Breyta" button (not on your own row) opening a modal:
  7 / 14 / 30 days, a date, or "Ótímabundinn". The Customers "add" form has
  the same picker (`components/ExpiryPicker.js`). Status tokens only
  (`--warning`/`--error` + their `-dim` washes), so all three themes re-hue it.
- **Found on the way:** the staff audit's closed vocabulary lacked
  `user.created_no_email`, which the Customers "add" form has recorded since
  harvest chunk A — every such write threw inside `recordSafe` and was lost.
  Added with the two expiry actions.

**Copy (DRÖG — Halli approves):**
- Refusal: IS "Þessi aðgangur er útrunninn. Hafðu samband við þann sem sýndi
  þér kerfið." / EN "This login has expired. Contact the person who showed
  you the system." (`errors.auth.accountExpired` on the server,
  `auth.errors.accountExpired` in the SPA — the same text.)
- Admin: "Gildir til" / "Valid until", "rennur út eftir {n} dag|daga" /
  "expires in {n} day|days", "útrunninn" / "expired", "Ótímabundinn" / "No
  expiry", "{n} dagur|dagar" / "{n} day|days", "Dagsetning" / "Date",
  "Gildistími innskráningar" / "Login validity", the modal hint, and the three
  admin errors (`errors.admin.cannotExpireSelf`, `expiresAtInvalid`,
  `expiresAtPast`).

**Tests:** `tests/integration/loginExpiry.test.js` (new, 28): the helpers;
the password login refused only with the right password (a wrong one is
indistinguishable from a live account's), translated per locale; not-yet-
expired and NULL sign in; the 2FA step; the magic link; a live session dying
(401 `account_expired`, every session row gone, not revived by an
extension), `/auth/session`, an admin route; the MCP owner check; the admin
API (set, bare date, clear + audit, past/garbage/missing/self/unknown/non-
admin refused) and the customers create path. `auth.google.test.js` +3 (an
expired login refused, by id and by email before linking; a live one signs
in), `auth.facebook.test.js` +2. `e2e/admin-user-expiry.spec.js` (new, 4):
set 7 days → the badge, clear → no badge, the expired badge, no button on
your own row, and the sign-in modal showing the expiry message only for the
right password.

**Review** (Öryggisvörður PASS, no Critical/High/Medium; invariant-reviewer
PASS). Folded in on the same branch:
- **Low-1** — an expiry is a delayed lockout, so two admins, or one hijacked
  admin session, could time-limit the remaining admins. `PATCH …/expiry` now
  refuses a value on any account with ADMIN POWERS (`utils/adminRole.js`
  `userHoldsAdminPowers`: the `admin` role, primary or in the set, or any
  held role whose views are `*` or include `users` or `roles`) with 409
  `reason: admin_account`, `errors.admin.cannotExpireAdmin` (DRÖG: IS "Ekki er
  hægt að setja gildistíma á aðgang stjórnanda." / EN "An administrator's
  login can't be time-limited."). Clearing is still allowed. Every other
  role stays time-limitable — the demo's prospect role (`kynning`, business
  views) is exactly what this is for. The customers create path cannot make
  such an account (always `role='user'`, no grants), so it holds there by
  construction.
- **Low-2** — clearing or extending the expiry of a login that has ALREADY
  expired revokes its MCP tokens first (`revokeMcpTokens(req, id,
  'expired')`, as disable does), so an old connector does not quietly come
  back to life.
- **Info-3** — `forgot-password` and `resend-verification` mint no token for
  an expired login (`expires_at IS NULL OR expires_at > NOW()`); the answer
  stays the same 200.
- **Info-5** — `parseExpiresAt` takes a date-time only when it is anchored
  and zoned: seconds and a fraction optional, `Z` or ±hh:mm required, nothing
  after it. A value with no zone is refused rather than read in the server's
  local time.
- Docs (invariant-reviewer): `docs/API.md` "Error format" now documents the
  optional `reason` (and the existing `retryable` on 409 BUSY); the rollback
  note above.

- **The promotion gap** (coordinator follow-up): refusing an expiry on an
  admin is only half — a time-limited login could still be PROMOTED into
  admin powers and carry its expiry along. Now gaining admin powers clears
  it, in the same transaction as the grant, audited `user.expiry_cleared`
  with `reason: 'promoted'` (and the role, for a role edit):
  `adminController.changeRole`, `adminRolesController.addMember` and a role's
  `view_access` edit (every member, primary or in the set), all through
  `accountExpiry.clearExpiryOnPromotion` (which evaluates
  `utils/adminRole.js` `adminPowersSql` AFTER the grant). `Role.update` and
  `UserRole.add` take an optional client for that. The `bootstrap` and
  `setup-admin` scripts clear it too. The users list returns `admin_powers`,
  and the "Breyta" expiry button is hidden on those rows. Note: `roles` and
  `*` are not grantable through the role editor at all (`GRANTABLE_VIEW_IDS`),
  so through the API the promoting edit is adding `users`; the sweep itself
  covers all three.

Tests: `loginExpiry.test.js` 28 → 54 → 62 (the promotion gap: changeRole to
admin clears, to a business role keeps; a `users` grant clears, a business
grant keeps; a `users` view edit clears every member with an expiry and no
outsider; `roles`/`*` refused by the editor, covered by the sweep; the list
flag) and `e2e/admin-user-expiry.spec.js` 4 → 5 (no button on another
admin's row). Earlier in the review (the admin-powers refusal both ways —
primary admin, admin through the set, `users`/`roles`/`*` roles refused;
`kynning`, moderator and a seller role allowed; clearing an admin's expiry
allowed — token revocation on revival and not otherwise, the two mail paths,
the anchored parser).
