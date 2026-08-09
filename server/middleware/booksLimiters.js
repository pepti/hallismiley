// Rate limiters specific to the books.
//
// The app's global limiter (400/15min) and writeLimiter (90/15min) cover ordinary
// traffic, but neither accounts for document generation: an invoice PDF is
// synchronous pdfkit work done inside the request, so a loop over invoice ids is a
// cheap way to saturate the event loop. Nothing else in this app limits document
// generation, so the books bring their own.
//
// Skips in test and development for the same reason the app's other limiters do —
// otherwise a test suite that issues a few dozen invoices starts 429ing.
const rateLimit = require('express-rate-limit');

const skip = () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';

// Generous enough for a real session of reviewing invoices and printing a handful,
// low enough that a scripted sweep is throttled well before it hurts.
const docLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: 'Too many document downloads, please try again shortly.', code: 429 },
});

module.exports = { docLimiter };
