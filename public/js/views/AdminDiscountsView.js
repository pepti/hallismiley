// AdminDiscountsView (/admin/discounts) — list + create/edit code-based order
// discounts (percentage or fixed, with min-subtotal, usage limit, date window).
// Standalone admin page (matches this site's admin pages — no admin shell).
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { listDiscounts, createDiscount, updateDiscount } from '../services/adminDiscounts.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { showToast } from '../components/Toast.js';
import * as cart from '../services/cart.js';

export class AdminDiscountsView {
  constructor() { this._el = null; this._discounts = []; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page disc-page';
    this._el.innerHTML = `
      <div class="disc-head">
        <h1 class="admin-title">${t('adminDiscounts.title')}</h1>
        <button type="button" class="btn btn--primary" id="disc-new">${t('adminDiscounts.new')}</button>
      </div>
      <div id="disc-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el.querySelector('#disc-new').addEventListener('click', () => this._openForm());
    await this._load();
    return this._el;
  }

  async _load() {
    const body = this._el.querySelector('#disc-body');
    try {
      this._discounts = await listDiscounts();
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._el.querySelector('#disc-body');
    if (!this._discounts.length) { body.innerHTML = `<p>${t('adminDiscounts.empty')}</p>`; return; }
    body.innerHTML = `
      <table class="admin-table disc-table">
        <thead><tr>
          <th>${t('adminDiscounts.code')}</th>
          <th>${t('adminDiscounts.value')}</th>
          <th>${t('adminDiscounts.minSubtotal')}</th>
          <th>${t('adminDiscounts.usage')}</th>
          <th>${t('adminDiscounts.status')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${this._discounts.map(d => `
            <tr data-id="${escHtml(d.id)}">
              <td><code>${escHtml(d.code)}</code><div class="disc-title">${escHtml(d.title)}</div></td>
              <td>${d.value_type === 'percentage' ? d.value + '%' : cart.formatMoney(d.value, d.currency)}</td>
              <td>${d.min_subtotal != null ? cart.formatMoney(d.min_subtotal, d.currency) : '—'}</td>
              <td>${d.used_count}${d.usage_limit != null ? ' / ' + d.usage_limit : ''}</td>
              <td>${d.enabled
                ? `<span class="disc-badge disc-badge--active">${t('adminDiscounts.active')}</span>`
                : `<span class="disc-badge disc-badge--off">${t('adminDiscounts.disabled')}</span>`}</td>
              <td><button type="button" class="btn btn--sm btn--ghost" data-edit="${escHtml(d.id)}">${t('admin.edit')}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const d = this._discounts.find(x => x.id === b.dataset.edit);
      if (d) this._openForm(d);
    }));
  }

  _openForm(existing = null) {
    const isEdit = !!existing;
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${isEdit ? t('adminDiscounts.edit') : t('adminDiscounts.new')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <form class="admin-shop__form" id="disc-form">
          <label>${t('adminDiscounts.code')}
            <input type="text" name="code" required maxlength="60" value="${escHtml(existing?.code || '')}"/>
          </label>
          <label>${t('adminDiscounts.titleLabel')}
            <input type="text" name="title" maxlength="200" value="${escHtml(existing?.title || '')}"/>
          </label>
          <div class="admin-shop__form-row">
            <label>${t('adminDiscounts.type')}
              <select name="value_type">
                <option value="percentage" ${existing?.value_type === 'percentage' ? 'selected' : ''}>${t('adminDiscounts.percentage')}</option>
                <option value="fixed" ${existing?.value_type === 'fixed' ? 'selected' : ''}>${t('adminDiscounts.fixed')}</option>
              </select>
            </label>
            <label>${t('adminDiscounts.value')}
              <input type="number" name="value" required min="0" step="1" value="${existing?.value ?? ''}"/>
            </label>
            <label>${t('adminDiscounts.currency')}
              <select name="currency">
                <option value="ISK" ${existing?.currency !== 'EUR' ? 'selected' : ''}>ISK</option>
                <option value="EUR" ${existing?.currency === 'EUR' ? 'selected' : ''}>EUR</option>
              </select>
            </label>
          </div>
          <div class="admin-shop__form-row">
            <label>${t('adminDiscounts.minSubtotal')}
              <input type="number" name="min_subtotal" min="0" step="1" value="${existing?.min_subtotal ?? ''}"/>
            </label>
            <label>${t('adminDiscounts.usageLimit')}
              <input type="number" name="usage_limit" min="1" step="1" value="${existing?.usage_limit ?? ''}"/>
            </label>
            <label>${t('adminDiscounts.endsAt')}
              <input type="date" name="ends_at" value="${existing?.ends_at ? String(existing.ends_at).slice(0, 10) : ''}"/>
            </label>
          </div>
          <label class="admin-shop__checkbox">
            <input type="checkbox" name="enabled" ${existing?.enabled === false ? '' : 'checked'}/>
            ${t('adminDiscounts.enabled')}
          </label>
          <p class="admin-shop__hint">${t('adminDiscounts.valueHint')}</p>
          <p class="admin-shop__error" id="disc-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="btn btn--primary">${isEdit ? t('form.save') : t('form.create')}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl = modal.querySelector('#disc-error');

    modal.querySelector('#disc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const fd = new FormData(e.target);
      const code = String(fd.get('code') || '').trim();
      const body = {
        code,
        title:        String(fd.get('title') || '').trim() || code,
        value_type:   fd.get('value_type'),
        value:        Number(fd.get('value')),
        currency:     fd.get('currency'),
        min_subtotal: fd.get('min_subtotal') === '' ? null : Number(fd.get('min_subtotal')),
        usage_limit:  fd.get('usage_limit')  === '' ? null : Number(fd.get('usage_limit')),
        ends_at:      fd.get('ends_at') || null,
        enabled:      fd.get('enabled') === 'on',
      };
      try {
        if (isEdit) await updateDiscount(existing.id, body);
        else        await createDiscount(body);
        close();
        showToast(t('form.saved'), 'success');
        await this._load();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  destroy() {}
}
