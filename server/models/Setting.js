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

  // Welcome-invite email template (admin "Send invites" editor). One JSONB blob
  // of per-locale OVERRIDES { en:{subject,heading,body}, is:{...} }; the default
  // copy stays in i18n (email.invite.*), so a missing field falls back at render.
  inviteEmail: 'invite_email',

  // Bookkeeping group — the seller identity that must appear on every invoice
  // (Reglugerð 50/1993), plus the handful of policy values the books need.
  //
  // These are read once when an invoice is CREATED and snapshotted onto it, never
  // re-read at PDF time. Rendering statutory content from live settings means
  // editing a setting silently reprints every historical invoice with different
  // legal content — an audit-trail break dressed up as a formatting change.
  bkSellerName:       'books.seller_name',
  bkSellerKennitala:  'books.seller_kennitala',
  bkSellerVatNumber:  'books.seller_vat_number',
  bkSellerAddress:    'books.seller_address',
  bkPaymentTermsDays: 'books.payment_terms_days',
  bkInvoiceNote:      'books.invoice_note',
  bkMunicipality:     'books.municipality',
  bkCorporateTaxRate: 'books.corporate_tax_rate',
  bkAccountantName:   'books.accountant_name',
  bkAccountantEmail:  'books.accountant_email',
  bkCoaConfirmedAt:   'books.coa_confirmed_at',
  // Who confirmed the chart of accounts and against what. A confirmation date on
  // its own silences the only warning that tracks ACCOUNTANT-QUESTIONS §1 — the
  // note is what makes it a statement someone signed rather than a click.
  bkCoaConfirmedBy:   'books.coa_confirmed_by',
  bkCoaConfirmedNote: 'books.coa_confirmed_note',
  // The seller's address as PARTS, plus Peppol addressing and bank details. The
  // free-text seller_address stays for the PDF; these are what a machine-readable
  // invoice (EN 16931 BG-5, BT-34, BT-84/86) needs, and migration 095 snapshots the
  // address parts onto every invoice at issue like the rest of the seller block.
  bkSellerStreet:         'books.seller_street',
  bkSellerCity:           'books.seller_city',
  bkSellerPostalZone:     'books.seller_postal_zone',
  bkSellerCountry:        'books.seller_country',
  bkSellerEndpointScheme: 'books.seller_endpoint_scheme',
  bkSellerEndpointId:     'books.seller_endpoint_id',
  bkSellerIban:           'books.seller_iban',
  bkSellerBic:            'books.seller_bic',
  // Change-request widget on PROD (admins only; a non-prod app-env always has
  // it on — see changeRequestGate in middleware/changeRequestGate.js, ice #206).
  changeRequestsEnabled: 'change_requests.enabled',
};

// Welcome-invite editable fields + per-locale limits. body allows the rich-text
// allowlist (sanitizeBody), subject/heading are tag-stripped to plain text.
const INVITE_LOCALES = ['en', 'is'];
const INVITE_FIELDS  = ['subject', 'heading', 'body'];
const INVITE_LIMITS  = { subject: 200, heading: 200, body: 4000 };

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

  // No invite-copy overrides by default — render falls back to the i18n strings.
  [KEYS.inviteEmail]: {},
  // Seller identity starts EMPTY on purpose. An invoice is not legally valid
  // without a real kennitala and VSK number, so the invoice service refuses to
  // issue until these are filled in — better a blocked first invoice than a
  // stack of invoices carrying a placeholder identity.
  [KEYS.bkSellerName]:       '',
  [KEYS.bkSellerKennitala]:  '',
  [KEYS.bkSellerVatNumber]:  '',
  [KEYS.bkSellerAddress]:    '',
  [KEYS.bkPaymentTermsDays]: 14,
  // Reglugerð 505/2013: an invoice printed from an electronic system in a single
  // copy has to say so, in place of the old pre-numbered-stationery requirement.
  [KEYS.bkInvoiceNote]:      'Þessi reikningur er rafrænt ytra frumgagn.',
  [KEYS.bkMunicipality]:     '',
  [KEYS.bkCorporateTaxRate]: 0.20,
  [KEYS.bkAccountantName]:   '',
  [KEYS.bkAccountantEmail]:  '',
  // Null until a human confirms the chart of accounts. The books dashboard shows
  // a standing warning while this is unset.
  [KEYS.bkCoaConfirmedAt]:   null,
  [KEYS.bkCoaConfirmedBy]:   '',
  [KEYS.bkCoaConfirmedNote]: '',
  [KEYS.bkSellerStreet]:         '',
  [KEYS.bkSellerCity]:           '',
  [KEYS.bkSellerPostalZone]:     '',
  [KEYS.bkSellerCountry]:        'IS',
  // ISO 6523 ICD 0196 — the Icelandic kennitala scheme on the Peppol EAS/ICD list.
  [KEYS.bkSellerEndpointScheme]: '0196',
  [KEYS.bkSellerEndpointId]:     '',
  [KEYS.bkSellerIban]:           '',
  [KEYS.bkSellerBic]:            '',
  [KEYS.changeRequestsEnabled]: false,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Icelandic kennitala: 10 digits, conventionally written DDMMYY-NNNN. Stored
