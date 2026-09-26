// Minimal key-value application settings store. Each row is one setting: a
// stable string key + a JSONB value (so booleans, strings, and future
// structured values all fit without per-setting columns). Defaults live here so
// the app behaves correctly before any row has been written.
//
// Ported from the icelandicstore settings store, trimmed to what fits this
// (B2C) site: the generic get/set/getMany helpers plus the "general" group
// (store identity, address, store defaults, order-ID display). The store's
// wholesale-only customer-account group is omitted; its checkout rules,
// shipping price and site announcement arrived with harvest 2 lane 7a
// (2026-09-26). This table is also the intended home for feature flags that
// later phases introduce.
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

  // Checkout group (Admin → Verslun → Afgreiðsla; ported from icelandicstore
  // #151, harvest2-lane7a-2026-09-26). Every key is ENFORCED server-side on the
  // order path (services/checkoutRules.js): the pause answers before any order
  // work, the minimum reads the DB-trusted subtotal after discounts, the field
  // rules drop hidden values and refuse missing required ones, and the notify
  // list is who the paid-order alert goes to.
  checkoutOrderingPaused:        'checkout.ordering_paused',
  checkoutOrderingPausedMessage: 'checkout.ordering_paused_message',
  checkoutMinOrderValueIsk:      'checkout.min_order_value_isk',
  checkoutOrderNotifyEmails:     'checkout.order_notify_emails',
  checkoutFieldPhone:            'checkout.field_phone',
  checkoutFieldCompany:          'checkout.field_company',
  checkoutFieldKennitala:        'checkout.field_kennitala',
  checkoutFieldNote:             'checkout.field_note',

  // Shipping group — the delivery price, one source of truth for the order
  // total AND the cart/checkout display (config/shipping.js). ISK only: the EUR
  // flat rate stays env-only (SHIPPING_FLAT_RATE_EUR). free_over_isk = 0 = off.
  shippingFlatRateIsk: 'shipping.flat_rate_isk',
  shippingFreeOverIsk: 'shipping.free_over_isk',

  // Site announcement (Admin → Tilkynning; ported from icelandicstore #200).
  // The window is decided SERVER-side (utils/announcementWindow.js) and the
  // copy is withheld from the public endpoint outside it. Title/message/link
  // label are per-locale { en, is }; link_path is an optional in-site path.
  // The API field is `message`, not ice's `body`: sanitizeBody treats a key
  // named `body` as rich text and passes a nested { en, is } object through
  // UNSTRIPPED, so a plain-text field must not carry that name.
  announceEnabled:   'announcement.enabled',
  announceStartsAt:  'announcement.starts_at',
  announceEndsAt:    'announcement.ends_at',
  announceTitle:     'announcement.title',
  announceMessage:   'announcement.message',
  announceLinkPath:  'announcement.link_path',
  announceLinkLabel: 'announcement.link_label',
};

// ── Checkout / shipping / announcement bounds (harvest2-lane7a) ─────────────
const LOCALES = ['en', 'is'];
const FIELD_RULES = ['optional', 'required', 'hidden'];
// Checkout fields with no column on the order yet (the write-side refuses `required`).
const NOT_STORED_FIELDS = ['company', 'kennitala'];
const PAUSED_MSG_MAX_LEN = 300;
const ANNOUNCE_TITLE_MAX = 120;
const ANNOUNCE_MESSAGE_MAX = 600;
const ANNOUNCE_LABEL_MAX = 60;
const ANNOUNCE_PATH_MAX = 200;
const NOTIFY_MAX = 5;
// Every ISK amount setting is bounded by the same ceiling (100 million kr.).
const MAX_AMOUNT_ISK = 100000000;

