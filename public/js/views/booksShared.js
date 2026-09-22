// Shared pieces for the Bókhald screens.
//
// Note on escaping: t() does NOT escape its output, so any translated string that
// lands inside an HTML attribute must go through escHtml() at the interpolation
// site. Getting this wrong is currently harmless (the locale files are static
// JSON), but this app auto-translates admin-editable content, so a books label
// resolved from the database later would become stored XSS with attribute
// breakout. escHtml(t(...)) is the house rule here.
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { formatMoney } from '../services/cart.js';

// ISK amounts, formatted the same way as everywhere else in the app. Delegates to
// the shop's formatter rather than carrying a third implementation — the books are
// ISK-only, so the currency is fixed here.
export function isk(amount) {
  return formatMoney(Math.round(Number(amount) || 0), 'ISK');
}

// A derived status, never a stored one — see server/models/Invoice.js.
const STATUS_TONE = {
  draft: 'muted',
  issued: 'info',
  part_paid: 'info',
  paid: 'ok',
  overdue: 'warn',
  credited: 'muted',
  cancelled: 'muted',
};

export function statusPill(displayStatus) {
  const key = String(displayStatus || 'issued');
  const tone = STATUS_TONE[key] || 'muted';
  const label = t(`adminBooks.status.${key}`);
  return `<span class="books-pill books-pill--${escHtml(tone)}">${escHtml(label)}</span>`;
}

/**
 * Standing setup warnings, rendered above every books screen.
 *
 * These exist because the two most likely first-run failures — no seller kennitala
 * and no exchange rate — both surface as a refused invoice at the worst possible
 * moment. Showing them up front turns a blocked action into a to-do item.
 */
export function readinessBanner(readiness, { fixHref = href('/admin/books/settings') } = {}) {
  if (!readiness) return '';
  const warnings = [];
  if (!readiness.seller_complete) {
    warnings.push(t('adminBooks.warn.sellerIncomplete'));
  }
  if (!readiness.coa_confirmed_at) {
    warnings.push(t('adminBooks.warn.coaUnconfirmed'));
  }
  // One row per currency the books actually use (server ≥ this release); an older
  // server sends only the EUR check as `fx`. Either way, warn per currency by name
  // — the banner used to say "EUR" no matter which rate was actually missing.
  const fx = Array.isArray(readiness.fx_currencies)
    ? readiness.fx_currencies
    : (readiness.fx ? [readiness.fx] : []);
  for (const f of fx) {
    if (!f || f.ok) continue;
    warnings.push(f.has_rate
      ? t('adminBooks.warn.fxStale', { currency: f.currency, days: f.stale_days })
      : t('adminBooks.warn.fxMissing', { currency: f.currency }));
  }
  if (!warnings.length) return '';
  // Every warning here is cleared on one screen, so the banner links to it —
  // a warning nobody can act on from where they see it is just noise.
  const fix = fixHref
    ? `<a class="btn btn--ghost" href="${escHtml(fixHref)}">${escHtml(t('adminBooks.warn.fix'))}</a>`
    : '';
  return `
    <div class="books-banner books-banner--warn" role="status">
      <strong>${escHtml(t('adminBooks.warn.title'))}</strong>
      <ul>${warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul>
      ${fix}
    </div>`;
}

// A labelled figure. `hint` explains what the number MEANS in plain language —
// the whole point of this module is that the owner is not an accountant, so a
// number without an explanation is a number that gets misread.
export function statTile({ label, value, hint = '', tone = '' }) {
  return `
    <div class="books-stat${tone ? ` books-stat--${escHtml(tone)}` : ''}">
      <div class="books-stat__label">${escHtml(label)}</div>
      <div class="books-stat__value">${escHtml(value)}</div>
      ${hint ? `<div class="books-stat__hint">${escHtml(hint)}</div>` : ''}
    </div>`;
}

export function errorBanner(message) {
  return `<div class="books-banner books-banner--error" role="alert">${escHtml(message)}</div>`;
}

// Percent in the form, decimal on the wire. Rates are published as percentages
// (Skatturinn's tables say 6.35%, 20%), so that is what a person types; asking
// for 0.0635 is how a units error gets made. One place for the conversion, so a
// field added later cannot get it the other way round. (AdminPayrollView carries
// its own copy from before this was shared — same code, same reasoning.)
export function pctToRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

export function rateToPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  // Trailing zeros stripped so 20 does not read as 20.0000.
  return String(Number((n * 100).toFixed(4)));
}

// Today and the year's first day, in ISO form, for date-input defaults. Local calendar
// components (not toISOString, which would shift a day at a positive UTC offset). Shared
// by the ledger and payroll screens rather than copied into each.
export function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}
