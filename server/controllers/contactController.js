// Lead-capture handler for the business contact form (/hafa-samband).
// Validates the enquiry, notifies the company inbox, persists the lead to
// the `leads` table (migration 097 — the inbox at /admin/leads), and records
// a no-PII conversion event. Email and row are independent, fire-and-forget:
// a database problem never delays the visitor or stops the email, and vice
// versa. /personuvernd §3 + §6 describe this store — change both together.
const { randomUUID } = require('crypto');
const { t }          = require('../i18n');
const logger         = require('../logger');
const { AnalyticsEvent } = require('../models/Analytics');
const Lead           = require('../models/Lead');
// Held as a module reference rather than a destructured function so the
// notification can be stubbed in tests (a destructured binding captures the
// original and ignores any later spy).
const emailService = require('../services/emailService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The platform a prospect is moving off. Free text is accepted (the form
// offers these as options but a lead is never rejected for typing something
// else) — the list exists so analytics props stay a small, known set.
const KNOWN_PLATFORMS = ['shopify', 'wix', 'wordpress', 'woocommerce', 'squarespace', 'dk', 'regla', 'payday', 'none', 'other'];

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
    emailService.sendLeadNotification({
      submissionId,
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      company: company ? company.trim() : null,
      phone: phone ? phone.trim() : null,
      platform,
      locale: req.locale,
    }).catch(err => logger.error({ submissionId, err: err.message }, 'lead notification failed'));

    // The inbox row. Lead.create never throws (it logs the id and returns
    // null), so the email above and the response already sent are untouched
    // by whatever the database does.
    Lead.create({
      submissionId,
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      company: company ? company.trim() : null,
      phone: phone ? phone.trim() : null,
      platform,
      locale: req.locale,
    }).catch(() => {});

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