// Non-negative whole-number env value, else the fallback. The shipping
// defaults read the env the price used to be frozen from, so an instance that
// set SHIPPING_FLAT_RATE_ISK keeps that price until an admin saves one.
function envAmount(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

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
  [KEYS.contactEmail]: process.env.EMAIL_FROM || 'info@orangesmiley.is',
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

  // Checkout defaults reproduce today's checkout exactly: ordering open, no
  // minimum, phone and note optional, company and kennitala not asked, and
  // no alert list (ORDER_NOTIFY_EMAIL, when set, is the fallback).
  [KEYS.checkoutOrderingPaused]:        false,
  [KEYS.checkoutOrderingPausedMessage]: {},
  [KEYS.checkoutMinOrderValueIsk]:      0,
  [KEYS.checkoutOrderNotifyEmails]:     [],
  [KEYS.checkoutFieldPhone]:            'optional',
  [KEYS.checkoutFieldCompany]:          'hidden',
  [KEYS.checkoutFieldKennitala]:        'hidden',
  [KEYS.checkoutFieldNote]:             'optional',
  // Env stays the fallback until an admin saves a value (DEPLOYMENT.md).
  [KEYS.shippingFlatRateIsk]: envAmount('SHIPPING_FLAT_RATE_ISK', 2500),
  [KEYS.shippingFreeOverIsk]: 0,
  // Off, no window, no copy: a fresh instance never shows an announcement.
  [KEYS.announceEnabled]:   false,
  [KEYS.announceStartsAt]:  '',
  [KEYS.announceEndsAt]:    '',
  [KEYS.announceTitle]:     {},
  [KEYS.announceMessage]:   {},
  [KEYS.announceLinkPath]:  '',
  [KEYS.announceLinkLabel]: {},
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

  // ── Checkout group (harvest2-lane7a; ported from icelandicstore #151) ──────
  // Read side never throws: a hand-edited row coerces back to its default, so
  // the order path and the public /shop/config can never be broken by data.
  // `client` lets the order path read through its own connection.
  static async getCheckoutSettings(client = db) {
    const v = await this.getMany([
      KEYS.checkoutOrderingPaused, KEYS.checkoutOrderingPausedMessage,
      KEYS.checkoutMinOrderValueIsk, KEYS.checkoutOrderNotifyEmails,
      KEYS.checkoutFieldPhone, KEYS.checkoutFieldCompany,
      KEYS.checkoutFieldKennitala, KEYS.checkoutFieldNote,
    ], client);
    const rule = (val, key) => (FIELD_RULES.includes(val) ? val : DEFAULTS[key]);
    return {
      ordering_paused:         v[KEYS.checkoutOrderingPaused] === true,
      ordering_paused_message: perLocale(v[KEYS.checkoutOrderingPausedMessage]),
      min_order_value_isk:     readAmount(v[KEYS.checkoutMinOrderValueIsk], 0),
      order_notify_emails:     Array.isArray(v[KEYS.checkoutOrderNotifyEmails])
        ? v[KEYS.checkoutOrderNotifyEmails].filter(e => typeof e === 'string' && EMAIL_RE.test(e)).slice(0, NOTIFY_MAX)
        : [],
      fields: {
        phone:     rule(v[KEYS.checkoutFieldPhone],     KEYS.checkoutFieldPhone),
        company:   rule(v[KEYS.checkoutFieldCompany],   KEYS.checkoutFieldCompany),
        kennitala: rule(v[KEYS.checkoutFieldKennitala], KEYS.checkoutFieldKennitala),
        note:      rule(v[KEYS.checkoutFieldNote],      KEYS.checkoutFieldNote),
      },
    };
  }

  // Validate a checkout patch → the [key, value] writes it implies; persists
  // nothing (so a PATCH carrying the checkout AND the shipping group is all or
  // nothing — the controller collects both, then applyWrites once).
  static async collectCheckoutWrites(patch = {}) {
    if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new SettingValidationError('Invalid settings payload');
    }
    const has = k => Object.prototype.hasOwnProperty.call(patch, k);
    // A typo ('min_order_value') must not save as a silent 200 that changed nothing.
    refuseUnknown(patch, ['ordering_paused', 'ordering_paused_message', 'min_order_value_isk', 'order_notify_emails', 'fields']);
    const writes = [];
    if (has('ordering_paused')) {
      if (typeof patch.ordering_paused !== 'boolean') throw new SettingValidationError('ordering_paused must be true or false');
      writes.push([KEYS.checkoutOrderingPaused, patch.ordering_paused]);
    }
    if (has('ordering_paused_message')) {
      writes.push([KEYS.checkoutOrderingPausedMessage, mergePerLocale(
        await this.get(KEYS.checkoutOrderingPausedMessage), patch.ordering_paused_message,
        'ordering_paused_message', PAUSED_MSG_MAX_LEN)]);
    }
    if (has('min_order_value_isk')) {
      writes.push([KEYS.checkoutMinOrderValueIsk, amountOrThrow('min_order_value_isk', patch.min_order_value_isk)]);
    }
    if (has('order_notify_emails')) {
      writes.push([KEYS.checkoutOrderNotifyEmails, emailListOrThrow('order_notify_emails', patch.order_notify_emails)]);
    }
    if (has('fields')) {
      const f = patch.fields;
      if (f == null || typeof f !== 'object' || Array.isArray(f)) throw new SettingValidationError('fields must be an object');
      const byField = {
        phone: KEYS.checkoutFieldPhone, company: KEYS.checkoutFieldCompany,
        kennitala: KEYS.checkoutFieldKennitala, note: KEYS.checkoutFieldNote,
      };
      for (const name of Object.keys(f)) {
        if (!byField[name]) throw new SettingValidationError(`fields.${name} is not a checkout field`);
        if (!FIELD_RULES.includes(f[name])) {
          throw new SettingValidationError(`fields.${name} must be one of ${FIELD_RULES.join(', ')}`);
        }
        // Company and kennitala are validated at checkout but NOT stored on the
        // order yet (no column — owed, harvest2-lane7a). Requiring a buyer to
        // type a national id that is then dropped is data collection with no
        // purpose, so `required` is refused until the storage lands; optional
        // stays (the brief), with the admin page saying it is not stored.
        if (NOT_STORED_FIELDS.includes(name) && f[name] === 'required') {
          throw new SettingValidationError(`fields.${name} cannot be required until it is stored on the order`);
        }
        writes.push([byField[name], f[name]]);
      }
    }
    return writes;
  }

  // ── Shipping group — the one source of the delivery price ──────────────────
  static async getShippingSettings(client = db) {
    const v = await this.getMany([KEYS.shippingFlatRateIsk, KEYS.shippingFreeOverIsk], client);
    return {
      flat_rate_isk: readAmount(v[KEYS.shippingFlatRateIsk], DEFAULTS[KEYS.shippingFlatRateIsk]),
      free_over_isk: readAmount(v[KEYS.shippingFreeOverIsk], 0), // 0 = no threshold
    };
  }

  static collectShippingWrites(patch = {}) {
    if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new SettingValidationError('shipping must be an object');
    }
    const has = k => Object.prototype.hasOwnProperty.call(patch, k);
    refuseUnknown(patch, ['flat_rate_isk', 'free_over_isk'], 'shipping.');
    const writes = [];
    if (has('flat_rate_isk')) writes.push([KEYS.shippingFlatRateIsk, amountOrThrow('shipping.flat_rate_isk', patch.flat_rate_isk)]);
    if (has('free_over_isk')) writes.push([KEYS.shippingFreeOverIsk, amountOrThrow('shipping.free_over_isk', patch.free_over_isk)]);
    return writes;
  }

  // ── Site announcement (harvest2-lane7a; ported from icelandicstore #200) ───
  static async getAnnouncementSettings() {
    const v = await this.getMany([
      KEYS.announceEnabled, KEYS.announceStartsAt, KEYS.announceEndsAt,
      KEYS.announceTitle, KEYS.announceMessage, KEYS.announceLinkPath, KEYS.announceLinkLabel,
    ]);
    const str = (val) => (typeof val === 'string' ? val : '');
    return {
      enabled:    v[KEYS.announceEnabled] === true,
      starts_at:  str(v[KEYS.announceStartsAt]),
      ends_at:    str(v[KEYS.announceEndsAt]),
      title:      perLocale(v[KEYS.announceTitle]),
      message:    perLocale(v[KEYS.announceMessage]),
      link_path:  isSitePath(v[KEYS.announceLinkPath]) ? v[KEYS.announceLinkPath] : '',
      link_label: perLocale(v[KEYS.announceLinkLabel]),
    };
  }

  static async collectAnnouncementWrites(patch = {}) {
    if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new SettingValidationError('Invalid settings payload');
    }
    const { parseLocalDateTime } = require('../utils/announcementWindow');
    const has = k => Object.prototype.hasOwnProperty.call(patch, k);
    refuseUnknown(patch, ['enabled', 'starts_at', 'ends_at', 'title', 'message', 'link_path', 'link_label']);
    const current = await this.getAnnouncementSettings();
    const next = { ...current };
    const writes = [];

    if (has('enabled')) {
      if (typeof patch.enabled !== 'boolean') throw new SettingValidationError('enabled must be true or false');
      next.enabled = patch.enabled;
      writes.push([KEYS.announceEnabled, patch.enabled]);
    }
    for (const [field, key] of [['starts_at', KEYS.announceStartsAt], ['ends_at', KEYS.announceEndsAt]]) {
      if (!has(field)) continue;
      const raw = patch[field];
      if (typeof raw !== 'string') throw new SettingValidationError(`${field} must be a date and time (YYYY-MM-DDTHH:mm) or empty`);
      const val = raw.trim();
      if (val && parseLocalDateTime(val) === null) {
        throw new SettingValidationError(`${field} must be a valid date and time (YYYY-MM-DDTHH:mm)`);
      }
      next[field] = val;
      writes.push([key, val]);
    }
    // Half-open [start, end): an equal or inverted pair would never show, and
    // the admin would blame the code. Checked against the stored side too.
    if (next.starts_at && next.ends_at
        && parseLocalDateTime(next.starts_at) >= parseLocalDateTime(next.ends_at)) {
      throw new SettingValidationError('starts_at must be before ends_at');
    }
    for (const [field, key, max] of [
      ['title', KEYS.announceTitle, ANNOUNCE_TITLE_MAX],
      ['message', KEYS.announceMessage, ANNOUNCE_MESSAGE_MAX],
      ['link_label', KEYS.announceLinkLabel, ANNOUNCE_LABEL_MAX],
    ]) {
      if (!has(field)) continue;
      const merged = mergePerLocale(current[field], patch[field], field, max);
      next[field] = perLocale(merged);
      writes.push([key, merged]);
    }
    if (has('link_path')) {
      const p = typeof patch.link_path === 'string' ? patch.link_path.trim() : null;
      if (p === null || (p !== '' && !isSitePath(p))) {
        throw new SettingValidationError('link_path must be a path on this site, starting with / (e.g. /hafa-samband)');
      }
      next.link_path = p;
      writes.push([KEYS.announceLinkPath, p]);
    }
    // Switched on with nothing to say would open an empty dialog.
    if (next.enabled && !LOCALES.some(l => next.title[l])) {
      throw new SettingValidationError('title is required (in at least one language) to switch the announcement on');
    }
    return writes;
  }

  static async updateAnnouncementSettings(patch = {}) {
    await this.applyWrites(await this.collectAnnouncementWrites(patch));
    return this.getAnnouncementSettings();
  }

  // Persist a validated write list in ONE transaction: a multi-key save either
  // lands whole or not at all (the ordering pause never half-applies).
  static async applyWrites(writes) {
    if (!writes.length) return;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of writes) {
        await client.query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, JSON.stringify(value)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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

// ── Helpers for the checkout / shipping / announcement groups ────────────────

// { en, is } of strings from whatever is stored ('' where absent).
function perLocale(raw) {
  const out = {};
  for (const loc of LOCALES) {
    out[loc] = (raw && typeof raw === 'object' && typeof raw[loc] === 'string') ? raw[loc] : '';
  }
  return out;
}

// Merge an incoming per-locale patch onto the stored object: a locale left out
// keeps its text, '' clears it. Plain text, capped.
function mergePerLocale(current, incoming, field, maxLen) {
  if (incoming == null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new SettingValidationError(`${field} must be an object of per-language texts ({ en, is })`);
  }
  const merged = perLocale(current);
  for (const loc of Object.keys(incoming)) {
    if (!LOCALES.includes(loc)) throw new SettingValidationError(`${field}.${loc} is not a supported language`);
    const val = incoming[loc];
    if (typeof val !== 'string') throw new SettingValidationError(`${field}.${loc} must be text`);
    if (val.length > maxLen) throw new SettingValidationError(`${field}.${loc} is too long (max ${maxLen} characters)`);
    merged[loc] = val.trim();
  }
  return merged;
}

// A patch key the group does not know is a 400, never a silent no-op.
function refuseUnknown(patch, allowed, prefix = '') {
  for (const k of Object.keys(patch)) {
    if (!allowed.includes(k)) throw new SettingValidationError(`${prefix}${k} is not a setting here`);
  }
}

// Read side: a whole ISK amount in range, else the fallback.
function readAmount(val, fallback) {
  return Number.isInteger(val) && val >= 0 && val <= MAX_AMOUNT_ISK ? val : fallback;
}

// Write side: a JSON number or a digits-only string, whole, 0..MAX. Strict on
// purpose — Number(null), Number('') and Number(false) are all 0, and a
// minimum or a shipping price silently reset to 0 is a money bug.
function amountOrThrow(field, val) {
  const n = typeof val === 'number' ? val
    : (typeof val === 'string' && /^\d{1,9}$/.test(val.trim()) ? Number(val.trim()) : NaN);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT_ISK) {
    throw new SettingValidationError(`${field} must be a whole number of krónur between 0 and ${MAX_AMOUNT_ISK}`);
  }
  return n;
}

