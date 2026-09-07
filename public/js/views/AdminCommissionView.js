// AdminCommissionView (/admin/commission) — Sölulaun: the seller's commission
// statement (migration 098; ENHANCEMENTS #18, D-003). Per seller per month:
// accrued (invoices issued) vs payable (invoices fully paid — commission is
// earned on receipt), then the events behind the numbers. A seller sees only
// their own rows; admin sees every seller. CSV of the events for the period.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { getCommission, commissionCsvUrl } from '../services/commission.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { isk } from './AdminAccountsView.js';

const KIND_KEY = { build: 'accounts.kind.build', recurring: 'accounts.kind.recurring' };

function yearRange() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export class AdminCommissionView {
  constructor() {
    this._el = null;
    this._range = yearRange();
    this._data = { rows: [], events: [], scope: 'own' };
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('commission')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-accounts admin-commission';
    this._el.innerHTML = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">${escHtml(t('commission.title'))}</h1>
          <p class="admin-shop__hint" id="commission-subtitle">${escHtml(t('commission.subtitle'))}</p>
        </div>
        <div class="admin-header__actions">
          <button type="button" class="btn btn--outline btn--sm" id="commission-csv">${escHtml(t('commission.exportCsv'))}</button>
        </div>
      </div>
      <form class="admin-toolbar acct-toolbar" id="commission-range">
        <label class="acct-field"><span>${escHtml(t('commission.from'))}</span><input type="date" name="from" value="${this._range.from}"></label>
        <label class="acct-field"><span>${escHtml(t('commission.to'))}</span><input type="date" name="to" value="${this._range.to}"></label>
        <button type="submit" class="btn btn--sm btn--outline">${escHtml(t('commission.apply'))}</button>
      </form>
      <div id="commission-summary"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
      <h2 class="mon-card__title acct-h2">${escHtml(t('commission.events'))}</h2>
      <div class="admin-table-wrap" id="commission-events"></div>
    `;
    this._el.querySelector('#commission-range').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      this._range = { from: String(fd.get('from') || ''), to: String(fd.get('to') || '') };
      this._load();
    });
    this._el.querySelector('#commission-csv').addEventListener('click', () => {
      window.location.href = commissionCsvUrl(this._range);
    });
    await this._load();
    return renderAdminShell({ activePath: '/admin/commission', content: this._el });
  }

  async _load() {
    const summary = this._el.querySelector('#commission-summary');
    const events = this._el.querySelector('#commission-events');
    try {
      this._data = await getCommission(this._range);
      this._el.querySelector('#commission-subtitle').textContent =
        this._data.scope === 'all' ? t('commission.subtitleAll') : t('commission.subtitle');
      const rows = this._data.rows || [];
      if (!rows.length) {
        summary.innerHTML = `<div class="empty-state"><div class="empty-state__icon">💸</div><p>${escHtml(t('commission.empty'))}</p></div>`;
      } else {
        const total = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
        summary.innerHTML = `<div class="admin-table-wrap"><table class="admin-table acct-table">
          <thead><tr>
            <th>${escHtml(t('commission.col.period'))}</th><th>${escHtml(t('commission.col.seller'))}</th>
            <th class="num">${escHtml(t('commission.col.events'))}</th>
            <th class="num">${escHtml(t('commission.col.build'))}</th><th class="num">${escHtml(t('commission.col.recurring'))}</th>
            <th class="num">${escHtml(t('commission.col.accrued'))}</th><th class="num">${escHtml(t('commission.col.payable'))}</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${escHtml(String(r.period).slice(0, 7))}</td><td>${escHtml(r.seller_name)}</td>
            <td class="num">${escHtml(String(r.events))}</td>
            <td class="num">${escHtml(isk(r.build_isk))}</td><td class="num">${escHtml(isk(r.recurring_isk))}</td>
            <td class="num">${escHtml(isk(r.accrued_isk))}</td><td class="num acct-strong">${escHtml(isk(r.payable_isk))}</td>
          </tr>`).join('')}
          <tr class="acct-total"><td colspan="3">${escHtml(t('commission.total'))}</td>
            <td class="num">${escHtml(isk(total('build_isk')))}</td><td class="num">${escHtml(isk(total('recurring_isk')))}</td>
            <td class="num">${escHtml(isk(total('accrued_isk')))}</td><td class="num acct-strong">${escHtml(isk(total('payable_isk')))}</td></tr>
          </tbody></table></div>`;
      }
      const evs = this._data.events || [];
      events.innerHTML = evs.length ? `<table class="admin-table acct-table"><thead><tr>
          <th>${escHtml(t('commission.col.period'))}</th><th>${escHtml(t('commission.col.seller'))}</th>
          <th>${escHtml(t('commission.col.account'))}</th><th>${escHtml(t('commission.col.kind'))}</th>
          <th>${escHtml(t('commission.col.invoice'))}</th>
          <th class="num">${escHtml(t('commission.col.base'))}</th><th class="num">${escHtml(t('commission.col.rate'))}</th>
          <th class="num">${escHtml(t('commission.col.amount'))}</th><th>${escHtml(t('commission.col.paid'))}</th>
        </tr></thead><tbody>${evs.map(e => `<tr>
          <td>${escHtml(String(e.period).slice(0, 7))}</td><td>${escHtml(e.seller_name)}</td>
          <td><a href="${href(`/admin/accounts/${e.account_id}`)}" data-route="/admin/accounts/${e.account_id}">${escHtml(e.account_name)}</a></td>
          <td>${escHtml(t(KIND_KEY[e.kind] || 'accounts.kind.build'))}</td>
          <td>#${escHtml(e.invoice_number)}</td>
          <td class="num">${escHtml(isk(e.base_amount_isk))}</td>
          <td class="num">${escHtml((Number(e.rate_bp) / 100).toFixed(1))} %</td>
          <td class="num">${escHtml(isk(e.amount_isk))}</td>
          <td>${e.invoice_paid ? `<span class="acct-chip acct-chip--live">${escHtml(t('commission.paid'))}</span>` : `<span class="acct-chip acct-chip--lead">${escHtml(t('commission.unpaid'))}</span>`}</td>
        </tr>`).join('')}</tbody></table>` : `<p class="markadur-drawer__muted">${escHtml(t('commission.noEvents'))}</p>`;
    } catch (err) {
      summary.innerHTML = `<p class="admin-error">${escHtml(err.message || t('commission.loadError'))}</p>`;
      events.innerHTML = '';
    }
  }
}
