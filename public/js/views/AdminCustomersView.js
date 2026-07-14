// AdminCustomersView (/admin/customers) — a shop-customer lens on the users
// table: list + search with order aggregates, Export CSV, Add (a passwordless
// account + "set your password" invite), and CSV Import. B2C: no companies/
// kennitala. Add/Import are admin-only; listing is gated by the 'customers' view.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { downloadCsv } from '../utils/downloadCsv.js';
import {
  adminListCustomers, adminCreateCustomer,
  adminPreviewCustomerImport, adminApplyCustomerImport, adminDeleteCustomers,
} from '../services/adminCustomers.js';
import { parseCsvRecords } from '../utils/csv.js';
import { CustomerNotes } from '../components/CustomerNotes.js';

// Parse an Email/Name/Phone CSV → [{ email, display_name, phone }]. Tolerant of
// either English or Icelandic header names; rows without an email are dropped.
function parseCustomerCsv(text) {
  const records = parseCsvRecords(text);
  if (!records.length) return [];
  const header = records[0].map(h => h.trim().toLowerCase());
  const find = (names) => header.findIndex(h => names.includes(h));
  const ei = find(['email', 'e-mail', 'netfang']);
  const ni = find(['name', 'display name', 'nafn']);
  const pi = find(['phone', 'phone number', 'sími', 'simi']);
  if (ei < 0) return [];
  const out = [];
  for (let i = 1; i < records.length; i += 1) {
    const c = records[i];
    const email = String(c[ei] != null ? c[ei] : '').trim();
    if (!email) continue;
    out.push({
      email,
      display_name: ni >= 0 ? String(c[ni] != null ? c[ni] : '').trim() : '',
      phone:        pi >= 0 ? String(c[pi] != null ? c[pi] : '').trim() : '',
    });
  }
  return out;
}

