// Contact form handler
// Validates and logs enquiries. Wire up Resend (see server/services/emailService.js)
// to forward submissions to your inbox.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_TOPICS = ['carpentry', 'software', 'collaboration', 'press', 'other'];

async function submit(req, res, next) {
  try {
    const { name, email, message, website, topic } = req.body || {};

    // Honeypot — bots fill in this hidden field, humans never see it
    if (website) {
      return res.status(200).json({ message: 'Message received.' }); // silent discard
    }
    const errors = [];

    if (!name    || typeof name    !== 'string' || name.trim().length    < 1)   errors.push('Name is required.');
    if (!email   || typeof email   !== 'string' || !EMAIL_RE.test(email.trim())) errors.push('A valid email address is required.');
    if (!message || typeof message !== 'string' || message.trim().length  < 10)  errors.push('Message must be at least 10 characters.');

    if (name    && name.trim().length    > 100)  errors.push('Name must be 100 characters or fewer.');
    if (email   && email.trim().length   > 200)  errors.push('Email must be 200 characters or fewer.');
    if (message && message.trim().length > 2000) errors.push('Message must be 2000 characters or fewer.');

    // Topic is optional (Home form omits it). When present, restrict to known values.
    const normalizedTopic = typeof topic === 'string' && topic.trim()
      ? topic.trim().toLowerCase()
      : null;
    if (normalizedTopic && !ALLOWED_TOPICS.includes(normalizedTopic)) {
      errors.push('Invalid topic.');
    }

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // Log the enquiry — replace this block with a Resend call (see emailService.js).
    console.log('[Contact] New enquiry received:');
    console.log(`  Name:    ${name.trim()}`);
    console.log(`  Email:   ${email.trim()}`);
    if (normalizedTopic) console.log(`  Topic:   ${normalizedTopic}`);
    console.log(`  Message: ${message.trim().slice(0, 120)}${message.length > 120 ? '…' : ''}`);

    res.status(200).json({ message: 'Message received. I\'ll be in touch soon.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { submit };
