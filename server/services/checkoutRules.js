'use strict';

// The checkout settings, ENFORCED (Admin → Afgreiðsla; ported from
// icelandicstore #151, harvest2-lane7a-2026-09-26).
//
// Every order-create path calls these, in this order, before it writes an
// order row:
//   1. orderingPausedResponse — the pause answers first, before any order work;
//   2. applyFieldRules        — hidden fields dropped, required ones present,
//                               a kennitala shape- and check-digit-valid;
//   3. minimumOrderResponse   — on the DB-trusted subtotal AFTER discounts.
// The engine has ONE order-create path today (shopController.createCheckout
// Session, the Stripe checkout); tests/unit/checkoutRulesCoverage.test.js fails
// when a second caller of Order.createWithItems appears without the pause
// guard. The SPA's banners and disabled buttons are UX only — this module is
// the gate (invariant 8).
//
// Deliberate differences from ice:
//   • the pause answers 503 (the harvest brief). ice answers 403 so an
//     intentional pause does not burn the 5xx error budget (docs/SLO.md counts
//     5xx) — flagged for Halli in the lane fragment; ORDERING_PAUSED_STATUS is
//     the one place to change it;
//   • the minimum is on the subtotal after discounts (ice: before), measured
//     in ISK whatever the charge currency (a EUR basket by its lines' ISK
//     prices, scaled by the same discount share);
//   • company and kennitala are VALIDATED but not stored: `orders` has no
//     column for either and this lane adds no migration (owed — see the
//     fragment). The admin page says so next to the two rules.

const { t } = require('../i18n');

const ORDERING_PAUSED_STATUS = 503;
const COMPANY_MAX = 200;

function fail(status, locale, key, params, reason) {
  return { status, body: { error: t(locale, key, params), code: status, reason } };
}

/** The pause, as a ready error envelope — or null when ordering is open. */
function orderingPausedResponse(checkout, locale) {
  if (!checkout || checkout.ordering_paused !== true) return null;
  const custom = checkout.ordering_paused_message && checkout.ordering_paused_message[locale === 'en' ? 'en' : 'is'];
  const msg = (typeof custom === 'string' && custom.trim()) ? custom.trim() : t(locale, 'errors.shop.orderingPaused');
  return { status: ORDERING_PAUSED_STATUS, body: { error: msg, code: ORDERING_PAUSED_STATUS, reason: 'ORDERING_PAUSED' } };
}

/**
 * Route middleware: the same pause, answered before the body validators
 * (shopRoutes POST /checkout), so a paused shop says "paused" to every
 * request, not a 400 about its postcode. The controller checks again — the
 * route guard is a convenience, the controller's check is the one the
 * coverage test pins.
 */
async function orderingPauseGate(req, res, next) {
  try {
    const Setting = require('../models/Setting'); // late: keeps the unit tier DB-free
    const paused = orderingPausedResponse(await Setting.getCheckoutSettings(), req.locale);
    if (paused) return res.status(paused.status).json(paused.body);
    return next();
  } catch (err) { return next(err); }
}

/** Digits only; '' when nothing was typed. */
function kennitalaDigits(raw) {
  return typeof raw === 'string' ? raw.replace(/[\s-]/g, '') : '';
}

/**
 * The field rules. `body` is the POSTed checkout; `address` the shipping
 * address the method needs (null for local pickup — the phone lives on the
 * address, so a required phone is asked only where there IS an address).
 * @returns {{ error: object } | { error: null, address: object|null,
 *   values: { company: string|null, kennitala: string|null, note: unknown } }}
 *   `address` comes back with `phone` cleared when the phone rule is hidden.
 */
function applyFieldRules({ checkout, body, address, locale }) {
  const f = checkout.fields;
  const b = body || {};

  // Phone — on the shipping address.
  let outAddress = address;
  if (address) {
    const phone = typeof address.phone === 'string' ? address.phone.trim() : '';
    if (f.phone === 'hidden') outAddress = { ...address, phone: null };
    else if (f.phone === 'required' && !phone) return { error: fail(400, locale, 'errors.shop.phoneRequired', null, 'FIELD_REQUIRED') };
  }

  // Company.
  let company = null;
  if (f.company !== 'hidden') {
    const c = typeof b.company === 'string' ? b.company.trim() : '';
    if (c.length > COMPANY_MAX) return { error: fail(400, locale, 'errors.shop.companyTooLong', { max: COMPANY_MAX }, 'FIELD_INVALID') };
    if (f.company === 'required' && !c) return { error: fail(400, locale, 'errors.shop.companyRequired', null, 'FIELD_REQUIRED') };
    company = c || null;
  }

  // Kennitala — IS format (10 digits, DDMMYY-NNNN) and its check digit.
  let kennitala = null;
  if (f.kennitala !== 'hidden') {
    const kt = kennitalaDigits(b.kennitala);
    // Late require: this module stays loadable in the DB-free unit tier.
    const { isValidKennitala } = require('../models/Setting');
    if (kt && (!/^\d{10}$/.test(kt) || !isValidKennitala(kt))) {
      return { error: fail(400, locale, 'errors.shop.kennitalaInvalid', null, 'FIELD_INVALID') };
    }
    if (f.kennitala === 'required' && !kt) return { error: fail(400, locale, 'errors.shop.kennitalaRequired', null, 'FIELD_REQUIRED') };
    kennitala = kt || null;
  }

  // Note — Order.normaliseNote trims and caps whatever passes here.
  let note = null;
  if (f.note !== 'hidden') {
    note = b.note;
    const blank = typeof note !== 'string' || !note.trim();
    if (f.note === 'required' && blank) return { error: fail(400, locale, 'errors.shop.noteRequired', null, 'FIELD_REQUIRED') };
  }

  return { error: null, address: outAddress, values: { company, kennitala, note } };
}

/**
 * The basket in ISK after discounts: the lines at their ISK prices, less the
 * order discount's SHARE of the charge-currency subtotal (exact for ISK).
 */
function iskNetAfterDiscount({ iskSubtotal, subtotal, discountAmount }) {
  const sub = Number(subtotal) || 0;
  const disc = Math.max(0, Math.min(Number(discountAmount) || 0, sub));
  if (sub <= 0) return 0;
  if (disc === 0) return Number(iskSubtotal) || 0;
  return Math.floor((Number(iskSubtotal) || 0) * (sub - disc) / sub);
}

/** The minimum order value, as a ready 400 envelope — or null when met. */
function minimumOrderResponse(checkout, iskNet, locale) {
  const min = Number(checkout && checkout.min_order_value_isk) || 0;
  if (min <= 0 || iskNet >= min) return null;
  const amount = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'is-IS').format(min);
  return {
    status: 400,
    body: {
      error: t(locale, 'errors.shop.minOrderValue', { amount }),
      code: 400, reason: 'MIN_ORDER_VALUE', params: { amount: min },
    },
  };
}

/**
 * Who the paid-order alert goes to: the admin list, else ORDER_NOTIFY_EMAIL
 * (comma-separated) from the env, else nobody.
 */
function ownerAlertRecipients(checkout) {
  const list = checkout && Array.isArray(checkout.order_notify_emails) ? checkout.order_notify_emails : [];
  if (list.length) return list;
  return String(process.env.ORDER_NOTIFY_EMAIL || '')
    .split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

module.exports = {
  ORDERING_PAUSED_STATUS,
  orderingPausedResponse,
  orderingPauseGate,
  applyFieldRules,
  iskNetAfterDiscount,
  minimumOrderResponse,
  ownerAlertRecipients,
};
