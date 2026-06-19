// AdminChangeRequestsView (/admin/feedback) — inbox for the in-app feedback
// tool: batches newest-first, each with its items (note, page, element,
// optional screenshot) and a per-item resolve/reopen toggle + status filter.
import { isAuthenticated, isAdmin, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const FILTERS = ['all', 'open', 'resolved'];

function fmtDate(d) {
  try { return new Date(d).toLocaleString(); } catch { return String(d || ''); }
}

export class AdminChangeRequestsView {
  constructor() { this._el = null; this._batches = []; this._filter = 'all'; }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page cr-page';
    this._el.innerHTML = `
      <div class="cr-head">
        <div>
          <h1 class="admin-title">${t('adminCR.title')}</h1>
          <p class="cr-sub">${t('adminCR.subtitle')}</p>
        </div>
        <div class="cr-filters">
          ${FILTERS.map(f => `<button type="button" class="cr-filter${f === this._filter ? ' is-active' : ''}" data-filter="${f}">${t('adminCR.filter_' + f)}</button>`).join('')}
        </div>
      </div>
      <div id="cr-body"><div class="admin-loading">${t('form.loading')}</div></div>`;
    this._el.querySelectorAll('.cr-filter').forEach(b => b.addEventListener('click', () => {
      this._filter = b.dataset.filter;
      this._el.querySelectorAll('.cr-filter').forEach(x => x.classList.toggle('is-active', x === b));
      this._load();
    }));
    await this._load();
    return renderAdminShell({ activePath: '/admin/feedback', content: this._el });
  }

  async _load() {
    const body = this._el.querySelector('#cr-body');
    body.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const qs = this._filter === 'all' ? '' : ('?status=' + this._filter);
      const res = await fetch('/api/v1/admin/change-requests' + qs, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load feedback');
      this._batches = data.batches || [];
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._el.querySelector('#cr-body');
    if (!this._batches.length) { body.innerHTML = `<p>${t('adminCR.empty')}</p>`; return; }
    body.innerHTML = this._batches.map(b => `
      <section class="cr-batch">
        <div class="cr-batch__head">
          <strong>${escHtml(b.submitter_email || t('adminCR.anonymous'))}</strong>
          <span class="cr-batch__meta">${escHtml(fmtDate(b.submitted_at))} · ${b.item_count} ${t('adminCR.itemsLabel')}</span>
        </div>
        ${(b.items || []).map(it => `
          <div class="cr-item" data-id="${escHtml(it.id)}">
            <div class="cr-item__note">${escHtml(it.note)}</div>
            <div class="cr-item__meta">
              <span>${t('adminCR.page')}: ${escHtml(it.page_label || it.page_url)}</span>
              ${it.element_label || it.element_selector ? `<span>${t('adminCR.element')}: <code>${escHtml(it.element_label || it.element_selector)}</code></span>` : ''}
              ${it.screenshot_path ? `<a href="${escHtml(it.screenshot_path)}" target="_blank" rel="noopener">${t('adminCR.screenshot')}</a>` : ''}
            </div>
            <div class="cr-item__actions">
              <span class="cr-badge cr-badge--${escHtml(it.status)}">${t('adminCR.status_' + it.status)}</span>
              <button type="button" class="admin-shop__link" data-toggle="${escHtml(it.id)}" data-next="${it.status === 'open' ? 'resolved' : 'open'}">
                ${it.status === 'open' ? t('adminCR.resolve') : t('adminCR.reopen')}
              </button>
            </div>
          </div>`).join('')}
      </section>`).join('');
    body.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => this._setStatus(b.dataset.toggle, b.dataset.next)));
  }

  async _setStatus(itemId, next) {
    try {
      const token = await getCSRFToken();
      const res = await fetch('/api/v1/admin/change-requests/items/' + itemId + '/status', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await this._load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  destroy() {}
}
