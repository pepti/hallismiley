// AdminStockCountView — Talning / stock count (/admin/stock-count).
// Ported from icelandicstore #18 (the EasyScan "Update inventory" screen,
// AdminInventoryCheckView.js) onto the engine: build a list by scanning (the
// USB-wedge ScanInput) or by searching (the kit Combobox), give each line
// Increment / Decrement / Set and a quantity, see current → new live, and save
// the whole list as ONE audited batch (POST /api/v1/admin/inventory/count →
// Inventory.applyBatch): every line moves or none does, and a line that would
// go below zero is named and refused. Engine differences from ice: the mode
// is per line (ice: one mode for the batch), a decrement never clamps at 0
// (the engine refuses instead of quietly writing a different number), and a
// re-sent save is refused by its client token.
//
// Rides the `inventory` view id (a tab of Inventory Watch, not a sidebar item).
import { canSeeView } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { ScanInput } from '../components/ScanInput.js';
import { attachCombobox } from '../components/Combobox.js';
import { formatNumber } from '../utils/format.js';
import { lookupCode, searchItems, saveCount } from '../services/adminInventory.js';
import { stockTabsHtml, unitName, REASONS, MAX_STOCK, parseCount } from '../utils/stockUnits.js';

const MODES = ['set', 'increment', 'decrement'];

