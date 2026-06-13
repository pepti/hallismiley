// Minimal key-value application settings store. Each row is one setting: a
// stable string key + a JSONB value (so booleans, strings, and future
// structured values all fit without per-setting columns). Defaults live here so
// the app behaves correctly before any row has been written.
//
// Ported from the icelandicstore settings store, trimmed to what fits this
// (B2C) site: the generic get/set/getMany helpers plus the "general" group
// (store identity, address, store defaults, order-ID display). The store's
// wholesale-only groups (customer-account approval, checkout field rules) are
// intentionally omitted. This table is also the intended home for feature flags
// that later phases introduce.
const db = require('../config/database');

// Setting keys, namespaced so the store stays organised as it grows.
const KEYS = {
  // General settings group — store identity, store defaults, and the order-ID
  // display format.
  storeName:    'general.store_name',
  contactEmail: 'general.contact_email',
  phone:        'general.phone',
  address1:     'general.address1',
  address2:     'general.address2',
  city:         'general.city',
  zip:          'general.zip',
  country:      'general.country',
  unitSystem:   'general.unit_system',
  weightUnit:   'general.weight_unit',
  timezone:     'general.timezone',
  orderPrefix:  'general.order_prefix',
  orderSuffix:  'general.order_suffix',
};

// Allowed values for the General-settings enums. TIMEZONES is a *curated* IANA
// allowlist: real IANA ids so the stored value can drive Intl date formatting
// on both server and client. The label is shown in the picker; the id is what's
// stored and validated.
const TIMEZONES = [
  { id: 'Atlantic/Reykjavik',  label: '(GMT+00:00) Reykjavík' },
  { id: 'UTC',                 label: '(GMT+00:00) UTC' },
  { id: 'Europe/London',       label: '(GMT+00:00) London' },
  { id: 'Europe/Lisbon',       label: '(GMT+00:00) Lisbon' },
  { id: 'Europe/Copenhagen',   label: '(GMT+01:00) Copenhagen' },
  { id: 'Europe/Paris',        label: '(GMT+01:00) Paris' },
  { id: 'Europe/Berlin',       label: '(GMT+01:00) Berlin' },
  { id: 'Europe/Oslo',         label: '(GMT+01:00) Oslo' },
  { id: 'Europe/Stockholm',    label: '(GMT+01:00) Stockholm' },
  { id: 'Europe/Helsinki',     label: '(GMT+02:00) Helsinki' },
  { id: 'America/New_York',    label: '(GMT-05:00) New York' },
  { id: 'America/Chicago',     label: '(GMT-06:00) Chicago' },
  { id: 'America/Denver',      label: '(GMT-07:00) Denver' },
  { id: 'America/Los_Angeles', label: '(GMT-08:00) Los Angeles' },
];
const TIMEZONE_IDS = TIMEZONES.map(z => z.id);
const UNIT_SYSTEMS  = ['metric', 'imperial'];
const WEIGHT_UNITS  = ['kg', 'g', 'lb', 'oz'];

