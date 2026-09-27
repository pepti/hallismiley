// Lead-capture handler for the business contact form (/hafa-samband).
// Validates the enquiry, notifies the company inbox, persists the lead to
// the `leads` table (migration 097 — the inbox at /admin/leads), and records
// a no-PII conversion event. Email and row are independent, fire-and-forget:
// a database problem never delays the visitor or stops the email, and vice
// versa. /personuvernd §3 + §6 describe this store — change both together.
// The email's outcome is recorded on the stored row (notified_at /
// notify_error, migration 108) so the inbox shows which enquiries nobody was
// emailed about: with no RESEND_API_KEY on PROD every enquiry used to vanish
// behind a "received" reply (found in rekstrarkerfid, 2026-09-15; harvested
// 2026-09-23).
const { randomUUID } = require('crypto');
const { t }          = require('../i18n');
const logger         = require('../logger');
const { AnalyticsEvent } = require('../models/Analytics');
const Lead           = require('../models/Lead');
// Held as a module reference rather than a destructured function so the
// notification can be stubbed in tests (a destructured binding captures the
// original and ignores any later spy).
const emailService = require('../services/emailService');
// Process-wide ceiling on notification sends (harvested from icelandicstore
// #295, 2026-09-24): the per-IP limiter cannot bound a rotating-IP bot, and
// every accepted enquiry is one send from the transactional sender that also
// carries every invite and password reset.
const { contactBudget } = require('../services/contactBudget');
const EventLog       = require('../models/EventLog');
const { isValidPhone } = require('../utils/contactFormat');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The platform a prospect is moving off. Free text is accepted (the form
// offers these as options but a lead is never rejected for typing something
// else) — the list exists so analytics props stay a small, known set.
// Since 2026-09-26 the form offers categories, not product names (Halli); the
// product values stay so older leads, imports and API callers still map.
const KNOWN_PLATFORMS = [
  'webstore', 'website', 'accounting', 'custom', 'spreadsheets',
  'shopify', 'wix', 'wordpress', 'woocommerce', 'squarespace', 'dk', 'regla', 'payday',
  'none', 'other',
];

function normalizePlatform(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim().toLowerCase();
  return KNOWN_PLATFORMS.includes(v) ? v : 'other';
}

async function submit(req, res, next) {
  try {
    const { name, email, message, website, company, phone, current_platform: currentPlatform } = req.body || {};

    // Honeypot — bots fill in this hidden field, humans never see it
    if (website) {
      return res.status(200).json({ message: t(req.locale, 'errors.contact.messageReceived') }); // silent discard
    }
    const errors = [];

    if (!name    || typeof name    !== 'string' || name.trim().length    < 1)   errors.push(t(req.locale, 'errors.contact.nameRequired'));
    if (!email   || typeof email   !== 'string' || !EMAIL_RE.test(email.trim())) errors.push(t(req.locale, 'errors.contact.emailRequired'));
    if (!message || typeof message !== 'string' || message.trim().length  < 10)  errors.push(t(req.locale, 'errors.contact.messageMinLength'));

    if (name    && name.trim().length    > 100)  errors.push(t(req.locale, 'errors.contact.nameTooLong'));
    if (email   && email.trim().length   > 200)  errors.push(t(req.locale, 'errors.contact.emailTooLong'));
    if (message && message.trim().length > 2000) errors.push(t(req.locale, 'errors.contact.messageTooLong'));

    // Optional business fields — length-capped, never required: a lead is
    // worth more than a perfectly filled form.
    if (company && (typeof company !== 'string' || company.trim().length > 150)) errors.push(t(req.locale, 'errors.contact.companyTooLong'));
    if (phone   && (typeof phone   !== 'string' || phone.trim().length   > 40))  errors.push(t(req.locale, 'errors.contact.phoneTooLong'));
    // A phone of the wrong SHAPE ("call me", "12") is refused with the same rule
    // every other phone field uses (utils/contactFormat.js, ported from
    // icelandicstore #399) — the form points at the field before submitting, so
    // a visitor fixes it rather than losing the enquiry. Blank stays fine.
    else if (typeof phone === 'string' && phone.trim() && !isValidPhone(phone.trim())) errors.push(t(req.locale, 'errors.contact.phoneInvalid'));

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const platform     = normalizePlatform(currentPlatform);
    const submissionId = randomUUID();

    // Correlation ID + non-identifying platform only. Name, company, email,
    // phone and the message body are PII and must never reach the log store.
    logger.info({ submissionId, platform: platform || 'none' }, 'lead submission received');

    res.status(200).json({ message: t(req.locale, 'errors.contact.messageReceivedFull') });

    // Fire-and-forget: neither the notification nor analytics may delay or
    // fail the visitor's response.
    const lead = {
      submissionId,
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      company: company ? company.trim() : null,
      phone: phone ? phone.trim() : null,
      platform,
      locale: req.locale,
    };

    // The inbox row. Lead.create never throws (it logs the id and returns
    // null), so the email below and the response already sent are untouched
    // by whatever the database does.
    const stored = Lead.create(lead).catch(() => null);

    // Over the send budget: the lead is still stored and the visitor already
    // has their 200 (the form must not tell a bot it found a limit), but no
    // mail goes out. The row says why, and Admin → Monitoring gets a warn row
    // (no PII) — that is where the owner looks.
    if (!contactBudget.take()) {
      logger.warn({ submissionId, budget: contactBudget.snapshot() }, 'lead notification NOT sent — contact send budget exhausted');
      EventLog.record({
        source: 'server', level: 'warn',
        message: 'Contact enquiry notification not sent (over budget)',
        path: 'POST /api/v1/contact', status: 200,
        requestId: req.requestId || null,
        context: { submissionId, outcome: 'over_budget' },
      });
      stored.then(() => Lead.recordNotification(submissionId, 'over send budget'))
        .catch(err => logger.error({ submissionId, err: err.message }, 'lead notification outcome not recorded'));
      AnalyticsEvent.record({
        event_type: 'contact_submit', locale: req.locale, props: { platform: platform || 'none' },
      }).catch(() => {});
      return;
    }

    // The notification, independent of the row. Its OUTCOME is recorded on
    // the row once both have settled (the outcome write would otherwise race
    // the row's insert): null = sent, else a short reason. sendLeadNotification resolves
    // false when no transport is configured and throws on a send error;
    // recordNotification never throws, and the trailing catch keeps the whole
    // chain from ever surfacing as an unhandled rejection.
    emailService.sendLeadNotification(lead)
      .then(sent => stored.then(() => Lead.recordNotification(submissionId, sent === false ? 'email not configured' : null)))
      .catch(err => {
        logger.error({ submissionId, err: err.message }, 'lead notification failed');
        return stored.then(() => Lead.recordNotification(submissionId, err.message));
      })
      .catch(err => logger.error({ submissionId, err: err.message }, 'lead notification outcome not recorded'));

    AnalyticsEvent.record({
      event_type: 'contact_submit',
      locale: req.locale,
      props: { platform: platform || 'none' },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
}

module.exports = { submit, KNOWN_PLATFORMS, normalizePlatform };
