// Send an invite (set-password or welcome) and report what ACTUALLY happened.
//
// Four call sites used to hand-roll this and three got it wrong the same way:
// swallow the send error, then answer `emailed: emailService.isConfigured()` —
// "are credentials present", not "did the mail go out". On PROD the transport is
// always configured, so a hard failure was indistinguishable from a delivered
// invite, and the fallback link was withheld in exactly the case the admin
// needed it: press Send, get a green toast, customer gets nothing.
//
// Returns { emailed, emailError, redirected, resetUrl }:
//   emailed    — the message was accepted for delivery. Nothing more: Graph
//                answers 202 without a message id, so this is "queued", not
//                "landed in their inbox".
//   redirected — EMAIL_ALLOWLIST rewrote the recipient (mandatory on TEST), so
//                the message went somewhere OTHER than `email`. `emailed` is
//                still true, but the customer was not the recipient and no UI
//                may claim they were.
//   emailError — why it failed, for staff eyes only. Never hand this to a
//                customer-facing route: it carries Graph/Entra internals.
//   reachedRecipient — the message was accepted for delivery AND went to the
//                address asked for. This, not `emailed`, is the question a
//                caller is actually asking before it decides to withhold the
//                fallback link: a redirected send is "sent" but the customer
//                still has nothing.
//   resetUrl   — always computed. Expose it whenever `reachedRecipient` is
//                false; withhold it on a genuine delivery, which keeps a
//                credential-equivalent link off the wire in the common case.
const emailService = require('../services/emailService');
const logger       = require('../logger');
const { isPlaceholderEmail } = require('./placeholderEmail');

// A rejection is not guaranteed to be an Error: a string, a plain object, or
// even null/undefined can arrive here. Reading `.message` off those yields
// undefined (which would silently downgrade a hard failure to the benign
// "link generated" path) or throws (turning a failed send into a 500).
function reasonOf(err) {
  if (err instanceof Error && err.message) return err.message;
  const s = err == null ? '' : String(err);
  return s || 'Unknown email error';
}

async function sendInvite({ email, token, locale, context = 'invite', send }) {
  // A reserved no-mailbox placeholder (a name-only customer, the Pressan tablet)
  // is not an address: nothing is sent, nothing is logged as a failure, and no
  // link comes back — it would be a credential-equivalent URL for an account
  // whose password the admin hands over in person. Callers refuse these rows
  // before minting a token; this is the second lock.
  if (isPlaceholderEmail(email)) {
    logger.info({ context }, 'invite skipped: login has no email address');
    return { emailed: false, emailError: null, redirected: false, reachedRecipient: false, resetUrl: null, noEmail: true };
  }
  const sender = send || ((to, tok, loc) => emailService.sendPasswordResetEmail(to, tok, loc));
  let emailed    = false;
  let emailError = null;
  try {
    // Truthy only on a confirmed send: the senders return a request id, or
    // false when the transport is not configured.
    emailed = Boolean(await sender(email, token, locale));
  } catch (err) {
    emailError = reasonOf(err);
    // Pass the Error itself, not its message: observability/aiLogStream promotes
    // `err` at error level through errorFrom(), which reads .message/.stack/.type
    // — all undefined on a string, which would drop the Graph reason from
    // App Insights and leave only this generic line.
    logger.error({ err }, `[${context}] invite email failed`);
  }
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const redirected = emailed && emailService.isRedirecting();
  return {
    emailed,
    emailError,
    redirected,
    reachedRecipient: emailed && !redirected,
    resetUrl: `${appUrl}/${locale}/reset-password?token=${token}`,
  };
}

// Send the welcome invite to ONE customer — the SAME template and saved copy
// the bulk 'send invites' flow uses, never the password-reset mail (a brand-new
// customer told to 'reset the password' on an account they never had reads as
// phishing). Shared by the customer create flow, the per-customer re-send and
// the company create flow. invited_at stays the bulk-invite candidacy key and
// is stamped only on a confirmed, un-redirected send. The link comes back only
// when the mail did NOT reach the customer.
const INVITE_LOCALES = ['en', 'is'];
const inviteLocale = (loc) => (INVITE_LOCALES.includes(loc) ? loc : 'en');

async function sendWelcomeInvite({ user, token, locale, context }) {
  // Required lazily: models pull in the database pool, and this module is also
  // loaded by code paths that never send a welcome invite.
  const Setting = require('../models/Setting');
  const { query: dbQuery } = require('../config/database');
  const loc       = inviteLocale(locale);
  const overrides = await Setting.getInviteEmail();
  // A placeholder address comes back emailed:false, so invited_at is never
  // stamped for a login that has no mailbox.
  const { emailed, emailError, redirected, reachedRecipient, resetUrl, noEmail } = await sendInvite({
    email: user.email, token, locale: loc, context,
    send: (to, tok, l) => emailService.sendWelcomeInviteEmail(to, tok, l, overrides[l]),
  });
  if (emailed && !redirected) {
    await dbQuery('UPDATE users SET invited_at = NOW() WHERE id = $1', [user.id]);
  }
  return {
    emailed,
    ...(redirected ? { redirected } : {}),
    ...(emailError ? { emailError } : {}),
    ...(noEmail ? { noEmail } : {}),
    ...(reachedRecipient || noEmail ? {} : { resetUrl }),
  };
}

module.exports = { sendInvite, sendWelcomeInvite, inviteLocale };
