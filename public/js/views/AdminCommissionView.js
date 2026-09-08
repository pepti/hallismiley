// AdminCommissionView (/admin/commission) — Sölulaun: the seller's commission
// statement (migration 098; ENHANCEMENTS #18, D-003). Per seller per month:
// accrued (invoices issued) vs payable (invoices fully paid — commission is
// earned on receipt), then the events behind the numbers. A seller sees only
// their own rows; admin sees every seller. CSV of the events for the period.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  getCommission, commissionCsvUrl, getStatements, getStatement,
  previewStatement, createStatement, recordPayout,
} from '../services/commission.js';
import { drawerHtml, statusChip } from '../components/CommissionStatement.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk } from './AdminAccountsView.js';

const KIND_KEY = { build: 'accounts.kind.build', recurring: 'accounts.kind.recurring' };

// Unmapped enum values print themselves. Defaulting an unknown tier to "vefur"
// or an unknown kind to "build" would show a CONFIDENTLY WRONG label, and both
// of those drive money. Same shape as AdminMarketView's label().
const label = (map, v) => (map[v] ? t(map[v]) : (v || '—'));

function yearRange() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export class AdminCommissionView {
  constructor() {
    this._el = null;
    this._range = yearRange();
    this._data = { rows: [], events: [], scope: 'own', balances: [] };
    this._statements = [];
    this._drawer = null;
    this._returnFocus = null;
    this._onKey = (e) => { if (e.key === 'Escape') this._close(); };
    this._loadSeq = 0;
    this._destroyed = false;
  }

  // The router calls destroy() on navigation; the range select can leave a
  // request in flight behind us.
  destroy() {
    this._destroyed = true;
    this._close();
  }

  _close() {
    if (!this._drawer) return;
    const id = this._drawer.statementId;
    this._drawer.backdrop.remove();
    this._drawer.drawer.remove();
    this._drawer = null;
    document.removeEventListener('keydown', this._onKey);
    if (this._destroyed) return;
    // Re-find the row rather than reusing the node captured at open: a
    // payout repaints the table, so the captured <tr> is detached by then
    // and focus would silently drop to <body>.
    const row = id != null && this._el?.querySelector(`tr.acct-row[data-id="${id}"]`);
    (row || this._returnFocus)?.focus?.();
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
      <div id="commission-balances"></div>
      <div id="commission-summary"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
      <h2 class="mon-card__title acct-h2">${escHtml(t('commission.events'))}</h2>
      <div class="admin-table-wrap" id="commission-events"></div>

      <div class="admin-header acct-h2-row">
        <h2 class="mon-card__title acct-h2">${escHtml(t('commission.statements'))}</h2>
        ${isAdmin() ? `<button type="button" class="btn btn--sm btn--primary" id="commission-new">${escHtml(t('commission.statement.create'))}</button>` : ''}
      </div>
      <div class="admin-table-wrap" id="commission-statements"></div>
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
    this._el.querySelector('#commission-new')?.addEventListener('click', () => this._showCreate());
    // One delegated listener on a container that outlives every repaint.
    this._el.querySelector('#commission-statements').addEventListener('click', (e) => {
      const tr = e.target.closest('tr.acct-row');
      if (tr) this._open(Number(tr.dataset.id), tr);
    });
    await this._load();
    // The statements list loads independently of the accrual report.
    this._loadStatements();
    return renderAdminShell({ activePath: '/admin/commission', content: this._el });
  }

  async _load() {
    const summary = this._el.querySelector('#commission-summary');
    const events = this._el.querySelector('#commission-events');
    // Sequence guard — two range changes in a row must not paint out of order.
    const seq = ++this._loadSeq;
    try {
      const data = await getCommission(this._range);
      if (this._destroyed || seq !== this._loadSeq) return;
      this._data = data;
      this._paintBalances();
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
          <td>${escHtml(label(KIND_KEY, e.kind))}</td>
          <td>#${escHtml(e.invoice_number)}</td>
          <td class="num">${escHtml(isk(e.base_amount_isk))}</td>
          <td class="num">${escHtml((Number(e.rate_bp) / 100).toFixed(1))} %</td>
          <td class="num">${escHtml(isk(e.amount_isk))}</td>
          <td>${e.invoice_paid ? `<span class="acct-chip acct-chip--live">${escHtml(t('commission.paid'))}</span>` : `<span class="acct-chip acct-chip--lead">${escHtml(t('commission.unpaid'))}</span>`}</td>
        </tr>`).join('')}</tbody></table>` : `<p class="markadur-drawer__muted">${escHtml(t('commission.noEvents'))}</p>`;
    } catch (err) {
      if (this._destroyed || seq !== this._loadSeq) return;
      summary.innerHTML = `<p class="admin-error">${escHtml(err.message || t('commission.loadError'))}</p>`;
      events.innerHTML = '';
    }
  }

  // ── Settlement (migration 102; D-019) ──────────────────────────────────

  _paintBalances() {
    const host = this._el.querySelector('#commission-balances');
    const rows = this._data.balances || [];
    if (!rows.length) { host.innerHTML = ''; return; }
    const mine = this._data.scope !== 'all';
    host.innerHTML = `<section class="mon-card">
      <h2 class="mon-card__title">${escHtml(t(mine ? 'commission.balance.mine' : 'commission.balance.title'))}</h2>
      <table class="admin-table acct-table"><thead><tr>
        ${mine ? '' : `<th>${escHtml(t('commission.col.seller'))}</th>`}
        <th class="num">${escHtml(t('commission.col.accrued'))}</th>
        <th class="num">${escHtml(t('commission.col.payableNow'))}</th>
        <th class="num">${escHtml(t('commission.statement.settled'))}</th>
        <th class="num">${escHtml(t('commission.balance.balance'))}</th>
      </tr></thead><tbody>${rows.map(b => `<tr>
        ${mine ? '' : `<td>${escHtml(b.seller_name)}</td>`}
        <td class="num">${escHtml(isk(b.accrued_isk))}</td>
        <td class="num">${escHtml(isk(b.payable_isk))}</td>
        <td class="num">${escHtml(isk(b.settled_isk))}</td>
        <td class="num acct-strong ${Number(b.balance_isk) < 0 ? 'acct-amount--neg' : ''}">${escHtml(isk(b.balance_isk))}
          ${Number(b.balance_isk) < 0 ? `<span class="markadur-drawer__muted"> ${escHtml(t('commission.balance.negative'))}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table></section>`;
  }

  async _loadStatements() {
    const host = this._el.querySelector('#commission-statements');
    if (!host) return;
    try {
      const data = await getStatements();
      if (this._destroyed) return;
      this._statements = data.statements || [];
      this._paintStatements();
    } catch (err) {
      if (this._destroyed) return;
      host.innerHTML = `<p class="admin-error">${escHtml(err.message || t('commission.loadError'))}</p>`;
    }
  }

  _paintStatements() {
    const host = this._el.querySelector('#commission-statements');
    const rows = this._statements;
    if (!rows.length) {
      host.innerHTML = `<p class="markadur-drawer__muted">${escHtml(t('commission.statement.none'))}</p>`;
      return;
    }
    const all = this._data.scope === 'all';
    host.innerHTML = `<table class="admin-table acct-table"><thead><tr>
      <th>${escHtml(t('commission.statement.period'))}</th>
      ${all ? `<th>${escHtml(t('commission.col.seller'))}</th>` : ''}
      <th class="num">${escHtml(t('commission.statement.opening'))}</th>
      <th class="num">${escHtml(t('commission.statement.earned'))}</th>
      <th class="num">${escHtml(t('commission.statement.clawback'))}</th>
      <th class="num">${escHtml(t('commission.statement.closing'))}</th>
      <th class="num">${escHtml(t('commission.statement.payable'))}</th>
      <th>${escHtml(t('commission.col.status'))}</th>
    </tr></thead><tbody>${rows.map(r => `<tr class="acct-row" data-id="${r.id}" tabindex="0">
      <td>${escHtml(String(r.period).slice(0, 7))}</td>
      ${all ? `<td>${escHtml(r.seller_name)}</td>` : ''}
      <td class="num">${escHtml(isk(r.opening_balance_isk))}</td>
      <td class="num">${escHtml(isk(r.earned_isk))}</td>
      <td class="num ${Number(r.clawback_isk) > 0 ? 'acct-amount--neg' : ''}">${escHtml(isk(r.clawback_isk))}</td>
      <td class="num ${Number(r.closing_balance_isk) < 0 ? 'acct-amount--neg' : ''}">${escHtml(isk(r.closing_balance_isk))}</td>
      <td class="num acct-strong">${escHtml(isk(r.payable_isk))}</td>
      <td>${statusChip(r.status)}</td>
    </tr>`).join('')}</tbody></table>`;
    host.querySelectorAll('tr.acct-row').forEach(tr => {
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._open(Number(tr.dataset.id), tr); }
      });
    });
  }

  async _open(id, row) {
    this._close();
    this._returnFocus = row || null;
    let data;
    try {
      data = await getStatement(id);
    } catch (err) {
      showToast(err.message || t('commission.loadError'), 'error');
      return;
    }
    if (this._destroyed) return;
    const listRow = this._statements.find(s => Number(s.id) === Number(id));
    const backdrop = document.createElement('div');
    backdrop.className = 'markadur-backdrop';
    backdrop.addEventListener('click', () => this._close());
    const drawer = document.createElement('div');
    drawer.className = 'markadur-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'commission-drawer-title');
    drawer.innerHTML = `<button type="button" class="markadur-drawer__close" aria-label="${escHtml(t('markadur.close'))}">×</button>`
      + drawerHtml({
        statement: data.statement, lines: data.lines, payouts: data.payouts,
        status: listRow ? listRow.status : 'open', canPay: isAdmin(),
      });
    drawer.querySelector('.markadur-drawer__close').addEventListener('click', () => this._close());
    drawer.querySelector('#commission-payout-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._pay(id, e.target);
    });
    this._el.append(backdrop, drawer);
    this._drawer = { backdrop, drawer, statementId: id };
    document.addEventListener('keydown', this._onKey);
    drawer.querySelector('.markadur-drawer__close').focus();
  }

  async _pay(id, form) {
    const fd = new FormData(form);
    const errEl = form.querySelector('#commission-payout-error');
    errEl.textContent = '';
    // A second click must not pay twice. The idempotency key is the real
    // guarantee (the server dedupes on it); disabling the button stops the
    // common case before it becomes a round trip.
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await recordPayout(id, {
        amount_isk: Number(fd.get('amount_isk')),
        seller_vat_isk: Number(fd.get('seller_vat_isk') || 0),
        paid_on: String(fd.get('paid_on')),
        method: String(fd.get('method')),
        seller_invoice_number: String(fd.get('seller_invoice_number') || '') || null,
        reference: String(fd.get('reference') || ''),
        idempotency_key: `payout-${id}-${fd.get('paid_on')}-${fd.get('amount_isk')}`,
      });
      showToast(t('commission.payout.recorded'), 'success');
      this._close();
      await this._loadStatements();
      await this._load();
    } catch (err) {
      errEl.textContent = err.message || t('commission.payout.error');
    } finally {
      if (btn && !this._destroyed) btn.disabled = false;
    }
  }

  async _showCreate() {
    const sellers = (this._data.balances || []);
    if (!sellers.length) { showToast(t('commission.statement.noSellers'), 'error'); return; }
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const overlay = document.createElement('div');
    overlay.className = 'news-editor';
    overlay.id = 'commission-create-overlay';
    overlay.innerHTML = `<div class="news-editor__panel">
      <h2 class="news-editor__title">${escHtml(t('commission.statement.create'))}</h2>
      <form id="commission-create-form" novalidate>
        <div class="news-editor__row">
          <label class="news-editor__label">${escHtml(t('commission.col.seller'))}
            <select class="news-editor__input" name="seller_user_id">${sellers.map(b =>
    `<option value="${escHtml(b.seller_user_id)}">${escHtml(b.seller_name)}</option>`).join('')}</select>
          </label>
          <label class="news-editor__label">${escHtml(t('commission.statement.period'))}
            <input class="news-editor__input" name="period" type="month" value="${month}">
          </label>
        </div>
        <div id="commission-preview" class="acct-group__help"></div>
        <p class="admin-shop__error" id="commission-create-error" role="alert"></p>
        <div class="news-editor__actions">
          <button type="button" class="btn btn--outline btn--sm" id="commission-cancel">${escHtml(t('form.cancel'))}</button>
          <button type="button" class="btn btn--outline btn--sm" id="commission-preview-btn">${escHtml(t('commission.statement.preview'))}</button>
          <button type="submit" class="btn btn--primary btn--sm">${escHtml(t('commission.statement.issue'))}</button>
        </div>
      </form></div>`;
    this._el.append(overlay);
    const form = overlay.querySelector('#commission-create-form');
    const errEl = overlay.querySelector('#commission-create-error');
    const body = () => ({
      seller_user_id: String(new FormData(form).get('seller_user_id')),
      period: String(new FormData(form).get('period')),
    });
    overlay.querySelector('#commission-cancel').addEventListener('click', () => overlay.remove());
    // Preview first, always: the admin approves the same figures that get
    // written, and a preview writes nothing.
    overlay.querySelector('#commission-preview-btn').addEventListener('click', async () => {
      errEl.textContent = '';
      try {
        const { preview } = await previewStatement(body());
        overlay.querySelector('#commission-preview').innerHTML =
          `${escHtml(t('commission.statement.opening'))}: ${escHtml(isk(preview.opening_balance_isk))} · `
          + `${escHtml(t('commission.statement.earned'))}: ${escHtml(isk(preview.earned_isk))} · `
          + `${escHtml(t('commission.statement.clawback'))}: ${escHtml(isk(preview.clawback_isk))} · `
          + `${escHtml(t('commission.statement.payable'))}: ${escHtml(isk(preview.payable_isk))}`;
      } catch (err) { errEl.textContent = err.message || t('commission.loadError'); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await createStatement(body());
        showToast(t('commission.statement.issued'), 'success');
        overlay.remove();
        await this._loadStatements();
      } catch (err) {
        errEl.textContent = err.message || t('commission.loadError');
      } finally {
        if (btn && !this._destroyed) btn.disabled = false;
      }
    });
    overlay.querySelector('[name=seller_user_id]').focus();
  }
}
