// Contact form handler
// Validates and forwards enquiries. Wire up nodemailer or a mail API (e.g. Resend)
// to forward submissions to your inbox.
const { randomUUID } = require('crypto');
const { t }          = require('../i18n');

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
    // must not be written to aggregated log stores.  Wire in Resend/nodemailer
    // here to actually deliver the submission to your inbox.
    const submissionId = randomUUID();
    console.log(`[Contact] Submission received: id=${submissionId} topic=${normalizedTopic || 'none'}`);

    res.status(200).json({ message: t(req.locale, 'errors.contact.messageReceivedFull') });
  } catch (err) {
    next(err);
  }
}

module.exports = { submit };
