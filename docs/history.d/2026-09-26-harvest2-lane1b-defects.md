<a id="harvest2-lane1b-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 1b: generic defects and staff-audit gaps from icelandicstore

Branch `harvest2/lane1b-defects`, ported from icelandicstore at `941cf51d`
(read-only: `git show` and `gh pr view` only). Halli approved the scope
2026-09-26. Seven items; every ported piece carries a
"Ported from icelandicstore #NNN" comment.

**1. One nav menu closer (ice #379).** `NavBar._renderAuthInto` added a
`document` click listener on every signed-in render: the top bar and the
drawer, on each authchange, userchange and locale switch. A tab left open all
day piled them up, each holding a detached dropdown. Only the generic idea of
ice's `components/navChrome.js` came over (its /workshop kiosk header is
ice's): `public/js/components/navMenuCloser.js` installs ONE listener that
closes whatever menus are open, and a toggle closes the other menu first.
`_bindLangSwitcher` re-ran on every render too, stacking click handlers so
one click on IS fired `updateProfile` + `switchLocale` several times; the
buttons now carry ice's bind-once mark. `tests/unit/navMenuCloser.client.test.js`
renders the auth area twelve times against a small fake DOM (the repo has no
jsdom) and counts one listener.

**2. `auth_login_attempts_total` counts (ice #55).** Defined in
`server/observability/metrics.js` long ago, never incremented. ice wired
success/failure/locked; the engine also counts `refused` (right password,
account disabled/pending/declined) and the 2FA step: `totp_required` when the
challenge is issued, then `success`/`failure` on `/login/totp`. The party
magic link counts `success`. `tests/integration/authLoginMetrics.test.js`
asserts every label by delta.

**3. Signup does not wait on email; a cancelled confirm says so (ice #199).**
`POST /auth/signup` awaited the verification send after the account was
committed. The engine's Resend transport already bounds a send at 10 s, so
this never hung for ever as ice's bare `fetch` did, but a stalled send still
held the visitor on "Creating account…" for a signup that had succeeded. The
send is now detached, `.catch` → pino warn. ice's other half, the approval
that silently did nothing, was a confirm() gating a SAFE action; the engine
has no such gate (its Users-page approve/decline have no confirm). What does
carry over is the lesson that a bare `return` after a cancelled confirm reads
as a dead button — and confirm() answers false with no dialog once a browser
blocks dialogs — so the Users page's delete / 2FA reset / new-password and
the party revoke now show an info toast, `admin.actionCancelled` (DRAFT, EN +
IS). `tests/integration/signupEmailNonBlocking.test.js` hands signup a mailer
that never settles and expects the 201.

**4. The translator salvages prose-wrapped JSON (ice #216).** ice's order
vision failed live when the model wrapped its JSON in prose. The engine's
translator only stripped a code fence; `parseJsonArray` now tries the whole
reply, the outermost `[…]`, then an outermost `{…}` holding exactly one
array, and the length check still decides. `callModel` returns
`stop_reason`, logged when a batch reply still cannot be parsed —
`max_tokens` is a truncated array, `end_turn` a model that ignored the
format. Fixtures in `tests/unit/translator.test.js`.

**5. `aiGate`: a cap on concurrent paid AI calls (ice #218).** ice's
`visionGate` guarded three vision endpoints on the 1.75 GB tiers; the engine's
`server/services/aiGate.js` generalises it to every Claude call
(`AI_MAX_CONCURRENT`, default 4, ice's owner-raised value). Two modes:
`withSlot` refuses at once with the typed `AiBusyError`, which the central
error middleware answers 429 + `Retry-After` + `{ reason: 'AI_BUSY',
retryable: true }` (a new, generic hook: a safe-status error may carry
`messageKey` / `retryAfterSeconds` / `reason`); `withQueuedSlot` waits FIFO
and is what the translator uses — a 200-leaf tree fans out into parallel
batches, and refusing some would have cascaded into MORE calls through the
per-leaf fallback. The call's own timeout starts once the slot is held; the
queue wait is twice `TRANSLATE_TIMEOUT_MS`; a gate timeout is an ordinary
translator failure, so its never-throw contract holds. No engine route
raises the 429 today — it is the contract for the next request-path AI
endpoint (the vision ports). ice's shutdown handshake was not ported: the
engine's AI calls end within `TRANSLATE_TIMEOUT_MS` (8 s), inside
server.js's 10 s grace. The free boot self-check (`models.list`) is ungated.
ice's reverted per-IP limiter stays reverted (owner decision there: staff
never hit a budget mid-workflow).

**6. Staff-audit gaps (found reviewing ice #416/#421).** The Members tab's
`addMember`/`removeMember` always wrote `role.granted`/`role.revoked`; the
Users-page role dropdown (`adminController.changeRole`), role create/delete
and the hard user delete wrote nothing. They now write `role.granted` /
`role.revoked` (`via: 'users_page'`, one row per role actually gained or
dropped), `role.created` / `role.deleted`, and `user.deleted` (username +
role). Wiring them surfaced a quieter bug: `user.totp_reset` and
`user.password_replaced` were already written by `adminController` but were
missing from `staffAudit.ACTIONS`, so `record()` refused them and
`recordSafe` swallowed the refusal — neither had ever reached the log.

Found and NOT fixed (needs a migration, Halli's call): deleting a user who
ever acted in `staff_audit_log` fails 500. The `actor_id` foreign key's
`ON DELETE SET NULL` is an UPDATE, and the immutability trigger refuses every
UPDATE (`books_forbid_any_mutation`). Options: drop the FK (keep `actor_id`
as plain text, like `entity_id`), or let the trigger allow an update that
only nulls `actor_id`.

**7. The Users page's Party column follows the party module.** It rendered
on every instance; it now shows only while `moduleEnabled('party')`
(`tests/unit/adminUsersView.client.test.js`).

**Testing note.** The shared local Postgres held 743 stale test databases
(about 690,000 relation files), so one checkpoint took ~8.5 minutes and every
`DROP DATABASE` — which on Windows waits for a checkpoint and a
ProcSignalBarrier — queued behind it; globalSetup runs from several sessions
sat for 15+ minutes. The integration suites for this chunk ran against a
freshly created, migrated database with a scratch config that skips the
global DROP/CREATE. `npm run test:db:clean` would clear the backlog.
