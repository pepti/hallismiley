<a id="harvest2-lane2-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 2: the email shell is the instance's own, and an optional Microsoft Graph transport

Lane 2 of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`; Halli approved the scope on
2026-09-26). Branch `harvest2/lane2-email`. Ported from ice `cb684bbf` (#179, the light email
theme), `a5f50ffb` (#190, the logo in the header) and `a61c1fb1` (#173, the Graph transport), made
generic for the engine rather than copied.

**Why.** `emailShell()` was the last engine surface with a brand spelled in code: "Orange Smiley" and
"orangesmiley.is" as literals in the header, `Orange Smiley <…>` in From, on the inherited DARK
palette (near-black page, gold `#c9a84c`) with a `#444` footer that measures 2.00:1 on its `#0d0d0d`
band — under WCAG AA. Every downstream mailed its customers as Orange Smiley.
Icelandicstore fixed both halves for itself with hex literals (#179) and its own `logo.png` (#190);
the engine cannot, because every product has its own theme and logo.

**What changed — the shell (commit 1).**
- **Identity.** The header name, the host line (`APP_URL`'s host), the legal line in the footer
  (`identity.brand.legalName`, new) and the From display name come from the seam; `EMAIL_FROM`
  falls back to `identity.organization.email`. A name with an RFC 5322 special is quoted in From.
- **Palette.** `server/utils/emailPalette.js` resolves, at boot, the first LIGHT theme among
  `identity.theme.root`, `.default` and the picker ("light" = not in `identity.theme.dark` and a card
  that measures light) — email is light-only by design, so Glóð (the dark default here) is skipped,
  not converted. It reads `:root` in `variables.css` plus the theme's `html[data-theme]` block,
  follows `var()` chains, composites `rgba()` hairlines onto the card and emits literal `#RRGGBB`
  (mail clients do not resolve custom properties). `identity.email.palette` may override any role.
  An AA guard then measures every text colour on every surface it is painted on; a failing one is
  replaced by the next passing candidate and logged at boot. Ten roles: page, card, panel, border,
  heading, text, muted, accent, button, onButton.
- **Measured (this instance, from Bjart):** on the card `#FDFAF4` — heading `#2A1F17` 15.42, text
  `#574434` 8.83, muted `#6F5A46` 6.25, accent `#4F3722` 10.60; on the page/panel `#F2EBE0` — heading
  13.57, text 7.77, muted 5.50, accent 9.32; button label `#FFFFFF` on `#7B5533` 6.58. The old footer
  `#444` on `#0d0d0d` was 2.00. The neutral fallback (no light theme found) passes at ≥ 6.37.
- **Every sender** (all twelve) paints with palette roles; no colour literal is left in
  `emailService.js`. The gold also lived in the translated copy — seven `<strong style="color:#c9a84c">`
  spans per locale plus the footer link; the spans are plain `<strong>` now and the footer link takes
  `{linkStyle}` from the shell (accent, underlined — accent ink without an underline reads as body
  text). `color-scheme: light` is declared so Apple Mail / Outlook do not auto-invert the mail.
- **Logo.** `identity.email.{logo, logoWidth, logoHeight, logoWordmark}`: a file name under
  `public/assets/brand/` (the one CORP cross-origin exemption, `server/app.js`), linked absolute under
  `APP_URL`. The engine's is `orangesmiley-emblem.png` — `favicon.svg`, the 4.1 emblem, rasterised to
  192 px (Gmail and Outlook do not render SVG; no new artwork), shown at 48. An emblem sits beside
  the brand name set as text; a wordmark (`logoWordmark: true`, ice's case) stands alone and its alt
  text, set in the wordmark type, is the fallback when a client blocks remote images. The alt text is
  the brand name in both modes.
- **Tests.** `emailPalette.test.js` (the maths, token reading, theme choice, the guard; then every
  colour in every rendered mail must be a palette value and clear AA — measured from the real HTML
  that `tests/lib/renderAllEmails.js` gets from all twelve senders through a stubbed transport),
  `emailShell.test.js` (the engine defaults; a fake downstream identity with a wordmark and an accent
  override in which no "Orange Smiley" survives in any mail, subject or From; the configured logo
  exists and is not upscaled), `emailLogoAsset.test.js` (integration: 200, an image, CORP
  cross-origin). `identityConfig` and `i18nIdentity` follow the new keys.

**What changed — the transport (commit 2).**
- `server/services/mailTransport.js`: ONE switch, `EMAIL_TRANSPORT=resend|graph` (default resend).
  The `GRAPH_*` variables alone never move an instance off Resend — a half-finished Entra setup must
  not silently change how production mails; an unknown value is "not configured", named.
- Graph: client-credentials token (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`;
  icelandicstore's `M365_*` names are read as a fallback), cached until a minute before expiry,
  keyed by tenant/app, with ONE in-flight token request shared by concurrent sends; `sendMail` as
  `GRAPH_SENDER` (default the From address) with `saveToSentItems: false` unless
  `GRAPH_SAVE_TO_SENT_ITEMS=true` opts in; every call a `trackedFetch` (App Insights dependency)
  under ONE deadline per message — the `AbortSignal` `deliver()` creates bounds the token fetch,
  sendMail and the 401 retry together; a 401 on a cached token retries once. Graph answers 202 with no
  message id, so the minted `client-request-id` is returned as the id — the invite-sent-means-sent
  contract (`utils/inviteSend.js`) reads it, and it is what an Exchange message trace finds. Errors
  map to `{ error }` with the AADSTS code or the Graph error code, never the secret.
- `deliver()` stays the one choke point: placeholder drop, `EMAIL_ALLOWLIST` (which now also drops
  cc/bcc), Reply-To, the bounded wait (its timer is cleared once the send settles — it used to keep
  the process alive for 10 s after every send), loud failure naming the transport.
  `isConfigured()` answers for the SELECTED transport; `emailHealthCheck()` adds `transport`,
  `transportConfigured`, `missingSettings`, and keeps `resendConfigured` meaning "the selected
  transport is configured" for its two readers (admin email health, PartyAdminView).
- `sendPartyAnnouncement` used to call the Resend client directly — skipping `EMAIL_ALLOWLIST` and the
  placeholder drop. It goes through `deliver()` now, at most four sends in flight (Exchange throttles
  a mailbox at about 30 messages a minute; an unbounded fan-out opened every socket at once).
- `server/server.js`: production's boot check requires the selected transport's settings (was:
  `RESEND_API_KEY` only), and the boot warning names what is missing.
- `emailGraphTransport.test.js`: selection, token + cache + retry, sendMail payload, the error
  mapping, and through `deliver()`: the id comes back, the allowlist rewrites Graph recipients, a
  failure is logged at error level and the sender throws.
- Documented in `.env.example` and `docs/DEPLOYMENT.md`.

**Trimmed from ice.** #173's removal of Resend (the engine keeps it as the default); its
`saveToSentItems: true` as the default (an opt-in here — a transactional stream would fill the shared
mailbox); `invite-customers.js` pacing (ice-only script). #190's `logo.png` (ice's own artwork). #179's
per-hex palette (derived here).

**Review pass** (`invariant-reviewer` on the branch diff). Must-fixes, all fixed on the branch: (1) the
email font tail was `'Segoe UI', Helvetica, sans-serif` — the design rules allow only the bare
generic tail, so it is `sans-serif` alone, and `emailPalette.test.js` checks every font stack in every
rendered mail; (2) icelandicstore's `M365_*` settings would have gone unread after its sync —
`graphSettings` falls back to them, `GRAPH_SAVE_TO_SENT_ITEMS` is an opt-in (ice saves copies today),
and the sync precondition below is recorded here and in `engine.json`; (3) the token fetch, the send
and the retry each had their own timeout, so one message could take several — one deadline signal
per `deliver()` now. Should-fixes, done: bounded concurrency for the party announcement, a shared
in-flight token promise, `features/client-config.md` documents `identity.email`.

**Owed / for Halli.**
- **icelandicstore sync precondition**: before ice takes the engine sync that carries this lane, its
  TEST and PROD App Services need `EMAIL_TRANSPORT=graph` (its `M365_*` settings are then read as
  they are) and `GRAPH_SAVE_TO_SENT_ITEMS=true` if the store keeps its Sent Items copies. Without
  the switch the engine selects Resend, finds no `RESEND_API_KEY` and a production boot refuses to
  start. Its `emailService.js` conflicts wholesale (the Graph rewrite): take the engine's, and set
  `identity.email` to its `logo.png` (`logoWordmark: true`, 150 × 52).
- Downstreams' emails change look on their next engine sync: light, their own theme's tokens, and
  the Orange Smiley emblem until each sets `identity.email.logo` to its own file in
  `public/assets/brand/` (icelandicstore: `logo.png`, `logoWordmark: true`, 150 × 52).
- The Graph transport needs an Entra app registration (`Mail.Send`, admin consent, an Exchange
  application access policy) per tenant if it is ever used; nothing here turns it on.
- `adminController.getEmailHealth` and `PartyAdminView` still read the old `resendConfigured` name
  (lane-owned files); a follow-up can switch them to `transportConfigured`.
- No new DRAFT strings: the `email.*` copy is unchanged apart from markup (the gold spans removed, the
  footer link's style handed in); the footer's legal line is the configured legal name.