// digits-only; the dash is presentation. This is a shape check, not a checksum —
// the modulus-11 check digit is validated in updateBookkeepingSettings.
const KENNITALA_RE = /^\d{10}$/;

// Validation failures the caller can act on and can safely be shown. Having a
// distinct type is what lets the controller return a 400 for these without
// blanket-stamping infrastructure errors as client mistakes and echoing pg
// internals to the browser.
class SettingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingValidationError';
    this.status = 400;
  }
}

class Setting {
  // Single value by key. Falls back to the baked-in default (or null) when no
  // row exists yet. pg parses JSONB columns to native JS values automatically.
  static async get(key) {
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (rows.length) return rows[0].value;
    return key in DEFAULTS ? DEFAULTS[key] : null;
  }

  // Map of { key: value } for the given keys, each falling back to its default.
  // `client` lets a caller inside a transaction read through ITS connection.
  // Reading via the pool while the caller holds a pool client and row locks is a
  // pool-exhaustion deadlock: with max=10, ten concurrent invoicings each hold a
  // client and then all wait for an eleventh that never comes.
  static async getMany(keys, client = db) {
    const { rows } = await client.query(
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

  // ── Welcome-invite template overrides (admin "Send invites" editor) ─────────
  // Returns ONLY the admin-saved overrides, per locale; any missing field falls
  // back to the i18n default (email.invite.*) at render time. Coerced so a
  // malformed DB row can't break the send/preview path.
  static async getInviteEmail() {
    const raw = await this.get(KEYS.inviteEmail);
    const out = {};
    for (const loc of INVITE_LOCALES) {
      const src = (raw && typeof raw === 'object' && raw[loc] && typeof raw[loc] === 'object') ? raw[loc] : {};
      const o = {};
      for (const f of INVITE_FIELDS) {
        if (typeof src[f] === 'string' && src[f].trim() !== '') o[f] = src[f];
      }
      out[loc] = o;
    }
    return out; // { en: { subject?, heading?, body? }, is: { ... } }
  }

  // Partial, per-locale update of the invite overrides. Validates types/lengths
  // and throws Error(message) on bad input (controller → 400). An empty string
  // CLEARS that field (falls back to the i18n default). Merges onto existing so
  // editing one locale leaves the other intact.
  static async updateInviteEmail(patch = {}) {
    if (patch == null || typeof patch !== 'object') throw new Error('Invalid invite template payload');
    const current = await this.get(KEYS.inviteEmail);
    const merged  = (current && typeof current === 'object') ? { ...current } : {};
    for (const loc of INVITE_LOCALES) {
      if (!(loc in patch)) continue;
      const incoming = patch[loc];
      if (incoming == null || typeof incoming !== 'object') throw new Error(`${loc} must be an object`);
      const next = { ...(merged[loc] && typeof merged[loc] === 'object' ? merged[loc] : {}) };
      for (const f of INVITE_FIELDS) {
        if (!(f in incoming)) continue;
        const val = incoming[f];
        if (typeof val !== 'string') throw new Error(`${loc}.${f} must be text`);
        if (val.length > INVITE_LIMITS[f]) throw new Error(`${loc}.${f} is too long (max ${INVITE_LIMITS[f]} characters)`);
        const trimmed = val.trim();
        if (trimmed === '') delete next[f]; // clear → fall back to default
        else next[f] = trimmed;
      }
      merged[loc] = next;
    }
    await this.set(KEYS.inviteEmail, merged);
    return this.getInviteEmail();
  }

  // ── Bookkeeping settings group ─────────────────────────────────────────────
  // The seller block that goes on every invoice, plus the policy values the books
  // read. Every value is coerced here so a malformed row cannot reach a statutory
  // document or a tax calculation.
  static async getBookkeepingSettings(client = db) {
    const v = await this.getMany([
      KEYS.bkSellerName, KEYS.bkSellerKennitala, KEYS.bkSellerVatNumber, KEYS.bkSellerAddress,
      KEYS.bkPaymentTermsDays, KEYS.bkInvoiceNote, KEYS.bkMunicipality,
      KEYS.bkCorporateTaxRate, KEYS.bkAccountantName, KEYS.bkAccountantEmail,
      KEYS.bkCoaConfirmedAt, KEYS.bkCoaConfirmedBy, KEYS.bkCoaConfirmedNote,
      KEYS.bkSellerStreet, KEYS.bkSellerCity, KEYS.bkSellerPostalZone, KEYS.bkSellerCountry,
      KEYS.bkSellerEndpointScheme, KEYS.bkSellerEndpointId, KEYS.bkSellerIban, KEYS.bkSellerBic,
    ], client);
    const str = (val, dflt = '') => (typeof val === 'string' ? val : dflt);
    const terms = Number(v[KEYS.bkPaymentTermsDays]);
    const taxRate = Number(v[KEYS.bkCorporateTaxRate]);
    const seller = {
      seller_name:      str(v[KEYS.bkSellerName]),
      seller_kennitala: str(v[KEYS.bkSellerKennitala]),
      seller_vat_number: str(v[KEYS.bkSellerVatNumber]),
      seller_address:   str(v[KEYS.bkSellerAddress]),
    };
    return {
      ...seller,
      payment_terms_days: Number.isInteger(terms) && terms >= 0 && terms <= 365
        ? terms : DEFAULTS[KEYS.bkPaymentTermsDays],
      invoice_note:       str(v[KEYS.bkInvoiceNote], DEFAULTS[KEYS.bkInvoiceNote]),
      municipality:       str(v[KEYS.bkMunicipality]),
      corporate_tax_rate: Number.isFinite(taxRate) && taxRate >= 0 && taxRate < 1
        ? taxRate : DEFAULTS[KEYS.bkCorporateTaxRate],
      accountant_name:    str(v[KEYS.bkAccountantName]),
      accountant_email:   str(v[KEYS.bkAccountantEmail]),
      coa_confirmed_at:   typeof v[KEYS.bkCoaConfirmedAt] === 'string' ? v[KEYS.bkCoaConfirmedAt] : null,
      coa_confirmed_by:   str(v[KEYS.bkCoaConfirmedBy]),
      coa_confirmed_note: str(v[KEYS.bkCoaConfirmedNote]),
      seller_street:          str(v[KEYS.bkSellerStreet]),
      seller_city:            str(v[KEYS.bkSellerCity]),
      seller_postal_zone:     str(v[KEYS.bkSellerPostalZone]),
      seller_country:         str(v[KEYS.bkSellerCountry], DEFAULTS[KEYS.bkSellerCountry]) || DEFAULTS[KEYS.bkSellerCountry],
      seller_endpoint_scheme: str(v[KEYS.bkSellerEndpointScheme], DEFAULTS[KEYS.bkSellerEndpointScheme]) || DEFAULTS[KEYS.bkSellerEndpointScheme],
      seller_endpoint_id:     str(v[KEYS.bkSellerEndpointId]),
      seller_iban:            str(v[KEYS.bkSellerIban]),
      seller_bic:             str(v[KEYS.bkSellerBic]),
      // Derived, and deliberately SEPARATE from seller_complete: invoices can be
      // issued on a name, kennitala and VSK number alone. Emitting a Peppol
      // BIS 3.0 document additionally needs the address as parts (BR-08/BR-09), and
      // making seller_complete stricter would stop a business invoicing because
      // its postal code is blank.
      peppol_complete: Boolean(
        seller.seller_name.trim() && seller.seller_kennitala.trim() && seller.seller_vat_number.trim()
        && str(v[KEYS.bkSellerStreet]).trim() && str(v[KEYS.bkSellerCity]).trim()
        && str(v[KEYS.bkSellerPostalZone]).trim()
      ),
      // Derived: whether invoices can legally be issued yet. The invoice service
      // checks this rather than duplicating the rule.
      seller_complete: Boolean(
        seller.seller_name.trim() && seller.seller_kennitala.trim() && seller.seller_vat_number.trim()
      ),
    };
  }

  // `confirmedBy` is stamped by the CONTROLLER from the session, never read from the
  // body — it is the answer to "who signed this", so the client does not get a say.
  static async updateBookkeepingSettings(patch = {}, { confirmedBy = '' } = {}) {
    const has = k => Object.prototype.hasOwnProperty.call(patch, k);

    const textField = async (field, key, { maxLen = 200, required = false } = {}) => {
      if (!has(field)) return;
      const raw = patch[field];
      if (typeof raw !== 'string') throw new SettingValidationError(`${field} must be a string`);
      const value = raw.trim();
      if (required && !value) throw new SettingValidationError(`${field} is required`);
      if (value.length > maxLen) throw new SettingValidationError(`${field} must be ${maxLen} characters or fewer`);
      await this.set(key, value);
    };

    await textField('seller_name', KEYS.bkSellerName, { maxLen: 200 });

    // Kennitala and VSK number are what make an invoice legally valid, so they get
    // real validation rather than a length check.
    if (has('seller_kennitala')) {
      const digits = String(patch.seller_kennitala || '').replace(/\D/g, '');
      if (digits && !KENNITALA_RE.test(digits)) {
        throw new SettingValidationError('seller_kennitala must be 10 digits');
      }
      if (digits && !isValidKennitala(digits)) {
        throw new SettingValidationError('seller_kennitala failed its check-digit validation — check for a typo');
      }
      await this.set(KEYS.bkSellerKennitala, digits);
    }
    if (has('seller_vat_number')) {
      // VSK numbers are 5 or 6 digits (RSK issues them sequentially).
      const digits = String(patch.seller_vat_number || '').replace(/\D/g, '');
      if (digits && !/^\d{5,6}$/.test(digits)) {
        throw new SettingValidationError('seller_vat_number must be 5 or 6 digits');
      }
      await this.set(KEYS.bkSellerVatNumber, digits);
    }

    await textField('seller_address', KEYS.bkSellerAddress, { maxLen: 400 });
    await textField('invoice_note', KEYS.bkInvoiceNote, { maxLen: 400 });
    await textField('municipality', KEYS.bkMunicipality, { maxLen: 120 });
    await textField('accountant_name', KEYS.bkAccountantName, { maxLen: 200 });

    // Address parts and Peppol addressing (EN 16931 BG-5 / BT-34 / BT-84 / BT-86).
    await textField('seller_street', KEYS.bkSellerStreet, { maxLen: 200 });
    await textField('seller_city', KEYS.bkSellerCity, { maxLen: 120 });
    await textField('seller_postal_zone', KEYS.bkSellerPostalZone, { maxLen: 20 });
    await textField('seller_endpoint_id', KEYS.bkSellerEndpointId, { maxLen: 50 });
    if (has('seller_country')) {
      const c = String(patch.seller_country || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(c)) throw new SettingValidationError('seller_country must be a two-letter ISO 3166-1 code (IS)');
      await this.set(KEYS.bkSellerCountry, c);
    }
    if (has('seller_endpoint_scheme')) {
      const s = String(patch.seller_endpoint_scheme || '').trim();
      if (!/^\d{4}$/.test(s)) throw new SettingValidationError('seller_endpoint_scheme must be a four-digit ISO 6523 ICD (0196 for a kennitala)');
      await this.set(KEYS.bkSellerEndpointScheme, s);
    }
    if (has('seller_iban')) {
      const iban = String(patch.seller_iban || '').replace(/\s+/g, '').toUpperCase();
      if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new SettingValidationError('seller_iban does not look like an IBAN');
      await this.set(KEYS.bkSellerIban, iban);
    }
    if (has('seller_bic')) {
      const bic = String(patch.seller_bic || '').replace(/\s+/g, '').toUpperCase();
      if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw new SettingValidationError('seller_bic must be an 8 or 11 character BIC');
      await this.set(KEYS.bkSellerBic, bic);
    }

    if (has('payment_terms_days')) {
      const n = Number(patch.payment_terms_days);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        throw new SettingValidationError('payment_terms_days must be a whole number of days between 0 and 365');
      }
      await this.set(KEYS.bkPaymentTermsDays, n);
    }
    if (has('corporate_tax_rate')) {
      const n = Number(patch.corporate_tax_rate);
      if (!Number.isFinite(n) || n < 0 || n >= 1) {
        throw new SettingValidationError('corporate_tax_rate must be a fraction between 0 and 1 (0.20 for 20%)');
      }
      await this.set(KEYS.bkCorporateTaxRate, n);
    }
    if (has('accountant_email')) {
      const e = String(patch.accountant_email || '').trim();
      if (e && !EMAIL_RE.test(e)) throw new SettingValidationError('accountant_email must be a valid email address');
      await this.set(KEYS.bkAccountantEmail, e);
    }
    if (has('coa_confirmed_at')) {
      const raw = patch.coa_confirmed_at;
      if (raw === null || raw === '') {
        // Revoking clears the whole claim, not just the date — a note with no
        // confirmation attached would read as one.
        await this.set(KEYS.bkCoaConfirmedAt, null);
        await this.set(KEYS.bkCoaConfirmedBy, '');
        await this.set(KEYS.bkCoaConfirmedNote, '');
      } else {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) throw new SettingValidationError('coa_confirmed_at must be a valid date');
        // "I checked these" is only worth something if it says against what —
        // the same rule payroll_rates.source_note enforces for the year's figures.
        // Confirming silences the only warning that tracks ACCOUNTANT-QUESTIONS §1.
        const note = typeof patch.coa_confirmed_note === 'string' ? patch.coa_confirmed_note.trim() : '';
        if (!note) {
          throw new SettingValidationError(
            'coa_confirmed_note is required when confirming the chart of accounts — say what was reviewed, and against what'
          );
        }
        if (note.length > 400) throw new SettingValidationError('coa_confirmed_note must be 400 characters or fewer');
        await this.set(KEYS.bkCoaConfirmedAt, d.toISOString().slice(0, 10));
        await this.set(KEYS.bkCoaConfirmedNote, note);
        await this.set(KEYS.bkCoaConfirmedBy, String(confirmedBy || '').trim().slice(0, 200));
      }
    }

    return this.getBookkeepingSettings();
  }