export class AdminCustomersView {
  constructor() {
    this._el = null; this._customers = []; this._q = ''; this._searchDebounce = null;
    this._selected = new Set(); // selected customer ids (role='user' rows only)
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('customers')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const admin = isAdmin();
    this._el = document.createElement('div');
    this._el.className = 'view admin-shop';
    this._el.innerHTML = `
      <div class="admin-shop__inner">
        <header class="admin-shop__header">
          <h1>${t('adminCustomers.title')}</h1>
          <div class="admin-shop__header-actions">
            <button type="button" id="cust-export" class="admin-shop__primary-btn">${t('adminProducts.export')}</button>
            ${admin ? `<button type="button" id="cust-import" class="admin-shop__primary-btn">${t('adminProducts.import')}</button>
            <button type="button" id="cust-add" class="admin-shop__primary-btn">${t('adminCustomers.add')}</button>` : ''}
          </div>
        </header>
        <div class="admin-shop__header-controls">
          <input type="search" id="cust-q" class="admin-shop__search"
                 placeholder="${t('adminCustomers.searchPlaceholder')}" autocomplete="off"/>
        </div>
        <div class="cust-bulkbar" id="cust-bulkbar" hidden></div>
        <div id="cust-body"><p>${t('form.loading')}</p></div>
      </div>`;

    this._el.querySelector('#cust-export').addEventListener('click', () => this._exportCsv());
    this._el.querySelector('#cust-add')?.addEventListener('click', () => this._openAddModal());
    this._el.querySelector('#cust-import')?.addEventListener('click', () => this._openImportModal());
    const search = this._el.querySelector('#cust-q');
    search.addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value;
      this._searchDebounce = setTimeout(() => { this._q = v; this._load(); }, 250);
    });

    await this._load();
    return renderAdminShell({ activePath: '/admin/customers', content: this._el });
  }

  async _load() {
    const body = this._el.querySelector('#cust-body');
    // Selection is per-rendered-list: reset on every (re)load so you can never
    // act on rows you can't see (searching funnels through here too).
    this._selected.clear();
    this._syncBulkBar();
    try {
      const data = await adminListCustomers(this._q);
      this._customers = data.customers || [];
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-shop__error">${escHtml(err.message)}</p>`;
    }
  }

  _date(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  _statusLabel(c) {
    if (c.disabled) return t('adminCustomers.disabled');
    return c.email_verified ? t('adminCustomers.verified') : t('adminCustomers.pending');
  }

  _paint() {
    const body  = this._el.querySelector('#cust-body');
    const admin = isAdmin();
    if (!this._customers.length) { body.innerHTML = `<p>${t('adminCustomers.empty')}</p>`; return; }
    body.innerHTML = `
      <table class="admin-shop__table">
        <thead><tr>
          ${admin ? `<th class="cust-select"><input type="checkbox" id="cust-select-all" aria-label="${t('adminCustomers.selectAll')}"/></th>` : ''}
          <th>${t('adminCustomers.email')}</th><th>${t('adminCustomers.name')}</th><th>${t('adminCustomers.phone')}</th>
          <th>${t('adminCustomers.orders')}</th><th>${t('adminCustomers.spent')}</th>
          <th>${t('adminCustomers.joined')}</th><th>${t('adminCustomers.status')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${this._customers.map(c => `
            <tr>
              ${admin ? `<td class="cust-select">${c.role === 'user'
                ? `<input type="checkbox" class="cust-row-select" data-id="${escHtml(String(c.id))}" aria-label="${t('adminCustomers.selectRow')}"/>`
                : ''}</td>` : ''}
              <td>${escHtml(c.email)}</td>
              <td>${escHtml(c.display_name || '—')}</td>
              <td>${escHtml(c.phone || '—')}</td>
              <td>${Number(c.order_count) || 0}</td>
              <td>${Number(c.total_spent) ? Number(c.total_spent).toLocaleString('is-IS') + ' kr' : '—'}</td>
              <td>${this._date(c.created_at)}</td>
              <td>${escHtml(this._statusLabel(c))}</td>
              <td>${c.role === 'user'
                ? `<button type="button" class="cust-notes-btn" data-id="${escHtml(String(c.id))}" data-email="${escHtml(c.email)}">${t('customerNotes.title')}</button>`
                : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    if (admin) this._wireSelection(body);
    body.querySelectorAll('.cust-notes-btn').forEach(btn => {
      btn.addEventListener('click', () => this._openNotesModal(btn.dataset.id, btn.dataset.email));
    });
  }

  // Notes modal — hosts the reusable CustomerNotes component for one customer.
  _openNotesModal(customerId, email) {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('customerNotes.title')} — ${escHtml(email)}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <div class="cn-modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    const notes = new CustomerNotes({ customerId, isAdminViewer: isAdmin() });
    modal.querySelector('.cn-modal-body').appendChild(notes.mount());
    const close = () => { notes.destroy(); modal.remove(); };
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  }

  // ── Bulk selection + delete (admin only) ──────────────────────────────────
  // Only role='user' rows get a checkbox (staff/admin accounts are managed on
  // /admin/users); the server re-guards regardless. The bar lives outside
  // #cust-body so a repaint never drops it.
  _wireSelection(body) {
    const selectAll = body.querySelector('#cust-select-all');
    const rowBoxes  = [...body.querySelectorAll('.cust-row-select')];
    const syncHeader = () => {
      if (!selectAll) return;
      const checked = rowBoxes.filter(b => b.checked).length;
      selectAll.checked = checked > 0 && checked === rowBoxes.length;
      selectAll.indeterminate = checked > 0 && checked < rowBoxes.length;
    };
    selectAll?.addEventListener('change', () => {
      rowBoxes.forEach(cb => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) this._selected.add(cb.dataset.id); else this._selected.delete(cb.dataset.id);
      });
      selectAll.indeterminate = false;
      this._syncBulkBar();
    });
    rowBoxes.forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) this._selected.add(cb.dataset.id); else this._selected.delete(cb.dataset.id);
        syncHeader();
        this._syncBulkBar();
      });
    });
  }

  _syncBulkBar() {
    const bar = this._el?.querySelector('#cust-bulkbar');
    if (!bar) return;
    const n = this._selected.size;
    if (n === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <span class="cust-bulkbar__count">${t('adminCustomers.nSelected', { n })}</span>
      <button type="button" class="admin-shop__primary-btn cust-bulkbar__delete" id="cust-bulk-delete">${t('adminCustomers.deleteSelected')}</button>
      <button type="button" class="admin-shop__primary-btn" id="cust-bulk-clear">${t('adminCustomers.clearSelection')}</button>`;
    bar.hidden = false;
    bar.querySelector('#cust-bulk-delete')?.addEventListener('click', () => this._deleteSelected());
    bar.querySelector('#cust-bulk-clear')?.addEventListener('click', () => {
      this._selected.clear();
      this._el?.querySelectorAll('.cust-row-select').forEach(cb => { cb.checked = false; });
      const all = this._el?.querySelector('#cust-select-all');
      if (all) { all.checked = false; all.indeterminate = false; }
      this._syncBulkBar();
    });
  }

  // Itemized confirm spelling out exactly what's removed vs kept, then one
  // delete request + reload.
  async _deleteSelected() {
    const ids = [...this._selected];
    if (!ids.length) return;
    const byId   = new Map(this._customers.map(c => [String(c.id), c]));
    const emails = ids.map(id => byId.get(id)?.email).filter(Boolean);
    const lines = [
      t('adminCustomers.confirmDeleteIntro'),
      '',
      ...emails.map(e => `• ${e}`),
      '',
      t('adminCustomers.confirmKeptOrders'),
    ];
    if (!confirm(lines.join('\n'))) return;

    const btn = this._el.querySelector('#cust-bulk-delete');
    if (btn) btn.disabled = true;
    try {
      const res = await adminDeleteCustomers(ids);
      showToast(t('adminCustomers.deletedN', { n: res.accounts || 0 }), 'success');
      await this._load();
    } catch (err) {
      showToast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  _exportCsv() {
    const header = [
      t('adminCustomers.email'), t('adminCustomers.name'), t('adminCustomers.phone'),
      t('adminCustomers.orders'), t('adminCustomers.spent'), t('adminCustomers.joined'), t('adminCustomers.status'),
    ];
    const rows = this._customers.map(c => [
      c.email, c.display_name || '', c.phone || '',
      Number(c.order_count) || 0, Number(c.total_spent) || 0,
      this._date(c.created_at), this._statusLabel(c),
    ]);
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
  }

  _openAddModal() {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('adminCustomers.add')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <form class="admin-shop__form" id="cust-add-form">
          <label>${t('adminCustomers.email')}
            <input type="email" name="email" required maxlength="200"/>
          </label>
          <label>${t('adminCustomers.name')}
            <input type="text" name="display_name" maxlength="200"/>
          </label>
          <label>${t('adminCustomers.phone')}
            <input type="text" name="phone" maxlength="40"/>
          </label>
          <p class="admin-shop__hint">${t('adminCustomers.addHint')}</p>
          <p class="admin-shop__error" id="cust-add-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            <button type="submit" class="admin-shop__primary-btn">${t('adminCustomers.addSubmit')}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl = modal.querySelector('#cust-add-error');

    modal.querySelector('#cust-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const fd = new FormData(e.target);
      try {
        const res = await adminCreateCustomer({
          email:        String(fd.get('email') || '').trim(),
          display_name: String(fd.get('display_name') || '').trim() || null,
          phone:        String(fd.get('phone') || '').trim() || null,
        });
        close();
        showToast(res.invited ? t('adminCustomers.invited') : t('adminCustomers.createdNoEmail'), 'success');
        await this._load();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  _openImportModal() {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('adminProducts.import')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <div class="prod-import">
          <p class="admin-shop__hint">${t('adminCustomers.importIntro')}</p>
          <label class="admin-shop__upload-btn">
            <input type="file" accept=".csv,text/csv" id="cust-import-file"/>
            ${t('adminProducts.importChooseFile')}
          </label>
          <p class="admin-shop__error" id="cust-import-error" role="alert"></p>
          <div id="cust-import-preview"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const errorEl   = modal.querySelector('#cust-import-error');
    const previewEl = modal.querySelector('#cust-import-preview');

    modal.querySelector('#cust-import-file').addEventListener('change', async (e) => {
      errorEl.textContent = '';
      previewEl.innerHTML = '';
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      let text;
      try { text = await file.text(); } catch { errorEl.textContent = t('adminProducts.importParseError'); return; }
      const rows = parseCustomerCsv(text);
      if (!rows.length) { errorEl.textContent = t('adminProducts.importNoRows'); return; }
      previewEl.innerHTML = `<p class="admin-shop__hint">${t('adminProducts.importPreviewing')}</p>`;
      try {
        const { counts } = await adminPreviewCustomerImport(rows);
        this._renderImportPreview(previewEl, counts, rows, close);
      } catch (err) {
        previewEl.innerHTML = '';
        errorEl.textContent = err.message;
      }
    });
  }

  _renderImportPreview(previewEl, counts, rows, close) {
    const label = (k) => `${counts[k] || 0} ${t('adminCustomers.importStatus' + k.charAt(0).toUpperCase() + k.slice(1))}`;
    const canApply = (counts.new || 0) > 0;
    previewEl.innerHTML = `
      <p class="prod-import__summary">${['new', 'existing', 'duplicate', 'invalid'].map(label).join(' · ')}</p>
      <div class="admin-shop__form-actions">
        <button type="button" class="admin-shop__primary-btn" id="cust-import-apply" ${canApply ? '' : 'disabled'}>${t('adminProducts.importApply')}</button>
      </div>
      <p class="admin-shop__hint" id="cust-import-status" aria-live="polite"></p>`;
    const statusEl = previewEl.querySelector('#cust-import-status');
    previewEl.querySelector('#cust-import-apply')?.addEventListener('click', async () => {
      const btn = previewEl.querySelector('#cust-import-apply');
      btn.disabled = true;
      statusEl.textContent = t('adminProducts.importApplying');
      try {
        const res = await adminApplyCustomerImport(rows);
        statusEl.textContent = t('adminCustomers.importDone', { n: res.created });
        await this._load();
        setTimeout(close, 1200);
      } catch (err) {
        statusEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  destroy() { clearTimeout(this._searchDebounce); }
}
