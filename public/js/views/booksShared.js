// Shared pieces for the Bókhald screens.
//
// Note on escaping: t() does NOT escape its output, so any translated string that
// lands inside an HTML attribute must go through escHtml() at the interpolation
// site. Getting this wrong is currently harmless (the locale files are static
// JSON), but this app auto-translates admin-editable content, so a books label
// resolved from the database later would become stored XSS with attribute
// breakout. escHtml(t(...)) is the house rule here.
import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';

// ISK has no subunit. Formatted with the Icelandic thousands separator and " kr."
// so the numbers read the way they do on a bank statement.
export function isk(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${digits} kr.`;
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
export function readinessBanner(readiness) {
  if (!readiness) return '';
  const warnings = [];
  if (!readiness.seller_complete) {
    warnings.push(t('adminBooks.warn.sellerIncomplete'));
  }
  if (!readiness.coa_confirmed_at) {
    warnings.push(t('adminBooks.warn.coaUnconfirmed'));
  }
  if (readiness.fx && !readiness.fx.ok) {
    warnings.push(readiness.fx.has_rate
      ? t('adminBooks.warn.fxStale', { days: readiness.fx.stale_days })
      : t('adminBooks.warn.fxMissing'));
  }
  if (!warnings.length) return '';
  return `
    <div class="books-banner books-banner--warn" role="status">
      <strong>${escHtml(t('adminBooks.warn.title'))}</strong>
      <ul>${warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul>
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
