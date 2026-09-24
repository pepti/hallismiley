# Two-factor sign-in — optional or mandatory enrolment, and the secret at rest

The accounts two-factor sign-in protects are: an account holding `admin`
(primary role or anywhere in its role set), a holder of the `accounts` view (a
seller who owns customer accounts, ENHANCEMENTS #17) and a published seller on
the public instance (D-020) — `mfaService.protectedRole`. Whether such an
account MUST enrol is a per-instance switch.

## Optional or required — `security.mfa.enrolment`

| Value | What it means |
|---|---|
| **`optional`** — the default (Halli, 2026-09-23: "change mfa to optional") | Nobody is forced to enrol. An unenrolled admin is an admin; an unenrolled `accounts` holder has the `accounts` view; nothing is withheld and `mfa_enrolment_required` is always `false`, so the SPA never sends anyone to the panel. **Prófíll → Tveggja þátta staðfesting** still offers enrolment to every protected account, with the "password only" hint as the recommendation. An account that HAS enrolled is challenged for a code at every sign-in exactly as before, and the secret is sealed at rest the same way. |
| **`required`** | The mandatory rule below: an unenrolled protected account has what made it protected withheld until it enrols. |

Set it in `config/client.json`:

```json
"security": { "mfa": { "enrolment": "required" } }
```

or per deployment with the app setting `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT=required`
(the env var wins over the file, like every `CLIENT_CONFIG_*`). Any other value
warns at boot and keeps the default. This repo's `config/client.json` spells out
`optional`. Moving an instance from `optional` to `required` takes effect on each
account's next request — an unenrolled admin who is signed in loses the admin
area there and then and is sent to the panel; plan the switch with the admins.

**The seller area follows the switch too** (Halli, 2026-09-23; history
`mfa-reminder-2026-09-23`). `/api/v1/seller` rule 4
(`server/routes/sellerRoutes.js`) demands `totp_enabled` for every route except
`GET /me` **only under `required`** — it asks `enrolmentRequired()` from
`auth/mfaPolicy.js` per request. Under `optional` a published seller reads their
leads, accounts and commission statements with a password; `/me` reports
`mfa_ready: true` ("the rest of the area answers this session"). Until that day
the rule applied in both modes; it predates the mandatory-enrolment harvest
(D-020). Pinned both ways in `tests/integration/sellerArea.test.js`.

## The reminder under `optional`

Halli, 2026-09-23: optional, "but put a reminder somewhere, and a checkmark not
to see the reminder again".

- **Who sees it**: an account `mfaService.shouldEnrol` recommends enrolment to
  (a protected role — admin by role or role set, `accounts` holder, published
  seller — without TOTP) that has not dismissed it, and only while the instance
  is `optional` (`mfaPolicy.reminderCandidate`; under `required` the forced
  flow applies instead). Every session payload carries `mfa_reminder`
  (`authController.roleFields`, which reads the enrolment and the dismissal
  from the row, not from whichever user object its caller had), so the SPA
  decides without a request of its own. Enrolling makes it go away by itself.
- **Where**: at the top of the admin shell's content pane, above every admin
  screen (`renderAdminShell` in `components/AdminSidebar.js`), and at the top of
  the seller area on the public instance (`SellerAreaView`). The component is
  `public/js/components/mfaReminder.js`, styled in `public/css/mfa-reminder.css`
  (tokens only). A labelled region: a short line, **Setja upp í Prófíl**
  (`/profile?focus=2fa` — Prófíll scrolls to the Tveggja þátta staðfesting panel
  and focuses its heading), the checkbox **Ekki sýna þetta aftur**, and ✕
  (**Loka áminningu**).
- **✕** hides it until the page is next loaded (in memory — moving between
  admin screens does not bring it back, a reload does). Nothing is saved.
- **Ticking the checkbox saves at once** and closes the notice with a toast
  that says two-step lives on Prófíll. `POST /auth/mfa-reminder/dismiss`
  (session, CSRF, 30 / 15 min per IP; the body is ignored, so it only ever
  writes the caller's own row; idempotent — the first time is kept) stamps
  `users.mfa_reminder_dismissed_at` (migration 109), so the choice holds on
  every device. There is no "show it again" switch: the Prófíll panel is always
  there. Turning two-step off later does not bring back a dismissed reminder.
- The copy (`mfaReminder.*` in `public/js/i18n/is.json` / `en.json`) is DRAFT
  until Halli approves it.

The mandatory rule was written in rekstrarkerfid on 2026-09-18 (Öryggisvörður's
review while fact-checking its /um-kerfid page, which promises "TOTP fyrir
stjórnendur") and harvested into the engine under D-021 on 2026-09-23, first as
the only behaviour, the same day as this switch (history:
`mfa-optional-2026-09-23`). The engine's gate is wider than rk's, so under
`required` the policy withholds the role for an admin and the view for an
accounts holder.

## The rule under `required`

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
    (`routes/sellerRoutes.js`, rule 4 — under `required` only); the session
    payload still says the seller owes enrolment.
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

## What an admin sees the first time (under `required`)

Under `optional` an unenrolled admin simply signs in and uses the admin area;
setting up two-step is steps 3–4 below, from the profile page, whenever they
choose.

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

## An admin resets another account's two-step verification

Since 2026-09-24 (harvested from icelandicstore #396) the running app has a
way back for everyone but the last admin: **Admin → Notendur → Endurstilla
2FA** (`POST /api/v1/admin/users/:id/totp/reset`, admin + CSRF). It runs the
same teardown as the self-service turn-off (secret, recovery codes, replay
marker) and ends every session the account holds; the password is untouched.
Never your own account (that goes through the profile page, which re-asks the
password). A STAFF account — admin, moderator, or any role that grants an
admin view — needs the ACTING admin's own password as well, so a walk-up
attacker at one admin's unlocked laptop cannot strip another's second factor.
A plain customer account needs none.

## Break-glass: an admin has lost the phone AND the recovery codes

When no other admin can reset it (the section above), nothing in the running app can help — that is the point. The way back in is
database access, a stronger credential than anything the web app accepts:

```bash
# on a machine that can reach the instance's database, DATABASE_URL set
node server/scripts/reset-admin-totp.js <username>
```

It clears the TOTP secret (both columns), the recovery codes and any login in
flight, and **ends every session** the account has. Password and role are
untouched. At the next sign-in the account signs in with its password alone —
under `required` it then owes enrolment again (steps above); under `optional`
it can set two-step up again from the profile page.

On Azure: run it from a workstation whose IP is on the PostgreSQL firewall
allow-list, with `DATABASE_URL` taken from the instance's Key Vault, or from the
web app's SSH console. Log who asked and why — the script does not.

If the *only* admin is locked out, this script is the only door. Setting
`security.mfa.enrolment` to `optional` does NOT help an admin who has enrolled
and lost the phone: the challenge for an enrolled account is the same in both
modes. `ADMIN_TOTP_EXEMPT` does not work in production either.

## Configuration

| Variable | Meaning |
|---|---|
| `TOTP_ENC_KEY` | 32-byte key (base64 or hex) that encrypts TOTP secrets at rest. **Set it on every real instance** — see below. Malformed → the server refuses to boot. Unset → secrets stay in plaintext and production logs a warning at boot. |
| `CLIENT_CONFIG_SECURITY_MFA_ENROLMENT` | `optional` (default) or `required` — overrides `security.mfa.enrolment` in `config/client.json` (above). Not a secret. |
| `ADMIN_TOTP_EXEMPT` | Comma-separated usernames (or `*`) not forced to enrol — meaningful only under `required`. **Ignored when `NODE_ENV=production`** — which includes the Azure TEST stack; the server warns at boot if it finds it there. It exists for the Jest and Playwright suites (dozens of admin sign-ins a minute cannot pass TOTP's one-code-per-30-seconds replay guard) and for a developer's local database. Playwright starts TWO servers on the same database (`playwright.config.js`, since mfa-reminder-2026-09-23): the main one runs the `optional` default (every spec, the reminder spec among them — nobody needs exempting there), and a second one on `E2E_PORT + 1` runs `required` for `e2e/admin-totp-enrolment.spec.js`, which walks the mandatory rule in a browser and exempts only `testadmin` by name; `tests/env.js` sets `*`, which no Jest suite needs under the `optional` default any more — it stays for a suite that switches to `required`. |

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
3. Deploy. Migrations `107` and `109` apply at boot.
4. Under `required`, every protected account that has **not** enrolled is sent
   to the set-up panel at its next sign-in (or next page load, if signed in).
   Under `optional` (the default) nobody is sent anywhere; each unenrolled
   protected account sees the dismissible reminder above the admin area (or
   the seller area) until it enrols or ticks "Ekki sýna þetta aftur" — ask the
   admins to enrol from the profile page. Enrolled accounts notice nothing in
   either mode.
5. Have each admin confirm they saved their recovery codes.
