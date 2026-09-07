// AdminAccountsView (/admin/accounts) — Viðskiptareikningar, the customer
// account register (migration 098; ENHANCEMENTS #17). A seller sees only the
// accounts they own (the server scopes the rows); admin and the `allaccounts`
// permission see every account. Row → /admin/accounts/:id.
//
// Structural model: AdminLeadsView. Tokens only (invariant 15).
import { isAuthenticated, canSeeView, isAdmin, adminGetUsers } from '../services/auth.js';
import { getAccounts, createAccount } from '../services/accounts.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDate } from '../utils/format.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { navigate, navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const PAGE_SIZE = 50;

// Literal keys so check:i18n can see every label.
export const TIER_KEY = { vefur: 'accounts.tier.vefur', verslun: 'accounts.tier.verslun', rekstur: 'accounts.tier.rekstur' };
export const STATUS_KEY = {
  lead: 'accounts.status.lead', offered: 'accounts.status.offered', signed: 'accounts.status.signed',
  provisioning: 'accounts.status.provisioning', building: 'accounts.status.building',
  live: 'accounts.status.live', paused: 'accounts.status.paused', churned: 'accounts.status.churned',
};
export const STATUSES = Object.keys(STATUS_KEY);
export const TIERS = Object.keys(TIER_KEY);

export function statusChip(status) {
  return `<span class="acct-chip acct-chip--${escHtml(status)}">${escHtml(STATUS_KEY[status] ? t(STATUS_KEY[status]) : status)}</span>`;
}
export function isk(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(getLocale() === 'en' ? 'en-GB' : 'is-IS', { maximumFractionDigits: 0 }).format(n) + ' kr.';
}

export class AdminAccountsView {
  constructor() {
    this._el = null;
    this._status = '';
    this._q = '';
    this._page = 1;
    this._data = { accounts: [], total: 0, scope: 'own' };
    this._searchDebounce = null;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('accounts')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-accounts';
    this._el.innerHTML = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">${escHtml(t('accounts.title'))}</h1>
          <p class="admin-shop__hint" id="accounts-subtitle">${escHtml(t('accounts.subtitle'))}</p>
        </div>
        <div class="admin-header__actions">
          <button type="button" class="btn btn--primary" id="accounts-new">+ ${escHtml(t('accounts.new'))}</button>
        </div>
      </div>
      <div class="admin-toolbar acct-toolbar">
        <div class="leads-filters" id="accounts-filters" role="group" aria-label="${escHtml(t('accounts.col.status'))}"></div>
        <input type="search" id="accounts-q" class="admin-shop__search"
               placeholder="${escHtml(t('accounts.searchPlaceholder'))}"
               aria-label="${escHtml(t('accounts.searchPlaceholder'))}" autocomplete="off" />
      </div>
      <div class="admin-table-wrap" id="accounts-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;
    this._el.querySelector('#accounts-new').addEventListener('click', () => this._showCreate());
    this._el.querySelector('#accounts-q').addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value.trim();
      this._searchDebounce = setTimeout(() => { this._q = v; this._page = 1; this._load(); }, 250);
    });
    this._el.querySelector('#accounts-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-status]');
      if (!btn) return;
      this._status = btn.dataset.status; this._page = 1; this._load();
    });
    this._paintFilters();
    await this._load();
    return renderAdminShell({ activePath: '/admin/accounts', content: this._el });
  }

  _paintFilters() {
    const btn = (value, label) =>
      `<button type="button" class="leads-filter${this._status === value ? ' is-active' : ''}" data-status="${escHtml(value)}" aria-pressed="${this._status === value ? 'true' : 'false'}">${escHtml(label)}</button>`;
    this._el.querySelector('#accounts-filters').innerHTML =
      btn('', t('accounts.filterAll')) + STATUSES.map(s => btn(s, t(STATUS_KEY[s]))).join('');
  }

  async _load() {
    const body = this._el.querySelector('#accounts-body');
    try {
      this._data = await getAccounts({ status: this._status || undefined, q: this._q || undefined, page: this._page, limit: PAGE_SIZE });
      this._paintFilters();
      this._el.querySelector('#accounts-subtitle').textContent =
        this._data.scope === 'all' ? t('accounts.subtitleAll') : t('accounts.subtitle');
      this._paintTable();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message || t('accounts.loadError'))}</p>`;
    }
  }

  _paintTable() {
    const body = this._el.querySelector('#accounts-body');
    const rows = this._data.accounts || [];
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🏢</div><p>${escHtml(t('accounts.empty'))}</p></div>`;
      return;
    }
    body.innerHTML = `
      <table class="admin-table acct-table">
        <thead><tr>
          <th>${escHtml(t('accounts.col.name'))}</th>
          <th>${escHtml(t('accounts.col.tier'))}</th>
          <th>${escHtml(t('accounts.col.status'))}</th>
          <th>${escHtml(t('accounts.col.owner'))}</th>
          <th class="num">${escHtml(t('accounts.col.monthlyFee'))}</th>
          <th>${escHtml(t('accounts.col.updated'))}</th>
        </tr></thead>
        <tbody>${rows.map(a => `<tr class="acct-row" data-id="${a.id}" tabindex="0">
          <td><span class="acct-name">${escHtml(a.name)}</span><span class="acct-slug">${escHtml(a.slug)}${a.kennitala ? ` · ${escHtml(a.kennitala)}` : ''}</span></td>
          <td>${escHtml(t(TIER_KEY[a.tier] || 'accounts.tier.vefur'))}</td>
          <td>${statusChip(a.status)}</td>
          <td>${escHtml(a.owner_name || '')}</td>
          <td class="num">${escHtml(isk(a.monthly_fee_isk))}</td>
          <td class="acct-cell--date">${escHtml(formatDate(a.updated_at))}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    body.querySelectorAll('tr.acct-row').forEach(tr => {
      const go = () => navigate(href(`/admin/accounts/${tr.dataset.id}`));
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  async _showCreate() {
    const existing = this._el.querySelector('#acct-create-overlay');
    if (existing) existing.remove();
    // Admins may pick the owning seller; everyone else owns what they create.
    let users = [];
    if (isAdmin()) {
      try { const d = await adminGetUsers({ limit: 100, sort: 'username', order: 'asc' }); users = Array.isArray(d) ? d : (d.users || []); } catch { /* no list → own it */ }
    }
    const overlay = document.createElement('div');
    overlay.id = 'acct-create-overlay';
    overlay.className = 'news-editor-overlay';
    overlay.innerHTML = `
      <div class="news-editor" role="dialog" aria-modal="true" aria-label="${escHtml(t('accounts.new'))}">
        <div class="news-editor__header">
          <h2 class="news-editor__title">${escHtml(t('accounts.new'))}</h2>
          <button class="news-editor__close" aria-label="${escHtml(t('accounts.close'))}">✕</button>
        </div>
        <form class="news-editor__form" id="acct-create-form" novalidate>
          <label class="news-editor__label">${escHtml(t('accounts.field.name'))} *
            <input class="news-editor__input" name="name" type="text" required maxlength="200">
          </label>
          <div class="news-editor__row">
            <label class="news-editor__label">${escHtml(t('accounts.field.kennitala'))}
              <input class="news-editor__input" name="kennitala" type="text" maxlength="10" inputmode="numeric" pattern="[0-9]{10}">
            </label>
            <label class="news-editor__label">${escHtml(t('accounts.field.tier'))} *
              <select class="news-editor__input" name="tier">${TIERS.map(x => `<option value="${x}" ${x === 'verslun' ? 'selected' : ''}>${escHtml(t(TIER_KEY[x]))}</option>`).join('')}</select>
            </label>
          </div>
          <div class="news-editor__row">
            <label class="news-editor__label">${escHtml(t('accounts.field.contactName'))}
              <input class="news-editor__input" name="contact_name" type="text" maxlength="150">
            </label>
            <label class="news-editor__label">${escHtml(t('accounts.field.contactEmail'))}
              <input class="news-editor__input" name="contact_email" type="email" maxlength="200">
            </label>
          </div>
          ${users.length ? `<label class="news-editor__label">${escHtml(t('accounts.field.owner'))}
            <select class="news-editor__input" name="owner_user_id"><option value="">${escHtml(t('accounts.ownerSelf'))}</option>${users.map(u => `<option value="${escHtml(u.id)}">${escHtml(u.display_name || u.username)}</option>`).join('')}</select>
          </label>` : ''}
          <label class="news-editor__label">${escHtml(t('accounts.field.notes'))}
            <textarea class="news-editor__input" name="notes" rows="3" maxlength="4000"></textarea>
          </label>
          <p class="admin-shop__error" id="acct-create-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="btn btn--primary">${escHtml(t('accounts.create'))}</button>
          </div>
        </form>
      </div>`;
    const close = () => overlay.remove();
    overlay.querySelector('.news-editor__close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#acct-create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      for (const [k, v] of fd.entries()) if (String(v).trim() !== '') body[k] = String(v).trim();
      const errEl = overlay.querySelector('#acct-create-error');
      errEl.textContent = '';
      try {
        const { account } = await createAccount(body);
        showToast(t('accounts.created'), 'success');
        close();
        navigate(href(`/admin/accounts/${account.id}`));
      } catch (err) {
        errEl.textContent = err.message || t('accounts.saveError');
      }
    });
    this._el.appendChild(overlay);
    overlay.querySelector('[name=name]').focus();
  }
}
