// GET /api/v1/announcement — the site announcement, public (harvest2-lane7a,
// ported from icelandicstore #200, where it rode /shop/config; here it has its
// own mount because the announcement is site-wide and the shop is a module an
// instance may not have).
//
// The window is decided HERE, on the server clock (utils/announcementWindow.js
// publicAnnouncement): outside it, or with no title, the answer is
// `{ active: false }` and nothing else — unpublished wording never reaches a
// browser, and a wound-back client clock cannot bring a finished one back.
// It never errors to the page either: a failed read is `{ active: false }`
// (the ambience rule — a decoration must not break the site).
const Setting = require('../models/Setting');
const logger = require('../logger');
const { publicAnnouncement } = require('../utils/announcementWindow');

const announcementController = {
  async getPublic(req, res) {
    // Not cached anywhere: an end time must take effect on the next load.
    res.set('Cache-Control', 'no-store');
    try {
      return res.json(publicAnnouncement(await Setting.getAnnouncementSettings()));
    } catch (err) {
      logger.warn({ err: { message: err.message } }, '[announcement] read failed; answering inactive');
      return res.json({ active: false });
    }
  },
};

module.exports = announcementController;