  // ── Change-request widget switch (Admin → Feedback) ────────────────────────
  static async getChangeRequestsEnabled() {
    return (await this.get(KEYS.changeRequestsEnabled)) === true;
  }

  static async setChangeRequestsEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false');
    await this.set(KEYS.changeRequestsEnabled, enabled);
    return enabled;
  }
}

// Icelandic kennitala check digit: weight the first 8 digits by 3,2,7,6,5,4,3,2,
// then the 9th digit must be 11 - (sum mod 11), with 11 mapping to 0. A remainder
// of 10 means the number is invalid. Catches transposed digits, which a plain
// length check does not — and a wrong kennitala on an invoice is a defect the
// customer inherits, since it breaks their input-VAT deduction.
function isValidKennitala(digits) {
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const remainder = sum % 11;
  if (remainder === 1) return false;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check === Number(digits[8]);
}

Setting.SettingValidationError = SettingValidationError;
Setting.KEYS = KEYS;
Setting.isValidKennitala = isValidKennitala;
Setting.DEFAULTS = DEFAULTS;
Setting.TIMEZONES = TIMEZONES;
Setting.UNIT_SYSTEMS = UNIT_SYSTEMS;
Setting.WEIGHT_UNITS = WEIGHT_UNITS;
module.exports = Setting;
