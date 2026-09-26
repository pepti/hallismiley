// Admin → Tilkynning: the time-limited site announcement (on/off, a start and
// end date-time in Reykjavík time, IS + EN title/message, an optional in-site
// link). Ported from icelandicstore #200 (harvest2-lane7a-2026-09-26). The
// `status.active` chip is the SAME rule the public endpoint applies
// (utils/announcementWindow.js), recomputed on every read and save.
const Setting = require('../models/Setting');
const { publicAnnouncement, TZ } = require('../utils/announcementWindow');

function payload(settings) {
  return { settings, status: { active: publicAnnouncement(settings).active, timezone: TZ } };
}

const adminAnnouncementController = {
  // GET /api/v1/admin/announcement
  async get(req, res, next) {
    try {
      return res.json(payload(await Setting.getAnnouncementSettings()));
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/announcement
  // { enabled?, starts_at?, ends_at?, title?: {en?,is?}, message?: {en?,is?},
  //   link_path?, link_label?: {en?,is?} } — validated whole, written in one
  //   transaction (Setting.collectAnnouncementWrites + applyWrites).
  async update(req, res, next) {
    try {
      return res.json(payload(await Setting.updateAnnouncementSettings(req.body || {})));
    } catch (err) {
      if (err instanceof Setting.SettingValidationError) {
        return res.status(400).json({ error: err.message, code: 400 });
      }
      next(err);
    }
  },
};

module.exports = adminAnnouncementController;
