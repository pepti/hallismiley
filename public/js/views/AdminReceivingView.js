// AdminReceivingView — Vörumóttaka / goods receiving list (/admin/receiving).
// Ported from icelandicstore #23 (AdminGoodsReceiptsView.js), harvest 2 lane
// 6a, cut to the engine: a receipt is started from the supplier's name and
// reference only (no supplier directory); its lines come from the supplier's
// file on the detail screen. Status filter is deep-linkable (?status=).
import { canSeeView } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigate, navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { readListState, syncListState } from '../utils/listState.js';
import { attachStickyHScroll } from '../utils/stickyHScroll.js';
import { formatDate, formatNumber } from '../utils/format.js';
import { listReceipts, createReceipt } from '../services/adminReceiving.js';

const STATUSES = ['draft', 'finalized', 'cancelled'];

export class AdminReceivingView {
  constructor() {
    const st = readListState({ status: '' });
    this._status = STATUSES.includes(st.status) ? st.status : '';
    this._gen = 0;
    this._destroyed = false;
    this._detach = [];
    this._onClick = this._onClick.bind(this);
    this._onSubmit = this._onSubmit.bind(this);
  }

  async render() {
    if (!canSeeView('receiving')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'main admin-page stock-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('admin.navGroup.shop')}</p>
          <h1 class="admin-title">${t('adminReceiving.title')}</h1>
        </div>
      </div>
      <p class="stock-intro">${t('adminReceiving.intro')}</p>
      <form class="receiving-new" data-new novalidate>
        <h2 class="receiving-new__title">${t('adminReceiving.newTitle')}</h2>
        <div class="receiving-new__fields">
          <label class="form-label" for="rcv-supplier">${t('adminReceiving.supplier')}
            <input id="rcv-supplier" class="form-input" name="supplierName" maxlength="200" required autocomplete="off" />
          </label>
          <label class="form-label" for="rcv-reference">${t('adminReceiving.reference')}
            <input id="rcv-reference" class="form-input" name="reference" maxlength="100" autocomplete="off" />
          </label>
          <label class="form-label receiving-new__note" for="rcv-note">${t('adminReceiving.note')}
            <input id="rcv-note" class="form-input" name="note" maxlength="1000" autocomplete="off" />
          </label>
        </div>
        <button type="submit" class="btn btn--primary">${t('adminReceiving.create')}</button>
      </form>
      <div class="admin-chips stock-chips" role="group" aria-label="${escHtml(t('adminReceiving.filterLabel'))}" data-chips></div>
      <div class="admin-table-wrap" data-table><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    el.addEventListener('click', this._onClick);
    el.querySelector('[data-new]').addEventListener('submit', this._onSubmit);
    const sticky = attachStickyHScroll(el.querySelector('[data-table]'), { label: t('adminReceiving.title') });
    if (sticky && sticky.detach) this._detach.push(() => sticky.detach());
    this._paintChips();
    this._load();
    return renderAdminShell({ activePath: '/admin/receiving', content: el });
  }

  destroy() {
    this._destroyed = true;
    for (const d of this._detach) { try { d(); } catch { /* gone */ } }
    this._detach = [];
    if (this._el) this._el.removeEventListener('click', this._onClick);
  }

  _paintChips() {
    const chip = (s, label) => `<button type="button" class="admin-chip" data-status="${s}" aria-pressed="${this._status === s}">${escHtml(label)}</button>`;
    this._el.querySelector('[data-chips]').innerHTML = chip('', t('adminReceiving.all'))
      + STATUSES.map(s => chip(s, t('adminReceiving.status.' + s))).join('');
  }

  async _load() {
    const gen = ++this._gen;
    const wrap = this._el.querySelector('[data-table]');
    try {
      const receipts = await listReceipts(this._status || null);
      if (gen !== this._gen || this._destroyed) return;
      if (!receipts.length) {
        wrap.innerHTML = `<p class="admin-state">${t('adminReceiving.empty')}</p>`;
        return;
      }
      wrap.innerHTML = `<table class="admin-table stock-table">
        <thead><tr>
          <th scope="col">${t('adminReceiving.colDate')}</th>
          <th scope="col">${t('adminReceiving.supplier')}</th>
          <th scope="col">${t('adminReceiving.reference')}</th>
          <th scope="col" class="stock-num">${t('adminReceiving.colLines')}</th>
          <th scope="col" class="stock-num">${t('adminReceiving.colExpected')}</th>
          <th scope="col" class="stock-num">${t('adminReceiving.colScanned')}</th>
          <th scope="col">${t('adminInventory.colStatus')}</th>
        </tr></thead>
        <tbody>${receipts.map(r => `<tr>
          <td>${escHtml(formatDate(r.created_at))}</td>
          <td><a href="${href('/admin/receiving/' + encodeURIComponent(r.id))}" data-route="/admin/receiving/${escHtml(r.id)}">${escHtml(r.supplier_name)}</a></td>
          <td>${r.reference ? escHtml(r.reference) : '<span class="stock-muted">—</span>'}</td>
          <td class="stock-num">${formatNumber(r.line_count)}</td>
          <td class="stock-num">${formatNumber(r.expected_units)}</td>
          <td class="stock-num">${formatNumber(r.scanned_units)}</td>
          <td><span class="stock-pill stock-pill--rcv-${escHtml(r.status)}">${escHtml(t('adminReceiving.status.' + r.status))}</span></td>
        </tr>`).join('')}</tbody></table>`;
    } catch {
      if (gen !== this._gen || this._destroyed) return;
      wrap.innerHTML = `<p class="admin-error">${escHtml(t('adminReceiving.loadError'))}
        <button type="button" class="btn btn--sm btn--outline admin-error__retry" data-retry>${t('adminInventory.retry')}</button></p>`;
    }
  }

  _onClick(e) {
    if (e.target.closest('[data-retry]')) { this._load(); return; }
    const chip = e.target.closest('[data-status]');
    if (chip) {
      this._status = chip.dataset.status;
      syncListState(href('/admin/receiving'), { status: this._status }, { status: '' });
      this._paintChips();
      this._load();
    }
  }

  async _onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const supplierName = form.supplierName.value.trim();
    if (!supplierName) {
      showToast(t('adminReceiving.supplierRequired'), 'error');
      form.supplierName.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const { receipt } = await createReceipt({
        supplierName,
        reference: form.reference.value.trim() || undefined,
        note: form.note.value.trim() || undefined,
      });
      if (this._destroyed) return;
      navigate(href('/admin/receiving/' + encodeURIComponent(receipt.id)));
    } catch (err) {
      showToast(err.message || t('adminReceiving.saveError'), 'error');
      btn.disabled = false;
    }
  }
}
