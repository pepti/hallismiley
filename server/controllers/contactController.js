// Contact form handler
// Validates enquiries, answers the visitor, then e-mails the submission to every
// verified, enabled admin (the same recipient rule shopController uses for
// booking notices) and records a no-PII analytics event. Until 2026-09-12 this
// was a stub that delivered nothing. Delivery is best-effort and never changes
// the response: the visitor has already been told the message was received, so
// a mail failure is an error line for the operator, not a 500 for the visitor.
const { randomUUID } = require('crypto');
const { t }          = require('../i18n');
const logger         = require('../logger');
const db             = require('../config/database');
const { AnalyticsEvent } = require('../models/Analytics');
const { sendContactNotification } = require('../services/emailService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_TOPICS = ['carpentry', 'software', 'collaboration', 'press', 'other'];

async function submit(req, res, next) {
  try {
    const { name, email, message, website, topic } = req.body || {};

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

    // Topic is optional (Home form omits it). When present, restrict to known values.
    const normalizedTopic = typeof topic === 'string' && topic.trim()
      ? topic.trim().toLowerCase()
      : null;
    if (normalizedTopic && !ALLOWED_TOPICS.includes(normalizedTopic)) {
      errors.push(t(req.locale, 'errors.contact.invalidTopic'));
    }

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // Log a correlation ID only — name, email, and message body are PII and
    // must not be written to aggregated log stores.
    const submissionId = randomUUID();
    logger.info({ submissionId, topic: normalizedTopic || 'none' }, '[contact] submission received');

    res.status(200).json({ message: t(req.locale, 'errors.contact.messageReceivedFull') });

    // Deliver to the admins, after the response. Recipients are looked up per
    // submission (an admin added yesterday gets today's enquiry). Failures are
    // logged with the id only.
    (async () => {
      const { rows } = await db.query(
        `SELECT email FROM users
          WHERE id IN (SELECT user_id FROM user_roles WHERE role_name = 'admin')
            AND email_verified = TRUE AND disabled = FALSE
            AND email IS NOT NULL`
      );
      const adminEmails = rows.map(r => r.email).filter(Boolean);
      if (!adminEmails.length) {
        logger.warn({ submissionId }, '[contact] no verified admin to deliver to');
        return;
      }
      await sendContactNotification({
        submissionId,
        adminEmails,
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        topic: normalizedTopic,
        locale: req.locale,
      });
    })().catch(err => logger.error({ submissionId, err: err.message }, '[contact] delivery failed'));

    // Fire-and-forget conversion event (no PII — topic only). Reached only on
    // the success path, so honeypot/validation failures are never counted.
    AnalyticsEvent.record({
      event_type: 'contact_submit',
      locale: req.locale,
      props: { topic: normalizedTopic || 'none' },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
}

module.exports = { submit };
