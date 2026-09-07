// AdminAccountDetailView (/admin/accounts/:id) — one customer account: facts
// and contact, the lifecycle (status transitions, provision request), the
// admin-only owner change and service-invoice issue (build deposit / final,
// a contract month, overage), the account's commission events and its audit
// trail. Scoped on the server: a foreign id is a 404 → back to the list.
import { isAuthenticated, canSeeView, isAdmin, adminGetUsers } from '../services/auth.js';
import {
  getAccount, updateAccount, changeAccountOwner, requestProvision,
  getAccountAudit, getAccountCommission, issueServiceInvoice,
} from '../services/accounts.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDateTime } from '../utils/format.js';
import { t, href } from '../i18n/i18n.js';
import { navigate, navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { TIER_KEY, STATUS_KEY, TIERS, statusChip, isk } from './AdminAccountsView.js';

const FIELDS = [
  ['name', 'accounts.field.name', 'text'],
  ['kennitala', 'accounts.field.kennitala', 'text'],
  ['contact_name', 'accounts.field.contactName', 'text'],
  ['contact_email', 'accounts.field.contactEmail', 'email'],
  ['contact_phone', 'accounts.field.contactPhone', 'text'],
  ['build_fee_isk', 'accounts.field.buildFee', 'number'],
  ['monthly_fee_isk', 'accounts.field.monthlyFee', 'number'],
  ['quota_units', 'accounts.field.quota', 'number'],
  ['contract_start', 'accounts.field.contractStart', 'date'],
  ['contract_end', 'accounts.field.contractEnd', 'date'],
  ['repo_name', 'accounts.field.repo', 'text'],
  ['test_url', 'accounts.field.testUrl', 'url'],
  ['prod_url', 'accounts.field.prodUrl', 'url'],
  ['canonical_host', 'accounts.field.canonicalHost', 'text'],
  ['azure_subscription_id', 'accounts.field.azureSubscription', 'text'],
  ['azure_rg_test', 'accounts.field.azureRgTest', 'text'],
  ['azure_rg_prod', 'accounts.field.azureRgProd', 'text'],
];
const RATE_FIELDS = [
  ['build_rate_bp', 'accounts.field.buildRate'],
  ['recurring_rate_bp', 'accounts.field.recurringRate'],
];
const KIND_KEY = { build: 'accounts.kind.build', recurring: 'accounts.kind.recurring' };
const AUDIT_KEY = {
  'account.created': 'accounts.audit.created',
  'account.updated': 'accounts.audit.updated',
  'account.status_changed': 'accounts.audit.statusChanged',
  'account.owner_changed': 'accounts.audit.ownerChanged',
  'provision.requested': 'accounts.audit.provisionRequested',
  'commission.recorded': 'accounts.audit.commissionRecorded',
};

// Unmapped enum values print themselves. Defaulting an unknown tier to "vefur"
// or an unknown kind to "build" would show a CONFIDENTLY WRONG label, and both
// of those drive money. Same shape as AdminMarketView's label().
const label = (map, v) => (map[v] ? t(map[v]) : (v || '—'));

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export class AdminAccountDetailView {
  constructor(id) {
    this._id = Number(id);
    this._el = null;
    this._account = null;
    this._transitions = [];
    this._destroyed = false;
  }

  // The router calls destroy() on navigation. _issue() navigates to the new
  // invoice while its two side panels are still loading, so without this the
  // late responses paint into a detached tree.
  destroy() {
    this._destroyed = true;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('accounts')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-accounts admin-account-detail';
    this._el.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    await this._load();
    return renderAdminShell({ activePath: '/admin/accounts', content: this._el });
  }

  async _load() {
    try {
      const { account, transitions } = await getAccount(this._id);
      if (this._destroyed) return;
      this._account = account;
      this._transitions = transitions || [];
      this._paint();
      // The two side panels load independently of the main card.
      this._loadCommission();
      this._loadAudit();
    } catch (err) {
      this._el.innerHTML = `<p class="admin-error">${escHtml(err.message || t('accounts.loadError'))}</p>
        <p><a href="${href('/admin/accounts')}" data-route="/admin/accounts">← ${escHtml(t('accounts.title'))}</a></p>`;
    }
  }

  _paint() {
    const a = this._account;
    const admin = isAdmin();
    const transitionBtns = this._transitions.map(s =>
      `<button type="button" class="btn btn--sm ${s === 'churned' ? 'btn--danger' : 'btn--outline'}" data-status="${s}">${escHtml(t(STATUS_KEY[s]))}</button>`).join('');
    const provisionBtn = (a.status === 'signed' || a.status === 'provisioning')
      ? `<button type="button" class="btn btn--sm btn--primary" id="acct-provision">${escHtml(t('accounts.requestProvision'))}</button>` : '';

    this._el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow"><a href="${href('/admin/accounts')}" data-route="/admin/accounts">${escHtml(t('accounts.title'))}</a></p>
          <h1 class="admin-title">${escHtml(a.name)}</h1>
          <p class="admin-shop__hint"><code>${escHtml(a.slug)}</code>${a.kennitala ? ` · ${escHtml(a.kennitala)}` : ''} · ${escHtml(label(TIER_KEY, a.tier))} · ${escHtml(t('accounts.col.owner'))}: ${escHtml(a.owner_name || '')}</p>
        </div>
        <div class="acct-status">${statusChip(a.status)}</div>
      </div>

      <section class="mon-card">
        <h2 class="mon-card__title">${escHtml(t('accounts.lifecycle'))}</h2>
        <p class="mon-card__help">${escHtml(t('accounts.lifecycleHelp'))}</p>
        <div class="acct-actions">${transitionBtns}${provisionBtn}</div>
      </section>

      <section class="mon-card">
        <h2 class="mon-card__title">${escHtml(t('accounts.details'))}</h2>
        <form id="acct-form" class="acct-form" novalidate>
          <div class="acct-grid">
            <label class="acct-field"><span>${escHtml(t('accounts.field.tier'))}</span>
              <select name="tier">${TIERS.map(x => `<option value="${x}" ${a.tier === x ? 'selected' : ''}>${escHtml(t(TIER_KEY[x]))}</option>`).join('')}</select>
            </label>
            ${FIELDS.map(([name, key, type]) => `<label class="acct-field"><span>${escHtml(t(key))}</span>
              <input name="${name}" type="${type}" value="${escHtml(a[name] == null ? '' : (type === 'date' ? String(a[name]).slice(0, 10) : a[name]))}" ${type === 'number' ? 'min="0" step="1"' : ''}>
            </label>`).join('')}
            ${admin ? RATE_FIELDS.map(([name, key]) => `<label class="acct-field"><span>${escHtml(t(key))}</span>
              <input name="${name}" type="number" min="0" max="10000" step="1" value="${escHtml(a[name] ?? '')}">
            </label>`).join('') : ''}
          </div>
          <label class="acct-field acct-field--wide"><span>${escHtml(t('accounts.field.notes'))}</span>
            <textarea name="notes" rows="4" maxlength="4000">${escHtml(a.notes || '')}</textarea>
          </label>
          <p class="admin-shop__error" id="acct-form-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="btn btn--primary">${escHtml(t('accounts.save'))}</button>
          </div>
        </form>
      </section>

      ${admin ? `
      <section class="mon-card">
        <h2 class="mon-card__title">${escHtml(t('accounts.ownerSection'))}</h2>
        <p class="mon-card__help">${escHtml(t('accounts.ownerHelp'))}</p>
        <div class="acct-inline" id="acct-owner"><span class="admin-loading">${escHtml(t('form.loading'))}</span></div>
      </section>

      <section class="mon-card">
        <h2 class="mon-card__title">${escHtml(t('accounts.invoiceSection'))}</h2>
        <p class="mon-card__help">${escHtml(t('accounts.invoiceHelp'))}</p>
        <form id="acct-invoice-form" class="acct-inline" novalidate>
          <label class="acct-field"><span>${escHtml(t('accounts.invoice.kind'))}</span>
            <select name="kind" id="acct-inv-kind">
              <option value="build-deposit">${escHtml(t('accounts.invoice.buildDeposit'))}</option>
              <option value="build-final">${escHtml(t('accounts.invoice.buildFinal'))}</option>
              <option value="recurring">${escHtml(t('accounts.invoice.recurring'))}</option>
              <option value="overage">${escHtml(t('accounts.invoice.overage'))}</option>
            </select>
          </label>
          <label class="acct-field" data-for="recurring"><span>${escHtml(t('accounts.invoice.period'))}</span>
            <input name="period" type="month" value="${thisMonth()}">
          </label>
          <label class="acct-field" data-for="recurring"><span>${escHtml(t('accounts.invoice.amountOverride'))}</span>
            <input name="amount_net_isk" type="number" min="1" step="1" placeholder="${escHtml(isk(a.monthly_fee_isk))}">
          </label>
          <label class="acct-field" data-for="overage"><span>${escHtml(t('accounts.invoice.units'))}</span>
            <input name="units" type="number" min="1" step="1">
          </label>
          <label class="acct-field" data-for="overage"><span>${escHtml(t('accounts.invoice.unitPrice'))}</span>
            <input name="unit_price_isk" type="number" min="1" step="1">
          </label>
          <button type="submit" class="btn btn--primary btn--sm">${escHtml(t('accounts.invoice.issue'))}</button>
          <p class="admin-shop__error" id="acct-invoice-error" role="alert"></p>
        </form>
      </section>` : ''}

      <section class="mon-card">
        <h2 class="mon-card__title">${escHtml(t('accounts.commissionSection'))}</h2>
        <div id="acct-commission"><span class="admin-loading">${escHtml(t('form.loading'))}</span></div>
      </section>

      <section class="mon-card">
        <h2 class="mon-card__title">${escHtml(t('accounts.auditSection'))}</h2>
        <div id="acct-audit"><span class="admin-loading">${escHtml(t('form.loading'))}</span></div>
      </section>
    `;

    this._el.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => this._transition(b.dataset.status)));
    this._el.querySelector('#acct-provision')?.addEventListener('click', () => this._provision());
    this._el.querySelector('#acct-form').addEventListener('submit', (e) => { e.preventDefault(); this._save(e.target); });
    if (admin) {
      this._paintOwner();
      const invForm = this._el.querySelector('#acct-invoice-form');
      const syncKind = () => {
        const kind = invForm.querySelector('#acct-inv-kind').value;
        invForm.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== kind; });
      };
      invForm.querySelector('#acct-inv-kind').addEventListener('change', syncKind);
      syncKind();
      invForm.addEventListener('submit', (e) => { e.preventDefault(); this._issue(invForm); });
    }
  }

  async _paintOwner() {
    const host = this._el.querySelector('#acct-owner');
    if (!host) return;
    let users = [];
    try { const d = await adminGetUsers({ limit: 100, sort: 'username', order: 'asc' }); users = Array.isArray(d) ? d : (d.users || []); } catch { /* no list → no select */ }
    host.innerHTML = `
      <label class="acct-field"><span>${escHtml(t('accounts.col.owner'))}</span>
        <select id="acct-owner-select">${users.map(u => `<option value="${escHtml(u.id)}" ${u.id === this._account.owner_user_id ? 'selected' : ''}>${escHtml(u.display_name || u.username)}</option>`).join('')}</select>
      </label>
      <button type="button" class="btn btn--sm btn--outline" id="acct-owner-save">${escHtml(t('accounts.changeOwner'))}</button>`;
    host.querySelector('#acct-owner-save').addEventListener('click', async () => {
      const ownerId = host.querySelector('#acct-owner-select').value;
      if (!ownerId || ownerId === this._account.owner_user_id) return;
      if (!confirm(t('accounts.changeOwnerConfirm'))) return;
      try {
        await changeAccountOwner(this._id, ownerId);
        showToast(t('accounts.saved'), 'success');
        await this._load();
      } catch (err) { showToast(err.message || t('accounts.saveError'), 'error'); }
    });
  }

  async _save(form) {
    const fd = new FormData(form);
    const body = {};
    for (const [k, v] of fd.entries()) body[k] = String(v).trim() === '' ? null : String(v).trim();
    const errEl = this._el.querySelector('#acct-form-error');
    errEl.textContent = '';
    try {
      const { account, transitions } = await updateAccount(this._id, body);
      this._account = account; this._transitions = transitions || [];
      showToast(t('accounts.saved'), 'success');
      // _paint() rebuilds the whole card, which empties BOTH side-panel hosts
      // — reloading only the audit trail left the commission panel blank.
      this._paint(); this._loadCommission(); this._loadAudit();
    } catch (err) {
      errEl.textContent = err.message || t('accounts.saveError');
    }
  }

  async _transition(status) {
    if (status === 'churned' && !confirm(t('accounts.churnConfirm'))) return;
    try {
      const { account, transitions } = await updateAccount(this._id, { status });
      this._account = account; this._transitions = transitions || [];
      showToast(t('accounts.saved'), 'success');
      // _paint() rebuilds the whole card, which empties BOTH side-panel hosts
      // — reloading only the audit trail left the commission panel blank.
      this._paint(); this._loadCommission(); this._loadAudit();
    } catch (err) { showToast(err.message || t('accounts.saveError'), 'error'); }
  }

  async _provision() {
    if (!confirm(t('accounts.requestProvisionConfirm'))) return;
    try {
      const { account } = await requestProvision(this._id);
      this._account = account;
      showToast(t('accounts.provisionRequested'), 'success');
      await this._load();
    } catch (err) { showToast(err.message || t('accounts.saveError'), 'error'); }
  }

  async _issue(form) {
    const fd = new FormData(form);
    const raw = fd.get('kind');
    const body = { account_id: this._id };
    if (raw === 'build-deposit') { body.kind = 'build'; body.deposit = true; }
    else if (raw === 'build-final') { body.kind = 'build'; body.deposit = false; }
    else if (raw === 'recurring') {
      body.kind = 'recurring'; body.period = String(fd.get('period') || '');
      const override = String(fd.get('amount_net_isk') || '').trim();
      if (override) body.amount_net_isk = Number(override);
    } else {
      body.kind = 'overage'; body.units = Number(fd.get('units')); body.unit_price_isk = Number(fd.get('unit_price_isk'));
    }
    const errEl = this._el.querySelector('#acct-invoice-error');
    errEl.textContent = '';
    if (!confirm(t('accounts.invoice.confirm'))) return;
    // A second click while the request is in flight issues a SECOND statutory
    // invoice, and 505/2013 says an invoice cannot be deleted, only credited.
    // The 099 unique indexes are the real backstop; this stops the common case.
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const { invoice } = await issueServiceInvoice(body);
      showToast(t('accounts.invoice.issued', { number: invoice.invoice_number }), 'success');
      this._loadCommission(); this._loadAudit();
      navigate(href(`/admin/books/invoices/${invoice.id}`));
    } catch (err) {
      errEl.textContent = err.message || t('accounts.saveError');
    } finally {
      if (submitBtn && !this._destroyed) submitBtn.disabled = false;
    }
  }

  async _loadCommission() {
    const host = this._el.querySelector('#acct-commission');
    if (!host) return;
    try {
      const { events } = await getAccountCommission(this._id);
      if (this._destroyed) return;
      if (!events.length) { host.innerHTML = `<p class="markadur-drawer__muted">${escHtml(t('accounts.commissionNone'))}</p>`; return; }
      host.innerHTML = `<table class="admin-table acct-table"><thead><tr>
          <th>${escHtml(t('commission.col.period'))}</th><th>${escHtml(t('commission.col.kind'))}</th>
          <th>${escHtml(t('commission.col.seller'))}</th><th>${escHtml(t('commission.col.invoice'))}</th>
          <th class="num">${escHtml(t('commission.col.base'))}</th><th class="num">${escHtml(t('commission.col.rate'))}</th>
          <th class="num">${escHtml(t('commission.col.amount'))}</th><th>${escHtml(t('commission.col.paid'))}</th>
        </tr></thead><tbody>${events.map(e => `<tr>
          <td>${escHtml(String(e.period).slice(0, 7))}</td>
          <td>${escHtml(label(KIND_KEY, e.kind))}</td>
          <td>${escHtml(e.seller_name)}</td>
          <td><a href="${href(`/admin/books/invoices/${e.invoice_id}`)}" data-route="/admin/books/invoices/${escHtml(e.invoice_id)}">#${escHtml(e.invoice_number)}</a></td>
          <td class="num">${escHtml(isk(e.base_amount_isk))}</td>
          <td class="num">${escHtml((Number(e.rate_bp) / 100).toFixed(1))} %</td>
          <td class="num">${escHtml(isk(e.amount_isk))}</td>
          <td>${e.invoice_paid ? `<span class="acct-chip acct-chip--live">${escHtml(t('commission.paid'))}</span>` : `<span class="acct-chip acct-chip--lead">${escHtml(t('commission.unpaid'))}</span>`}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch (err) {
      host.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  async _loadAudit() {
    const host = this._el.querySelector('#acct-audit');
    if (!host) return;
    try {
      const { entries } = await getAccountAudit(this._id);
      if (this._destroyed) return;
      if (!entries.length) { host.innerHTML = `<p class="markadur-drawer__muted">—</p>`; return; }
      host.innerHTML = `<ul class="acct-audit">${entries.map(e => {
        const s = e.summary || {};
        const detail = e.action === 'account.status_changed' ? `${escHtml(s.from)} → ${escHtml(s.to)}`
          : e.action === 'account.updated' ? escHtml((s.fields || []).join(', '))
          : e.action === 'commission.recorded' ? escHtml(`${isk(s.amount_isk)} · ${s.kind}`)
          : e.action === 'account.owner_changed' ? escHtml(`${s.from} → ${s.to}`) : '';
        return `<li><span class="acct-audit__when">${escHtml(formatDateTime(e.created_at))}</span>
          <span class="acct-audit__what">${escHtml(label(AUDIT_KEY, e.action))}</span>
          <span class="acct-audit__detail">${detail}</span>
          <span class="acct-audit__who">${escHtml(e.actor_username || '')}</span></li>`;
      }).join('')}</ul>`;
    } catch (err) {
      host.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }
}
