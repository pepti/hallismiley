// Admin "General" settings. Reads/writes the general settings group (Setting
// model): store identity, store defaults, and the order-ID display format.
// `options` carries the curated enum lists the pickers render so their choices
// match exactly what the model will accept.
const Setting = require('../models/Setting');

const adminGeneralSettingsController = {
  // GET /api/v1/admin/general-settings
  async get(req, res, next) {
    try {
      const settings = await Setting.getGeneralSettings();
      const options = {
        timezones:    Setting.TIMEZONES,    // [{ id, label }] — curated IANA allowlist
        unit_systems: Setting.UNIT_SYSTEMS, // ['metric','imperial']
        weight_units: Setting.WEIGHT_UNITS, // ['kg','g','lb','oz']
        currency:     'ISK',                // ISK-only (shop stores ISK + EUR; ISK is base)
      };
      return res.json({ settings, options });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/general-settings  { store_name?, contact_email?, ... }
  async update(req, res, next) {
    try {
      const settings = await Setting.updateGeneralSettings(req.body || {});
      return res.json({ settings });
    } catch (err) {
      // Model throws plain validation Errors for bad input → surface as 400.
      if (err && /must be|one of|is required|too long|valid|Invalid settings/.test(err.message || '')) {
        return res.status(400).json({ error: err.message, code: 400 });
      }
      next(err);
    }
  },
};

module.exports = adminGeneralSettingsController;
