# Two-factor sign-in — mandatory enrolment and the secret at rest

Every account the login path challenges must have TOTP two-factor sign-in
enabled: an account holding `admin` (primary role or anywhere in its role
set), a holder of the `accounts` view (a seller who owns customer accounts,
ENHANCEMENTS #17) and a published seller on the public instance (D-020). Since
2026-09-23 that is a rule the server enforces, not an option on the profile
page. The rule was written in rekstrarkerfid on 2026-09-18 (Öryggisvörður's
review while fact-checking its /um-kerfid page, which promises "TOTP fyrir
stjórnendur") and harvested into the engine under D-021; the engine's gate is
wider than rk's, so the policy here withholds the role for an admin and the
view for an accounts holder.

## The rule

A protected account **without** TOTP is not that yet:

- It can sign in with its password and gets an ordinary session — it needs one
  to reach `POST /auth/totp/setup` and `/auth/totp/confirm`.
- Every place a session becomes `req.user` goes through `attachRoles`
  (`server/auth/middleware.js`), which runs `server/auth/mfaPolicy.js`:
  - an admin has **`admin` withheld** from `req.user.role` and
    `req.user.roles`. `requireRole`, `requireView` and every inline role check
    then refuse on their own; the route answers `403` with a message that says
    why (`forbiddenMessage` in `auth/roles.js`, same `{error, code}` envelope).
    Other roles the account holds (moderator, a custom role) keep working —
    they never needed 2FA.
  - an `accounts` holder keeps its roles but has the **`accounts` view (and a
    wildcard grant) withheld** in `requireView`, the one place views are
    resolved for a guard. The rest of the role's views still work.
  - a published seller's routes demand `totp_enabled` themselves
    (`routes/sellerRoutes.js`, rule 4); the session payload still says the
    seller owes enrolment.
  The shop router's private `requireAuth` (guest checkout) applies the same
  policy on the primary role.
- The session payloads (`/auth/login`, `/auth/session`, `/auth/login/totp`)
  report the same downgraded roles and views plus
  `mfa_enrolment_required: true`. The SPA uses that to send the person to the
  two-step panel on their profile; that part is convenience, the gate is the
  server's.
- The moment enrolment is confirmed the same session is what the account is —
  no re-login. From then on the password alone yields a challenge, never a
  session (`mfaService.js`).
- Turning two-step off (profile page, needs the password) puts the account
  back behind the gate until it enrols again. That is the way to move to a new
  phone: turn off, set up again.

Admin accounts are also refused on the two sign-in paths that have no second
factor: OAuth (Google/Facebook) and party magic links.

The rule lives in `mfaPolicy.js` and nowhere else; guards never re-implement
it. `mfaService.protectedRole` decides WHO is protected (mirrored on the client
by `auth.isMfaProtected()`, pinned by `tests/unit/mfaProtectedClient.test.js`);
the policy decides what an unenrolled protected account may do.

## What an admin sees the first time

1. Signs in with username and password.
2. Lands on **Prófíll → Tveggja þátta staðfesting** with a notice that the
   account needs it. No admin entries in the menu; an `/admin/...` URL comes
   back to this page.
3. *Setja upp* → scan the QR code (or type the key) into an authenticator app →
   enter the 6-digit code.
4. **Ten recovery codes are shown once.** Save them — paper or a password
   manager. Each works once, in place of a code from the app.
5. *Ég er búin(n) að vista þá* → the admin area opens.

The authenticator entry is named after the instance: `identity.brand.name`
in `config/client.json` (the identity seam, `server/config/identity.js`;
`Orange Smiley` here, env `CLIENT_CONFIG_IDENTITY_BRAND_NAME`). An entry
enrolled earlier keeps the name the app stored at enrolment until the person
turns two-step off and sets it up again.

## Break-glass: an admin has lost the phone AND the recovery codes

Nothing in the running app can help — that is the point. The way back in is
database access, a stronger credential than anything the web app accepts:

```bash
# on a machine that can reach the instance's database, DATABASE_URL set
node server/scripts/reset-admin-totp.js <username>
```

It clears the TOTP secret (both columns), the recovery codes and any login in
flight, and **ends every session** the account has. Password and role are
untouched. At the next sign-in the account owes enrolment again (steps above).

On Azure: run it from a workstation whose IP is on the PostgreSQL firewall
allow-list, with `DATABASE_URL` taken from the instance's Key Vault, or from the
web app's SSH console. Log who asked and why — the script does not.

If the *only* admin is locked out, this script is the only door. There is no
environment switch that turns the rule off in production.

## Configuration

| Variable | Meaning |
|---|---|
| `TOTP_ENC_KEY` | 32-byte key (base64 or hex) that encrypts TOTP secrets at rest. **Set it on every real instance** — see below. Malformed → the server refuses to boot. Unset → secrets stay in plaintext and production logs a warning at boot. |
| `ADMIN_TOTP_EXEMPT` | Comma-separated usernames (or `*`) not forced to enrol. **Ignored when `NODE_ENV=production`** — which includes the Azure TEST stack; the server warns at boot if it finds it there. It exists for the Jest and Playwright suites (dozens of admin sign-ins a minute cannot pass TOTP's one-code-per-30-seconds replay guard) and for a developer's local database. `tests/env.js` sets `*`; `playwright.config.js` exempts `testadmin` by name. |

Generate a key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store it as a Key Vault secret and reference it from the web app's settings,
like `CSRF_SECRET`. **Back it up with the other secrets**: once the plaintext
column is gone (below), losing the key locks out every admin until each is
reset with the break-glass script. Rotating it means the same: reset, re-enrol.

## The secret at rest — a three-release migration

`users.totp_secret` was plain `TEXT`: a database dump carried every admin's
second factor. It moves to `users.totp_secret_enc` (AES-256-GCM,
`server/utils/secretBox.js`, the user id bound in as associated data so a
ciphertext copied to another account does not open; format
`v1:<iv>:<tag>:<ciphertext>`, each part base64).

| Release | Schema | Code |
|---|---|---|
| **N — this one** (`107_totp_secret_enc`; rk applied it as `093_totp_secret_enc` and aliases the engine name) | adds `totp_secret_enc` | writes **both** columns, reads the encrypted one with a fallback to the plaintext. An account enrolled earlier is sealed at its next successful sign-in (`COALESCE`, never over an existing sealed copy). A sealed copy that will not open (wrong key, foreign row) is logged and the plaintext used while it exists. |
| N+1 | — | stops writing `totp_secret`; a migration NULLs it where `totp_secret_enc` is set. Requires `TOTP_ENC_KEY` at boot. |
| N+2 | drops `totp_secret` | — |

Writing both in release N is stack invariant 14, not caution: during a
self-update swap the previous container still serves, and a rollback lands on
it — it reads `totp_secret`, and an admin enrolled after the release would be
locked out if only the new column had been written. Until N+1 ships, the
plaintext is still in the database; `TOTP_ENC_KEY` today buys the tested path
and the sealed copies, not yet the absence of the plaintext. **Without the key
nothing changes for an instance**: the sealed column stays NULL, every
existing admin keeps signing in from the plaintext, and production says so in
the boot log.

## Rolling this out to an instance (TEST first, then PROD)

1. Create `TOTP_ENC_KEY` in the instance's Key Vault, add the Key Vault
   reference to the web app's settings, restart. Check the boot log has no
   `TOTP_ENC_KEY is not set` warning.
2. Make sure nobody has set `ADMIN_TOTP_EXEMPT` on the web app.
3. Deploy. Migration `107` applies at boot.
4. Every protected account that has **not** enrolled is sent to the set-up
   panel at its next sign-in (or next page load, if signed in). Enrolled
   accounts notice nothing.
5. Have each admin confirm they saved their recovery codes.