// Defaults preserve today's behaviour so applying the migration changes nothing
// until an admin actually edits a field.
const DEFAULTS = {
  [KEYS.storeName]:    'Halli Smiley',
  [KEYS.contactEmail]: process.env.EMAIL_FROM || 'hallismiley@gmail.com',
  [KEYS.phone]:        '',
  [KEYS.address1]:     '',
  [KEYS.address2]:     '',
  [KEYS.city]:         '',
  [KEYS.zip]:          '',
  [KEYS.country]:      'Iceland',
  [KEYS.unitSystem]:   'metric',
  [KEYS.weightUnit]:   'g',
  [KEYS.timezone]:     'Atlantic/Reykjavik',
  [KEYS.orderPrefix]:  '#',
  [KEYS.orderSuffix]:  '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class Setting {
  // Single value by key. Falls back to the baked-in default (or null) when no
  // row exists yet. pg parses JSONB columns to native JS values automatically.
  static async get(key) {
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (rows.length) return rows[0].value;
    return key in DEFAULTS ? DEFAULTS[key] : null;
  }

  // Map of { key: value } for the given keys, each falling back to its default.
  static async getMany(keys) {
    const { rows } = await db.query(
      'SELECT key, value FROM app_settings WHERE key = ANY($1)',
      [keys]
    );
    const byKey = new Map(rows.map(r => [r.key, r.value]));
    const out = {};
    for (const k of keys) {
      out[k] = byKey.has(k) ? byKey.get(k) : (k in DEFAULTS ? DEFAULTS[k] : null);
    }
    return out;
  }

  // Upsert one setting. `value` is any JSON-serialisable value; stored as JSONB.
  static async set(key, value) {
    const { rows } = await db.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING key, value`,
      [key, JSON.stringify(value)]
    );
    return rows[0];
  }

  // ── General settings group (typed + coerced) ───────────────────────────────
  // Store identity, store defaults, and the order-ID display format. Every value
  // is coerced to a safe type/enum here so a malformed DB row can't break the
  // formatters that consume these.
  static async getGeneralSettings() {
    const v = await this.getMany([
      KEYS.storeName, KEYS.contactEmail, KEYS.phone,
      KEYS.address1, KEYS.address2, KEYS.city, KEYS.zip, KEYS.country,
      KEYS.unitSystem, KEYS.weightUnit, KEYS.timezone,
      KEYS.orderPrefix, KEYS.orderSuffix,
    ]);
    const str   = (val) => (typeof val === 'string' ? val : '');
    const oneOf = (val, allowed, dflt) => (allowed.includes(val) ? val : dflt);
    return {
      // store_name underpins brand/title/sender — never let it read back empty.
      store_name:    (typeof v[KEYS.storeName] === 'string' && v[KEYS.storeName].trim())
                       ? v[KEYS.storeName] : DEFAULTS[KEYS.storeName],
      contact_email: str(v[KEYS.contactEmail]),
      phone:         str(v[KEYS.phone]),
      address1:      str(v[KEYS.address1]),
      address2:      str(v[KEYS.address2]),
      city:          str(v[KEYS.city]),
      zip:           str(v[KEYS.zip]),
      country:       str(v[KEYS.country]),
      unit_system:   oneOf(v[KEYS.unitSystem], UNIT_SYSTEMS, 'metric'),
      weight_unit:   oneOf(v[KEYS.weightUnit], WEIGHT_UNITS, 'g'),
      timezone:      oneOf(v[KEYS.timezone], TIMEZONE_IDS, 'Atlantic/Reykjavik'),
      order_prefix:  str(v[KEYS.orderPrefix]),
      order_suffix:  str(v[KEYS.orderSuffix]),
    };
  }

  // Partial update. Validates each supplied field and throws Error(message) on
  // bad input (the controller maps that to a 400). Request bodies are already
  // trimmed + tag-stripped by sanitizeBody, so these are length/enum/format
  // checks only. Returns the full, updated group so the caller can echo state.
  static async updateGeneralSettings(patch = {}) {
    if (patch == null || typeof patch !== 'object') {
      throw new Error('Invalid settings payload');
    }

    const textField = async (key, settingKey, { maxLen, required = false }) => {
      if (!(key in patch)) return;
      const val = patch[key];
      if (typeof val !== 'string') throw new Error(`${key} must be text`);
      if (required && val.trim() === '') throw new Error(`${key} is required`);
      if (val.length > maxLen) throw new Error(`${key} is too long (max ${maxLen} characters)`);
      await this.set(settingKey, val);
    };
    const enumField = async (key, settingKey, allowed) => {
      if (!(key in patch)) return;
      if (!allowed.includes(patch[key])) {
        throw new Error(`${key} must be one of ${allowed.join(', ')}`);
      }
      await this.set(settingKey, patch[key]);
    };

    await textField('store_name', KEYS.storeName, { maxLen: 100, required: true });
    if ('contact_email' in patch) {
      let e = patch.contact_email;
      if (typeof e !== 'string') throw new Error('contact_email must be a valid email or empty');
      e = e.trim();
      if (e !== '' && !EMAIL_RE.test(e)) {
        throw new Error('contact_email must be a valid email or empty');
      }
      await this.set(KEYS.contactEmail, e);
    }
    if ('phone' in patch) {
      const p = patch.phone;
      if (typeof p !== 'string' || !/^[+0-9 ()-]{0,32}$/.test(p)) {
        throw new Error('phone must be a valid phone number');
      }
      await this.set(KEYS.phone, p);
    }
    await textField('address1', KEYS.address1, { maxLen: 120 });
    await textField('address2', KEYS.address2, { maxLen: 120 });
    await textField('city',     KEYS.city,     { maxLen: 120 });
    await textField('zip',      KEYS.zip,      { maxLen: 16 });
    await textField('country',  KEYS.country,  { maxLen: 120 });
    await enumField('unit_system', KEYS.unitSystem, UNIT_SYSTEMS);
    await enumField('weight_unit', KEYS.weightUnit, WEIGHT_UNITS);
    await enumField('timezone',    KEYS.timezone,   TIMEZONE_IDS);
    await textField('order_prefix', KEYS.orderPrefix, { maxLen: 10 });
    await textField('order_suffix', KEYS.orderSuffix, { maxLen: 10 });

    return this.getGeneralSettings();
  }
}

Setting.KEYS = KEYS;
Setting.DEFAULTS = DEFAULTS;
Setting.TIMEZONES = TIMEZONES;
Setting.UNIT_SYSTEMS = UNIT_SYSTEMS;
Setting.WEIGHT_UNITS = WEIGHT_UNITS;
module.exports = Setting;