function newToken() {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch { /* old browser */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const keyOf = (item) => (item.variant_id ? `v:${item.variant_id}` : `p:${item.product_id}`);

export class AdminStockCountView {
  constructor() {
    this._lines = [];          // [{ key, item, mode, qty, error }]
    this._choose = null;       // { items } while a variant must be picked
    this._saving = false;
    this._token = newToken();
    this._destroyed = false;
    this._detach = [];
    this._scan = null;
    this._onClick = this._onClick.bind(this);
    this._onInput = this._onInput.bind(this);
  }

  async render() {
    if (!canSeeView('inventory')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const reasons = REASONS.map(r => `<option value="${r}"${r === 'recount' ? ' selected' : ''}>${escHtml(t('adminInventory.reason.' + r))}</option>`).join('');
    const el = document.createElement('div');
    el.className = 'main admin-page stock-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('admin.navGroup.shop')}</p>
          <h1 class="admin-title">${t('adminStockCount.title')}</h1>
        </div>
      </div>
      ${stockTabsHtml('count')}
      <p class="stock-intro">${t('adminStockCount.intro')}</p>
      <div class="stock-count__add">
        <div class="stock-count__scan" data-scan-host></div>
        <div class="stock-count__search">
          <label class="form-label" for="stock-count-search">${t('adminStockCount.searchLabel')}</label>
          <input id="stock-count-search" type="text" class="form-input" data-search autocomplete="off"
                 placeholder="${escHtml(t('adminStockCount.searchPlaceholder'))}" />
        </div>
      </div>
      <div class="stock-count__choose" data-choose hidden></div>
      <div class="admin-table-wrap" data-lines></div>
      <div class="stock-count__footer">
        <label class="form-label" for="stock-count-reason">${t('adminInventory.reasonLabel')}
          <select id="stock-count-reason" class="form-input form-input--sm" data-reason>${reasons}</select>
        </label>
        <label class="form-label stock-count__note" for="stock-count-note">${t('adminInventory.noteLabel')}
          <input id="stock-count-note" type="text" class="form-input form-input--sm" maxlength="500" data-note />
        </label>
        <div class="stock-count__actions">
          <button type="button" class="btn btn--ghost" data-clear>${t('adminStockCount.clear')}</button>
          <button type="button" class="btn btn--primary" data-save>${t('adminStockCount.save')}</button>
        </div>
      </div>
    `;
    this._el = el;
    el.addEventListener('click', this._onClick);
    el.addEventListener('input', this._onInput);
    el.addEventListener('change', this._onInput);

    this._scan = new ScanInput({ onScan: (code) => this._onScan(code) });
    el.querySelector('[data-scan-host]').appendChild(this._scan.mountInput({
      placeholder: t('adminStockCount.scanPlaceholder'), hint: t('adminStockCount.scanHint'),
    }));
    this._scan.attachGlobal();

    this._detach.push(attachCombobox(el.querySelector('[data-search]'), (q) => this._searchSource(q), {
      debounceMs: 250,
      minQuery: 2,
      onPick: (entry) => {
        if (entry && entry.value) this._addItem(entry.value, { bump: false });
        const input = this._el.querySelector('[data-search]');
        if (input) input.value = '';
      },
    }));

    this._paint();
    return renderAdminShell({ activePath: '/admin/inventory', content: el });
  }

  destroy() {
    this._destroyed = true;
    for (const d of this._detach) { try { d(); } catch { /* already gone */ } }
    this._detach = [];
    if (this._scan) { this._scan.destroy(); this._scan = null; }
    if (this._el) {
      this._el.removeEventListener('click', this._onClick);
      this._el.removeEventListener('input', this._onInput);
      this._el.removeEventListener('change', this._onInput);
    }
  }

  async _searchSource(q) {
    try {
      const items = await searchItems(q);
      return items.map(it => ({
        value: it,
        label: unitName(it),
        meta: [it.sku, t('adminStockCount.onHandShort', { n: formatNumber(it.on_hand) })].filter(Boolean).join(' · '),
        keywords: [it.sku, it.barcode, it.bin].filter(Boolean),
      }));
    } catch {
      return [];
    }
  }

  async _onScan(code) {
    try {
      const out = await lookupCode(code);
      if (this._destroyed) return;
      if (out.variantRequired) {
        this._choose = { items: out.items || [], code };
        this._scan.feedbackWrong();
        this._paintChoose();
        return;
      }
      const item = (out.items || [])[0];
      if (!item) throw new Error(t('adminStockCount.notFound', { code }));
      this._addItem(item, { bump: true });
      this._scan.feedbackOk();
    } catch (err) {
      if (this._destroyed) return;
      this._scan.feedbackErr();
      showToast(err.message || t('adminStockCount.notFound', { code }), 'error');
    }
  }

  // A scan adds one unit to its line (counting by scanning each item); a
  // search pick adds the line with nothing counted yet.
  _addItem(item, { bump }) {
    const key = keyOf(item);
    let line = this._lines.find(l => l.key === key);
    if (!line) {
      line = { key, item, mode: 'set', qty: bump ? 1 : 0, error: null };
      this._lines.unshift(line);
    } else if (bump) {
      line.qty = (Number(line.qty) || 0) + 1;
      // The scanned line moves to the top, where the scanner's eyes are.
      this._lines = [line, ...this._lines.filter(l => l !== line)];
    }
    line.error = null;
    this._choose = null;
    this._paintChoose();
    this._paint();
  }

  static preview(line) {
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 0) return null;
    const cur = Number(line.item.on_hand) || 0;
    if (line.mode === 'set') return qty;
    if (line.mode === 'increment') return cur + qty;
    return cur - qty;
  }

  _paintChoose() {
    const box = this._el.querySelector('[data-choose]');
    if (!this._choose) { box.hidden = true; box.innerHTML = ''; return; }
    const items = this._choose.items;
    box.hidden = false;
    box.innerHTML = `
      <p>${escHtml(t('adminStockCount.chooseVariant', { name: items[0] ? items[0].name : this._choose.code }))}</p>
      <div class="stock-count__choices">
        ${items.map((it, i) => `<button type="button" class="btn btn--sm btn--outline" data-choice="${i}">${escHtml(unitName(it))}</button>`).join('')}
        <button type="button" class="btn btn--sm btn--ghost" data-choice-cancel>${t('adminInventory.close')}</button>
      </div>`;
  }

  _paint() {
    const wrap = this._el.querySelector('[data-lines]');
    const saveBtn = this._el.querySelector('[data-save]');
    if (!this._lines.length) {
      wrap.innerHTML = `<p class="admin-state">${t('adminStockCount.empty')}</p>`;
      saveBtn.disabled = true;
      return;
    }
    const modeOpts = (mode) => MODES.map(m => `<option value="${m}"${m === mode ? ' selected' : ''}>${escHtml(t('adminStockCount.mode.' + m))}</option>`).join('');
    let invalid = 0;
    const rows = this._lines.map((l) => {
      const next = AdminStockCountView.preview(l);
      const bad = next == null || next < 0 || next > MAX_STOCK || (l.mode !== 'set' && !(Number(l.qty) >= 1));
      if (bad) invalid += 1;
      const msg = l.error || (next != null && next < 0 ? t('adminStockCount.belowZero') : '');
      return `<tr data-key="${escHtml(l.key)}" class="${bad || l.error ? 'is-invalid' : ''}">
        <td class="stock-c-name"><span class="stock-name">${escHtml(unitName(l.item))}</span>
          ${l.item.sku ? `<span class="stock-sku">${escHtml(l.item.sku)}</span>` : ''}
          ${msg ? `<span class="stock-line-error" role="alert">${escHtml(msg)}</span>` : ''}</td>
        <td class="stock-num">${formatNumber(l.item.on_hand)}</td>
        <td><select class="form-input form-input--sm" data-mode aria-label="${escHtml(t('adminStockCount.colMode'))}">${modeOpts(l.mode)}</select></td>
        <td><input class="form-input form-input--sm stock-qty" type="number" min="0" step="1" inputmode="numeric"
                   data-qty value="${escHtml(String(l.qty))}" aria-label="${escHtml(t('adminStockCount.colQty'))}" /></td>
        <td class="stock-num stock-count__new${next != null && next < 0 ? ' stock-num--zero' : ''}" data-new>
          ${next == null ? '—' : formatNumber(next)}</td>
        <td class="admin-table__actions"><button type="button" class="btn btn--sm btn--ghost" data-remove
            aria-label="${escHtml(t('adminStockCount.remove', { name: unitName(l.item) }))}">✕</button></td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table class="admin-table stock-table stock-count__table">
      <thead><tr>
        <th scope="col">${t('adminInventory.colProduct')}</th>
        <th scope="col">${t('adminStockCount.colCurrent')}</th>
        <th scope="col">${t('adminStockCount.colMode')}</th>
        <th scope="col">${t('adminStockCount.colQty')}</th>
        <th scope="col">${t('adminStockCount.colNew')}</th>
        <th scope="col"><span class="sr-only">${t('adminInventory.colActions')}</span></th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p class="stock-count__summary">${escHtml(t('adminStockCount.summary', { n: this._lines.length }))}</p>`;
    saveBtn.disabled = this._saving || invalid > 0;
  }

  _lineFor(target) {
    const tr = target.closest('tr[data-key]');
    return tr ? this._lines.find(l => l.key === tr.dataset.key) : null;
  }

  _onInput(e) {
    if (e.target.matches('[data-mode]')) {
      const line = this._lineFor(e.target);
      if (line && MODES.includes(e.target.value)) { line.mode = e.target.value; line.error = null; this._paint(); }
      return;
    }
    if (e.target.matches('[data-qty]')) {
      const line = this._lineFor(e.target);
      if (!line) return;
      const parsed = parseCount(e.target.value);
      line.qty = parsed.error ? e.target.value : parsed.value;
      line.error = null;
      // Repaint only the preview cell + the save button, so the field being
      // typed in keeps its focus and caret.
      const next = AdminStockCountView.preview(line);
      const cell = e.target.closest('tr').querySelector('[data-new]');
      cell.textContent = next == null ? '—' : formatNumber(next);
      cell.classList.toggle('stock-num--zero', next != null && next < 0);
      const anyBad = this._lines.some((l) => {
        const n = AdminStockCountView.preview(l);
        return n == null || n < 0 || n > MAX_STOCK || (l.mode !== 'set' && !(Number(l.qty) >= 1));
      });
      this._el.querySelector('[data-save]').disabled = this._saving || anyBad;
      if (e.type === 'change') this._paint();
    }
  }

  _onClick(e) {
    const choice = e.target.closest('[data-choice]');
    if (choice && this._choose) {
      const item = this._choose.items[Number(choice.dataset.choice)];
      if (item) this._addItem(item, { bump: true });
      return;
    }
    if (e.target.closest('[data-choice-cancel]')) { this._choose = null; this._paintChoose(); return; }
    if (e.target.closest('[data-remove]')) {
      const line = this._lineFor(e.target);
      this._lines = this._lines.filter(l => l !== line);
      this._paint();
      return;
    }
    if (e.target.closest('[data-clear]')) {
      if (this._lines.length && !window.confirm(t('adminStockCount.clearConfirm'))) {
        showToast(t('admin.actionCancelled'), 'info');
        return;
      }
      this._lines = [];
      this._paint();
      return;
    }
    if (e.target.closest('[data-save]')) this._save();
  }

  async _save() {
    if (this._saving || !this._lines.length) return;
    this._saving = true;
    this._paint();
    const sent = this._lines.slice();
    try {
      const out = await saveCount({
        lines: sent.map(l => ({
          productId: l.item.product_id, variantId: l.item.variant_id || undefined, mode: l.mode, qty: Number(l.qty),
        })),
        reason: this._el.querySelector('[data-reason]').value,
        note: this._el.querySelector('[data-note]').value.trim() || undefined,
        clientToken: this._token,
      });
      if (this._destroyed) return;
      showToast(t('adminStockCount.saved', { n: (out.results || []).length }), 'success');
      this._done();
    } catch (err) {
      if (this._destroyed) return;
      if (err.reason === 'DUPLICATE_BATCH') {
        showToast(err.message, 'info');
        this._done();
        return;
      }
      if (err.lines) {
        for (const r of err.lines) {
          const line = sent[r.index];
          if (line) line.error = r.message || t('adminStockCount.belowZero');
        }
      } else if (err.line && sent[err.line - 1]) {
        sent[err.line - 1].error = err.message;
      }
      showToast(err.message || t('adminStockCount.saveError'), 'error');
    } finally {
      this._saving = false;
      if (!this._destroyed) this._paint();
    }
  }

  _done() {
    this._lines = [];
    this._token = newToken();
    this._el.querySelector('[data-note]').value = '';
  }
}
