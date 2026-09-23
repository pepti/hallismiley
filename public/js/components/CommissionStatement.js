// The statement drawer (migration 102; D-019). Lives in its own module so
// AdminCommissionView does not turn into AdminMarketView's twin — same drawer
// recipe as Markaður: role="dialog", ESC and backdrop close, focus returns to
// the row that opened it.
//
// Tokens only (invariant 15). A NEGATIVE closing balance renders as the
// company's claim in --error, never floored to zero: silently showing 0 is how
// a clawback gets lost.
import { escHtml } from '../utils/escHtml.js';
import { t } from '../i18n/i18n.js';
import { formatDate } from '../utils/format.js';
import { isk } from '../views/AdminAccountsView.js';

const STATUS_KEY = {
  open: 'commission.status.open',
  paid: 'commission.status.paid',
  carried: 'commission.status.carried',
  superseded: 'commission.status.superseded',
};
const STATUS_CLASS = {
  open: 'acct-chip--signed', paid: 'acct-chip--live',
  carried: 'acct-chip--paused', superseded: 'acct-chip--lead',
};
const LINE_KEY = {
  earned: 'commission.line.earned', clawback: 'commission.line.clawback',
  adjustment: 'commission.line.adjustment', payout: 'commission.line.payout',
};
const PAYEE_KEY = {
  contractor: 'commission.payee.contractor',
  employee: 'commission.payee.employee',
  internal: 'commission.payee.internal',
};
const label = (map, v) => (map[v] ? t(map[v]) : (v || '—'));

export function statusChip(status) {
  return `<span class="acct-chip ${STATUS_CLASS[status] || ''}">${escHtml(label(STATUS_KEY, status))}</span>`;
}

// A signed amount, coloured by direction. Money the company owes reads as
// success; money coming back reads as error.
function signed(n) {
  const v = Number(n || 0);
  const cls = v < 0 ? 'acct-amount--neg' : v > 0 ? 'acct-amount--pos' : '';
  return `<span class="${cls}">${escHtml(isk(v))}</span>`;
}

function figures(s) {
  const row = (key, value, strong = false) =>
    `<tr${strong ? ' class="acct-total"' : ''}><td>${escHtml(t(key))}</td><td class="num">${value}</td></tr>`;
  return `<table class="admin-table acct-table acct-figures"><tbody>
    ${row('commission.statement.opening', signed(s.opening_balance_isk))}
    ${row('commission.statement.earned', signed(s.earned_isk))}
    ${row('commission.statement.clawback', signed(-Number(s.clawback_isk || 0)))}
    ${row('commission.statement.adjust', signed(s.adjustment_isk))}
    ${row('commission.statement.settled', signed(-Number(s.settled_isk || 0)))}
    ${row('commission.statement.closing', signed(s.closing_balance_isk), true)}
    ${row('commission.statement.payable', escHtml(isk(s.payable_isk)), true)}
    ${row('commission.statement.carried', signed(s.carried_isk))}
  </tbody></table>`;
}

export function drawerHtml({ statement, lines = [], payouts = [], status, canPay }) {
  const s = statement;
  const negative = Number(s.closing_balance_isk) < 0;
  return `
    <h2 id="commission-drawer-title" class="markadur-drawer__title">
      ${escHtml(s.seller_name)} · ${escHtml(String(s.period).slice(0, 7))}
    </h2>
    <p class="markadur-drawer__muted">
      ${statusChip(status)} · ${escHtml(label(PAYEE_KEY, s.payee_kind))}
      ${s.payee_kennitala ? ` · ${escHtml(s.payee_kennitala)}` : ''}
    </p>

    ${negative ? `<p class="acct-notice acct-notice--warn">${escHtml(t('commission.balance.negative'))}</p>` : ''}

    ${figures(s)}

    <h3 class="markadur-drawer__h">${escHtml(t('commission.statement.lines'))}</h3>
    ${lines.length ? `<table class="admin-table acct-table"><tbody>${lines.map(l => `<tr>
      <td>${escHtml(label(LINE_KEY, l.line_kind))}</td>
      <td>${escHtml(l.account_name || l.description || '')}${l.invoice_number ? ` · #${escHtml(l.invoice_number)}` : ''}</td>
      <td class="num">${signed(l.amount_isk)}</td>
    </tr>`).join('')}</tbody></table>` : `<p class="markadur-drawer__muted">—</p>`}

    <h3 class="markadur-drawer__h">${escHtml(t('commission.payout.history'))}</h3>
    ${payouts.length ? `<table class="admin-table acct-table"><tbody>${payouts.map(p => `<tr>
      <td>${escHtml(formatDate(p.paid_on))}</td>
      <td>${escHtml(t(`commission.payout.method.${p.method === 'bank_transfer' ? 'bank' : p.method}`))}</td>
      <td>${escHtml(p.seller_invoice_number || '')}</td>
      <td class="num">${escHtml(isk(p.amount_isk))}</td>
    </tr>`).join('')}</tbody></table>` : `<p class="markadur-drawer__muted">${escHtml(t('commission.payout.none'))}</p>`}

    ${canPay && status === 'open' ? `
    <h3 class="markadur-drawer__h">${escHtml(t('commission.payout.record'))}</h3>
    <form id="commission-payout-form" class="acct-inline" novalidate>
      <div class="acct-grid">
        <label class="acct-field"><span>${escHtml(t('commission.payout.amount'))}</span>
          <input name="amount_isk" type="number" min="1" step="1"
                 value="${escHtml(String(Number(s.payable_isk) - Number(s.amount_paid_isk)))}" required></label>
        <label class="acct-field"><span>${escHtml(t('commission.payout.vat'))}</span>
          <input name="seller_vat_isk" type="number" min="0" step="1" value="0"></label>
        <label class="acct-field"><span>${escHtml(t('commission.payout.paidOn'))}</span>
          <input name="paid_on" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
        <label class="acct-field"><span>${escHtml(t('commission.payout.method'))}</span>
          <select name="method">
            <option value="bank_transfer"${s.payee_kind === 'employee' ? '' : ' selected'}>${escHtml(t('commission.payout.method.bank'))}</option>
            <option value="payroll"${s.payee_kind === 'employee' ? ' selected' : ''}>${escHtml(t('commission.payout.method.payroll'))}</option>
            <option value="other">${escHtml(t('commission.payout.method.other'))}</option>
          </select></label>
        <label class="acct-field"><span>${escHtml(t('commission.payout.sellerInvoice'))}</span>
          <input name="seller_invoice_number" type="text" maxlength="40"></label>
        <label class="acct-field"><span>${escHtml(t('commission.payout.reference'))}</span>
          <input name="reference" type="text" maxlength="100"></label>
      </div>
      <p class="acct-group__help">${escHtml(t('commission.payout.vatHelp'))}</p>
      <p class="admin-shop__error" id="commission-payout-error" role="alert"></p>
      <button type="submit" class="btn btn--primary btn--sm">${escHtml(t('commission.payout.record'))}</button>
    </form>` : ''}
  `;
}

export { STATUS_KEY, PAYEE_KEY };
