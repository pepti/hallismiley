'use strict';
// Public read-only endpoint for the live-Iceland scene layer. ALWAYS 200:
// upstream trouble means { available: false } and the client stays static —
// weather is atmosphere, never an error surface.
const { getAmbience } = require('../services/icelandAmbience');

module.exports = {
  async getAmbience(req, res) {
    const data = await getAmbience(); // never throws
    res.set('Cache-Control', 'public, max-age=300');
    if (!data) return res.json({ available: false });
    return res.json({ available: true, ...data });
  },
};
