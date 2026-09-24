---
id: email
name: {is: "Tölvupóstur", en: Email}
domain: 19
owner: engine
status: live
flag: null
paths:
  - server/services/emailService.js
  - server/services/outboundAllowlist.js
  - tests/unit/outboundAllowlist.test.js
  - tests/unit/emailReplyTo.test.js
  - server/utils/inviteSend.js
  - tests/integration/inviteFeedback.test.js
  - tests/unit/emailNameOnlyRecipient.test.js
migrations: []
since: 2026-08-09
origin: null
history: [harvest-1, r1, go-live, harvest-ice-a-2026-09-24]
---

Transactional email over SMTP: `emailShell` wraps every template, `EMAIL_FROM` / `EMAIL_REPLY_TO` come from env, and `EMAIL_ALLOWLIST` limits recipients outside production. Templates read `server/i18n`.

Since 2026-09-24 (icelandicstore #258) a sender returns the provider id or `false`, `isRedirecting()` reports an allowlist rewrite, and invites answer through `utils/inviteSend.js`: "invited" only when the mail reached the customer, otherwise the set-password link comes back. `deliver()` drops reserved no-mailbox placeholders before the allowlist.

**Rules**
- Sender is `EMAIL_FROM`; never the base's address; mail failures are loud.
- `emailShell` escapes its `<title>`.
- "Sent" means accepted for the recipient asked for — never "a transport is configured"; `invited_at` is stamped only on a confirmed, un-redirected send.
- Full rules: [../docs/ARCHITECTURE.md#19-email](../docs/ARCHITECTURE.md#19-email).