// The owner alert list: an array of addresses, or one string separated by
// commas, semicolons or whitespace. Lower-cased, de-duplicated, each checked,
// at most NOTIFY_MAX. [] (or '') clears it.
function emailListOrThrow(field, val) {
  let items;
  if (Array.isArray(val)) items = val;
  else if (typeof val === 'string') items = val.split(/[\s,;]+/);
  else throw new SettingValidationError(`${field} must be a list of email addresses`);
  const out = [];
  for (const raw of items) {
    if (typeof raw !== 'string') throw new SettingValidationError(`${field} must be a list of email addresses`);
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e.length > 254 || !EMAIL_RE.test(e)) throw new SettingValidationError(`${field}: "${e.slice(0, 60)}" is not a valid email address`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > NOTIFY_MAX) throw new SettingValidationError(`${field} takes at most ${NOTIFY_MAX} addresses`);
  return out;
}

// An in-site path the announcement may link to: starts with ONE '/', no
// scheme, no backslash, no whitespace. The client prefixes the locale.
function isSitePath(p) {
  return typeof p === 'string' && p.length <= ANNOUNCE_PATH_MAX
    && /^\/(?![/\\])[A-Za-z0-9\-._~/%?=&#]*$/.test(p);
}

Setting.SettingValidationError = SettingValidationError;
Setting.FIELD_RULES = FIELD_RULES;
Setting.MAX_AMOUNT_ISK = MAX_AMOUNT_ISK;
Setting.KEYS = KEYS;
Setting.isValidKennitala = isValidKennitala;
Setting.DEFAULTS = DEFAULTS;
Setting.TIMEZONES = TIMEZONES;
Setting.UNIT_SYSTEMS = UNIT_SYSTEMS;
Setting.WEIGHT_UNITS = WEIGHT_UNITS;
module.exports = Setting;
