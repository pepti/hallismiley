// VariantGrid — the product editor's variant table: edit, add, delete, arrange,
// and "+ Add a colour" (one new value × every size, SKU + barcode pasted from a
// spreadsheet).
//
// Ported from icelandicstore #194, #352/#381 and #430 (ice@965014ee; harvest 2
// lane 6c, 2026-09-26) — ice's ProductFormView variant card, lifted into a
// component so the engine's product modal (AdminProductsView) mounts it with a
// one-line hunk. Engine deltas: variants carry a EUR override too; the cells
// that pick an option value for a NEW row are Comboboxes over the values the
// product already uses (ice #194's value pickers); the default order is
// colour → size (utils/variantArrange.js) rather than the API's SKU order, and
// a header click still overrides it.
//
// Autosave by design (ice): a saved row writes the changed field on `change`
// (PATCH), a new row stays local until it has every option value and a SKU,
// then POSTs once and adopts its id. Status is PER ROW, so a failure names the
// row that failed and keeps what was typed. A stock cell is an audited
// correction (models/Inventory.js via the PATCH route), never a blind write.
// Delete really deletes; the server archives a variant an order or the stock
// history still names, and the row stays greyed with the reason.
import { getCsrfHeaders } from '../utils/api.js';
import { t, plural } from '../i18n/i18n.js';
import { showToast } from './Toast.js';
import { attachCombobox } from './Combobox.js';
import { axisKind, arrangeVariants } from '../utils/variantArrange.js';
import { axisValues, planNewValue, parsePaste } from '../utils/variantAddValue.js';
import {
  sortThHtml, bindSortHeaders, refocusSortHeader, nextSortCols, readSortCols, writeSortCols,
  filterSortCols, variantComparator, axisLabel, AXIS_FIELD, SORT_KEYS,
} from '../utils/variantSort.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const toRow = (v) => ({
  id: v.id,
  attributes: { ...(v.attributes || {}) },
  sku: v.sku || '', bin: v.bin || '',
  price_isk: v.price_isk ?? null, price_eur: v.price_eur ?? null,
  stock: v.stock ?? 0, barcode: v.barcode || '', active: v.active !== false,
});

export class VariantGrid {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.host      where the grid + the add-a-colour panel live
   * @param {object}      opts.product   the admin product payload (id, variant_axes, variants)
   * @param {Function}   [opts.onChange] called with the fresh variant list after any save
   */
  constructor({ host, product, onChange = null }) {
    this._host = host;
    this._product = product;
    this._onChange = onChange;
    this._rows = (product.variants || []).map(toRow);
    this._sort = readSortCols(SORT_KEYS.grid);
    this._sortFields = [];
    this._addValue = null;
    this._detachers = [];
    this._destroyed = false;
  }

  mount() {
    this._host.innerHTML = '<div data-vgrid></div><div data-vgrid-add></div>';
    this._paint();
    return this;
  }

  destroy() {
    this._destroyed = true;
    this._drain();
  }

  _drain() { while (this._detachers.length) { try { this._detachers.pop()(); } catch { /* gone */ } } }
  _axes() { return Array.isArray(this._product.variant_axes) ? this._product.variant_axes : []; }
  _gridEl() { return this._host.querySelector('[data-vgrid]'); }

  // The variant list as the server now has it, for the caller (the image
  // colour picker lists the product's ACTIVE colours).
  _emit() {
    if (!this._onChange) return;
    this._onChange(this._rows.filter(r => r.id && !r._archived).map(r => ({ ...r })));
  }

  // Colour → size by default; the clicked headers when there are any. Unsaved
  // rows stay at the bottom, where "+ Add Variant" put them, so a half-typed
  // row cannot jump away mid-edit. The rows array itself is never reordered:
  // save, status and delete address a row by its index (data-i).
  _ordered(axes, cols) {
    const all = this._rows.map((v, i) => ({ v, i }));
    const saved = all.filter(x => x.v.id);
    const fresh = all.filter(x => !x.v.id);
    let arranged;
    if (cols.length) {
      const cmp = variantComparator(cols, { axes });
      arranged = saved.slice().sort((a, b) => cmp(a.v, b.v));
    } else {
      const order = arrangeVariants(saved.map(x => x.v), axes);
      arranged = order.map(v => saved.find(x => x.v === v));
    }
    return [...arranged, ...fresh];
  }

  _paint() {
    if (this._destroyed) return;
    const wrap = this._gridEl();
    if (!wrap) return;
    this._drain();
    const axes = this._axes();

    // Captured BEFORE the swap — activeElement still points at the old input.
    const focused = document.activeElement;
    const keepFocus = (focused && wrap.contains(focused) && focused.closest('tr'))
      ? { i: focused.closest('tr').dataset.i, f: focused.dataset.f }
      : null;

    if (!axes.length) { this._paintAxisSetter(wrap); return; }

    this._sortFields = [...axes.map(AXIS_FIELD), 'sku', 'bin', 'price_isk', 'stock'];
    const cols = filterSortCols(this._sort, this._sortFields);
    const sortTh = (field, label) => sortThHtml({ field, label, cols });
    const rowName = (v, i) => axes.map(a => (v.attributes && v.attributes[a]) || '').filter(Boolean).join(' / ') || '#' + (i + 1);
    const nameFor = (v, i, col) => _esc(rowName(v, i) + ' — ' + col);
    const inherit = _esc(t('adminProducts.variantInherit'));
    const dis = (v) => (v._archived ? 'disabled' : '');

    wrap.innerHTML = `
      <p class="admin-shop__hint">${t('adminProducts.variantHint')}</p>
      ${this._rows.length ? '' : `<p class="admin-shop__hint">${t('adminProducts.noVariants')}</p>`}
      <div class="vgrid__scroll" role="region" tabindex="0" aria-label="${_esc(t('adminProducts.variants'))}">
      <table class="admin-shop__variant-table vgrid">
        <thead><tr>${axes.map(a => sortTh(AXIS_FIELD(a), axisLabel(a))).join('')}${sortTh('sku', 'SKU')}${sortTh('bin', t('adminProducts.detailBin'))}${sortTh('price_isk', t('adminProducts.priceISK'))}<th scope="col">${t('adminProducts.priceEUR')}</th>${sortTh('stock', t('adminProducts.stock'))}<th scope="col">${t('adminProducts.variantBarcode')}</th><th scope="col">${t('adminProducts.active')}</th><th scope="col"><span class="sr-only">${t('admin.status')}</span></th><th scope="col"><span class="sr-only">${t('adminProducts.deleteVariant')}</span></th></tr></thead>
        <tbody>
          ${this._ordered(axes, cols).map(({ v, i }) => `<tr data-i="${i}" data-testid="variant-row" class="${v._archived ? 'admin-shop__var-row--archived' : ''}">
            ${axes.map(a => `<td><input class="admin-shop__var-input" data-f="attr:${_esc(a)}" type="text" maxlength="100" aria-label="${nameFor(v, i, axisLabel(a))}" value="${_esc((v.attributes && v.attributes[a]) || '')}" ${dis(v)}/></td>`).join('')}
            <td><input class="admin-shop__var-input" data-f="sku" type="text" maxlength="100" aria-label="${nameFor(v, i, 'SKU')}" value="${_esc(v.sku)}" ${dis(v)}/></td>
            <td><input class="admin-shop__var-input" data-f="bin" type="text" maxlength="40" aria-label="${nameFor(v, i, t('adminProducts.detailBin'))}" value="${_esc(v.bin)}" ${dis(v)}/></td>
            <td><input class="admin-shop__var-input" data-f="price_isk" type="number" min="1" step="1" aria-label="${nameFor(v, i, t('adminProducts.priceISK'))}" value="${v.price_isk ?? ''}" placeholder="${inherit}" ${dis(v)}/></td>
            <td><input class="admin-shop__var-input" data-f="price_eur" type="number" min="1" step="1" aria-label="${nameFor(v, i, t('adminProducts.priceEUR'))}" value="${v.price_eur ?? ''}" placeholder="${inherit}" ${dis(v)}/></td>
            <td><input class="admin-shop__var-input" data-f="stock" type="number" min="0" step="1" aria-label="${nameFor(v, i, t('adminProducts.stock'))}" value="${v.stock ?? 0}" ${dis(v)}/></td>
            <td><input class="admin-shop__var-input" data-f="barcode" type="text" maxlength="64" aria-label="${nameFor(v, i, t('adminProducts.variantBarcode'))}" value="${_esc(v.barcode)}" ${dis(v)}/></td>
            <td><input type="checkbox" data-f="active" aria-label="${nameFor(v, i, t('adminProducts.active'))}" ${v.active ? 'checked' : ''} ${dis(v)}/></td>
            <td class="admin-shop__var-status">${_esc(v._status || (v.id ? '' : t('adminProducts.variantIncomplete')))}</td>
            <td>${v._archived ? '' : `<button type="button" class="admin-shop__var-del" data-testid="variant-del" data-i="${i}" title="${_esc(t('adminProducts.deleteVariant'))}" aria-label="${_esc(rowName(v, i) + ' — ' + t('adminProducts.deleteVariant'))}">✕</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <p class="sr-only" role="status" aria-live="polite" data-vgrid-live></p>
      <div class="vgrid__acts">
        <button type="button" class="admin-shop__link" data-vgrid-add-row data-testid="variant-add">+ ${t('adminProducts.addVariant')}</button>
        ${this._rows.some(r => r.id && !r._archived) ? `<button type="button" class="admin-shop__link" data-vgrid-add-value data-testid="variant-add-value">+ ${_esc(this._addValueLabel())}</button>` : ''}
      </div>`;

    bindSortHeaders(wrap, (field) => this._sortBy(field));
    this._wireRows(wrap, axes, rowName);

    if (keepFocus && keepFocus.i != null) {
      wrap.querySelector(`tr[data-i="${keepFocus.i}"] [data-f="${keepFocus.f}"]`)?.focus();
    }
  }

  // A product with no options yet cannot have a variant row: name the options
  // first (ice's option builder, reduced to the names — the grid then takes
  // the rows). Once a variant exists the names are frozen: renaming one would
  // orphan every row's attribute keys. Names are lower-cased like ice's form.
  _paintAxisSetter(wrap) {
    wrap.innerHTML = `
      <p class="admin-shop__hint">${t('adminProducts.variantAxesHint')}</p>
      <div class="vgrid-axes">
        <label class="vgrid-av__field"><span>${t('adminProducts.variantAxesLabel')}</span>
          <input type="text" data-vgrid-axes maxlength="160" placeholder="${_esc(t('adminProducts.variantAxesPlaceholder'))}" autocomplete="off"/></label>
        <button type="button" class="admin-shop__primary-btn" data-vgrid-axes-save>${t('form.save')}</button>
      </div>
      <p class="vgrid-av__err" role="alert" data-vgrid-axes-err></p>`;
    const input = wrap.querySelector('[data-vgrid-axes]');
    const errEl = wrap.querySelector('[data-vgrid-axes-err]');
    wrap.querySelector('[data-vgrid-axes-save]').addEventListener('click', async () => {
      const names = [...new Set(String(input.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
      if (!names.length || names.length > 3 || names.some(n => n.length > 50)) {
        errEl.textContent = t('adminProducts.variantAxesInvalid');
        return;
      }
      errEl.textContent = '';
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch(`/api/v1/admin/shop/products/${encodeURIComponent(this._product.id)}`, {
          method: 'PATCH', credentials: 'include', headers, body: JSON.stringify({ variant_axes: names }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t('form.error'));
        this._product.variant_axes = (data.product && data.product.variant_axes) || names;
        this._paint();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  _sortBy(field) {
    this._sort = nextSortCols(filterSortCols(this._sort, this._sortFields), field);
    writeSortCols(SORT_KEYS.grid, this._sort);
    this._paint();
    const wrap = this._gridEl();
    refocusSortHeader(wrap, field);
    const live = wrap && wrap.querySelector('[data-vgrid-live]');
    if (live) {
      const labels = filterSortCols(this._sort, this._sortFields).map(c => (c.field.startsWith('attr:')
        ? axisLabel(c.field.slice(5))
        : ({ sku: 'SKU', bin: t('adminProducts.detailBin'), price_isk: t('adminProducts.priceISK'), stock: t('adminProducts.stock') }[c.field] || c.field)));
      live.textContent = labels.length ? t('shop.sortByCol', { col: labels.join(', ') }) : '';
    }
  }

  _wireRows(wrap, axes, rowName) {
    const setStatus = (i, msg) => {
      this._rows[i]._status = msg;
      const cell = wrap.querySelector(`tr[data-i="${i}"] .admin-shop__var-status`);
      if (cell) cell.textContent = msg;
      const live = wrap.querySelector('[data-vgrid-live]');
      if (live && msg) live.textContent = rowName(this._rows[i], i) + ' — ' + msg;
    };
    const isComplete = (row) => axes.every(a => String(row.attributes[a] || '').trim()) && String(row.sku || '').trim();
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const payloadOf = (row) => ({
      sku: String(row.sku || '').trim(),
      attributes: Object.fromEntries(axes.map(a => [a, String(row.attributes[a] || '').trim()])),
      bin: String(row.bin || '').trim() || null,
      price_isk: num(row.price_isk),
      price_eur: num(row.price_eur),
      stock: Number(row.stock) || 0,
      barcode: String(row.barcode || '').trim() || null,
      active: row.active !== false,
    });

    const persist = async (i, field) => {
      const row = this._rows[i];
      if (!row || row._archived) return;
      if (!row.id && !isComplete(row)) { setStatus(i, t('adminProducts.variantIncomplete')); return; }
      setStatus(i, t('form.saving'));
      const isNew = !row.id;
      try {
        const headers = await getCsrfHeaders();
        const base = `/api/v1/admin/shop/products/${encodeURIComponent(this._product.id)}/variants`;
        const body = isNew ? payloadOf(row) : { [field]: payloadOf(row)[field] };
        const res = await fetch(isNew ? base : `${base}/${encodeURIComponent(row.id)}`, {
          method: isNew ? 'POST' : 'PATCH', credentials: 'include', headers, body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t('form.error'));
        if (data.variant) Object.assign(row, toRow(data.variant));
        setStatus(i, t('form.saved'));
        this._emit();
        // A new row joins the arranged order once it is saved.
        if (isNew) this._paint();
      } catch (err) {
        // Keep whatever the admin typed — reverting silently loses the edit.
        setStatus(i, err.message);
      }
    };

    wrap.querySelectorAll('tr[data-i]').forEach(tr => {
      const i = Number(tr.dataset.i);
      const row = this._rows[i];
      tr.querySelectorAll('.admin-shop__var-input').forEach(inp => {
        const f = inp.dataset.f;
        // A new row picks each option value from the values the product
        // already uses (still free text — a new size stays typeable).
        if (!row.id && f.startsWith('attr:')) {
          const axis = f.slice(5);
          this._detachers.push(attachCombobox(inp, () => axisValues(this._rows.filter(r => r.id), axis)));
        }
        inp.addEventListener('change', () => {
          if (f.startsWith('attr:')) {
            row.attributes[f.slice(5)] = inp.value;
            persist(i, 'attributes');
          } else {
            row[f] = inp.value;
            persist(i, f);
          }
        });
      });
      tr.querySelector('input[data-f="active"]')?.addEventListener('change', (e) => {
        row.active = e.target.checked;
        persist(i, 'active');
      });
    });
    wrap.querySelectorAll('.admin-shop__var-del').forEach(btn => {
      btn.addEventListener('click', () => this._deleteRow(Number(btn.dataset.i)));
    });
    wrap.querySelector('[data-vgrid-add-value]')?.addEventListener('click', () => this._openAddValue());
    wrap.querySelector('[data-vgrid-add-row]')?.addEventListener('click', () => {
      const attributes = {};
      for (const a of axes) attributes[a] = '';
      this._rows.push({ id: null, attributes, sku: '', bin: '', price_isk: null, price_eur: null, stock: 0, barcode: '', active: true });
      this._paint();
      this._gridEl()?.querySelector(`tr[data-i="${this._rows.length - 1}"] .admin-shop__var-input`)?.focus();
    });
  }

  // Unsaved rows just disappear. Saved rows are deleted; a variant an order or
  // the stock history names is archived instead and stays greyed with the
  // server's reason.
  async _deleteRow(i) {
    const row = this._rows[i];
    if (!row) return;
    if (!row.id) { this._rows.splice(i, 1); this._paint(); return; }
    if (!window.confirm(t('adminProducts.confirmDeleteVariant'))) return;
    try {
      const headers = await getCsrfHeaders();
      const res = await fetch(`/api/v1/admin/shop/products/${encodeURIComponent(this._product.id)}/variants/${encodeURIComponent(row.id)}`, {
        method: 'DELETE', credentials: 'include', headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('form.error'));
      if (data.archived) {
        row._archived = true;
        row.active = false;
        row._status = data.message || t('adminProducts.variantArchived');
      } else {
        this._rows.splice(i, 1);
      }
      this._emit();
    } catch (err) {
      row._status = err.message;
    }
    this._paint();
  }

  // Re-read the product (after "+ Add a colour") and repaint. Rows still being
  // typed have no id and do not exist on the server — carry them across.
  async _reload() {
    const unsaved = this._rows.filter(r => !r.id);
    try {
      const res = await fetch(`/api/v1/admin/shop/products/${encodeURIComponent(this._product.id)}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('form.error'));
      this._product.variants = data.product.variants || [];
      this._product.variant_axes = data.product.variant_axes || this._product.variant_axes;
      this._rows = [...this._product.variants.map(toRow), ...unsaved];
      this._emit();
    } catch (err) {
      showToast(err.message, 'error');
    }
    if (!this._destroyed) this._paint();
  }

  // ── "+ Add a colour" (ice #430) ────────────────────────────────────────────
  _colorAxis() { return this._axes().find(a => axisKind(a) === 'color') || null; }
  _addValueLabel() { return this._colorAxis() ? t('adminProducts.addColor') : t('adminProducts.addAxisValue'); }

  _openAddValue() {
    const axes = this._axes();
    this._addValue = {
      axis: this._colorAxis() || axes[0], value: '', skus: [], barcodes: [],
      status: [], paste: '', pasteErr: '', busy: false, done: 0, fixedRows: null,
    };
    this._paintAddValue();
    this._host.querySelector('#vgrid-av-value')?.focus();
  }

  _closeAddValue() {
    this._addValue = null;
    const host = this._host.querySelector('[data-vgrid-add]');
    if (host) host.innerHTML = '';
    this._host.querySelector('[data-vgrid-add-value]')?.focus();
  }

  _resetAddValueRows() {
    const st = this._addValue;
    st.skus = []; st.barcodes = []; st.status = []; st.paste = ''; st.pasteErr = '';
  }

  _paintAddValue() {
    const host = this._host.querySelector('[data-vgrid-add]');
    const st = this._addValue;
    if (!host || !st || this._destroyed) return;
    const axes = this._axes();
    const others = axes.filter(a => a !== st.axis);
    // After a partly failed run the saved rows are in the grid, so re-planning
    // would call the value taken: the rows that were planned stay the plan.
    // Only rows that exist on the server count — a half-typed "+ Add Variant"
    // row or one archived this session must neither add a size nor block one.
    const plan = st.fixedRows ? { rows: st.fixedRows, error: null }
      : planNewValue({ axes, rows: this._rows.filter(r => r.id && !r._archived), axis: st.axis, value: st.value });
    const isColor = axisKind(st.axis) === 'color';
    const planMsg = plan.error === 'exists' ? t('adminProducts.addValueExists', { value: st.value.trim() })
      : plan.error === 'noOthers' ? t('adminProducts.addValueNoOthers') : '';
    // A row left without a SKU is simply not created — a colour that only
    // comes in S–XL leaves XS and 2XL empty. Saved rows count as done.
    const toSend = () => plan.rows.filter((_, i) => st.status[i] !== 'ok' && String(st.skus[i] || '').trim()).length;
    const locked = (i) => st.busy || st.status[i] === 'ok';
    const createLabel = (n) => plural(n, 'adminProducts.addValueCreate.one', 'adminProducts.addValueCreate.many');
    const first = plan.rows.length && others.length ? others.map(a => plan.rows[0][a]).join(' / ') : '';
    host.innerHTML = `
      <section class="vgrid-av" data-testid="add-value-panel" aria-labelledby="vgrid-av-title">
        <h4 class="vgrid-av__title" id="vgrid-av-title">${_esc(this._addValueLabel())}</h4>
        <p class="admin-shop__hint">${_esc(others.length
          ? t(isColor ? 'adminProducts.addValueLead' : 'adminProducts.addValueLeadValue', { axes: others.map(axisLabel).join(' × ') })
          : t('adminProducts.addValueLeadSingle'))}</p>
        <div class="vgrid-av__fields">
          ${axes.length > 1 ? `<label class="vgrid-av__field"><span>${_esc(t('adminProducts.addValueAxis'))}</span>
            <select id="vgrid-av-axis" ${st.busy || st.fixedRows ? 'disabled' : ''}>${axes.map(a => `<option value="${_esc(a)}" ${a === st.axis ? 'selected' : ''}>${_esc(axisLabel(a))}</option>`).join('')}</select></label>` : ''}
          <label class="vgrid-av__field"><span>${_esc(isColor ? t('adminProducts.addValueColor') : t('adminProducts.addValueValue'))}</span>
            <input type="text" id="vgrid-av-value" data-testid="add-value-value" maxlength="100" value="${_esc(st.value)}" autocomplete="off" ${st.busy || st.fixedRows ? 'disabled' : ''}></label>
        </div>
        ${planMsg ? `<p class="vgrid-av__err" role="alert">${_esc(planMsg)}</p>` : ''}
        ${plan.rows.length ? `
          <label class="vgrid-av__field vgrid-av__paste"><span>${_esc(t('adminProducts.addValuePaste'))}</span>
            <textarea id="vgrid-av-paste" rows="3" data-testid="add-value-paste" placeholder="${_esc(t('adminProducts.addValuePastePlaceholder', { first }))}" ${st.busy ? 'disabled' : ''}>${_esc(st.paste)}</textarea></label>
          ${others.length ? `<p class="admin-shop__hint">${_esc(t('adminProducts.addValuePasteHint', { first, axes: others.map(axisLabel).join(' / ').toLowerCase() }))}</p>` : ''}
          ${st.pasteErr ? `<p class="vgrid-av__err" role="alert">${_esc(st.pasteErr)}</p>` : ''}
          <div class="vgrid__scroll"><table class="admin-shop__variant-table vgrid-av__table">
            <thead><tr>${axes.map(a => `<th scope="col">${_esc(axisLabel(a))}</th>`).join('')}<th scope="col">SKU</th><th scope="col">${_esc(t('adminProducts.variantBarcode'))}</th><th scope="col"><span class="sr-only">${_esc(t('admin.status'))}</span></th></tr></thead>
            <tbody>${plan.rows.map((attrs, i) => {
              const name = axes.map(a => attrs[a]).join(' / ');
              return `<tr data-av="${i}" data-testid="add-value-row">
                ${axes.map(a => `<td>${_esc(attrs[a])}</td>`).join('')}
                <td><input class="admin-shop__var-input" data-av-f="sku" data-av-i="${i}" type="text" maxlength="100" aria-label="${_esc(name + ' — SKU')}" value="${_esc(st.skus[i] || '')}" ${locked(i) ? 'disabled' : ''}></td>
                <td><input class="admin-shop__var-input" data-av-f="barcode" data-av-i="${i}" type="text" maxlength="64" aria-label="${_esc(name + ' — ' + t('adminProducts.variantBarcode'))}" value="${_esc(st.barcodes[i] || '')}" ${locked(i) ? 'disabled' : ''}></td>
                <td class="admin-shop__var-status">${_esc(st.status[i] === 'ok' ? t('form.saved') : (st.status[i] || ''))}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>` : ''}
        <p class="sr-only" role="status" aria-live="polite" id="vgrid-av-live">${st.busy ? _esc(t('adminProducts.addValueProgress', { n: st.done, total: plan.rows.length })) : ''}</p>
        ${plan.rows.length ? `<p class="admin-shop__hint">${_esc(t('adminProducts.addValueNeedSku'))}</p>` : ''}
        <div class="vgrid-av__acts">
          <button type="button" class="admin-shop__link" id="vgrid-av-cancel" ${st.busy ? 'disabled' : ''}>${_esc(t('form.cancel'))}</button>
          <button type="button" class="admin-shop__primary-btn" id="vgrid-av-create" data-testid="add-value-create" ${toSend() && !st.busy ? '' : 'disabled'}>${_esc(createLabel(toSend()))}</button>
        </div>
      </section>`;

    // Typing the value re-plans, which repaints — put the caret back.
    const valueBox = host.querySelector('#vgrid-av-value');
    valueBox?.addEventListener('input', () => {
      const at = valueBox.selectionStart;
      st.value = valueBox.value;
      this._resetAddValueRows();
      this._paintAddValue();
      const again = host.querySelector('#vgrid-av-value');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch { /* not a text box */ } }
    });
    host.querySelector('#vgrid-av-axis')?.addEventListener('change', (e) => {
      st.axis = e.target.value;
      this._resetAddValueRows();
      this._paintAddValue();
    });
    // The cells update state WITHOUT a repaint, so Tab moves on normally.
    host.querySelectorAll('[data-av-f]').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.avI);
        (inp.dataset.avF === 'sku' ? st.skus : st.barcodes)[i] = inp.value;
        const btn = host.querySelector('#vgrid-av-create');
        if (btn) {
          const n = toSend();
          btn.disabled = !n || st.busy;
          btn.textContent = createLabel(n);
        }
      });
    });
    const paste = host.querySelector('#vgrid-av-paste');
    paste?.addEventListener('input', () => {
      st.paste = paste.value;
      const r = parsePaste(st.paste, plan.rows, axes, st.axis);
      const what = others.map(axisLabel).join(' / ').toLowerCase();
      st.pasteErr = r.errors
        .map(e => t('adminProducts.addValuePasteErr.' + e.reason, { line: e.line, n: plan.rows.length, got: e.got, what }))
        .join(' ');
      // The paste is the source of every unsaved row: a shorter block must not
      // leave the previous block's SKU on the rows it no longer covers.
      plan.rows.forEach((_, i) => {
        if (st.status[i] === 'ok') return;
        const v = r.values[i];
        st.skus[i] = v ? v.sku : '';
        st.barcodes[i] = v ? v.barcode : '';
      });
      this._paintAddValue();
      const again = host.querySelector('#vgrid-av-paste');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    host.querySelector('#vgrid-av-cancel')?.addEventListener('click', () => this._closeAddValue());
    host.querySelector('#vgrid-av-create')?.addEventListener('click', () => this._createAddValue(plan.rows));
    host.onkeydown = (e) => { if (e.key === 'Escape' && !st.busy) { e.preventDefault(); e.stopPropagation(); this._closeAddValue(); } };
  }

  // One POST per row through the existing one-variant route, in order. A failed
  // row stops nothing: each reports its own result, saved rows lock, and
  // pressing Create again retries only the rest.
  async _createAddValue(rows) {
    const st = this._addValue;
    if (!st || st.busy) return;
    if (!rows.some((_, i) => st.status[i] !== 'ok' && String(st.skus[i] || '').trim())) return;
    st.busy = true; st.done = 0;
    this._paintAddValue();
    let headers = null;
    try { headers = await getCsrfHeaders(); } catch { /* every row reports the failure */ }
    for (let i = 0; i < rows.length; i++) {
      if (st.status[i] === 'ok' || !String(st.skus[i] || '').trim()) { st.done++; continue; }
      if (!headers) { st.status[i] = t('form.error'); st.done++; continue; }
      try {
        const res = await fetch(`/api/v1/admin/shop/products/${encodeURIComponent(this._product.id)}/variants`, {
          method: 'POST', credentials: 'include', headers,
          body: JSON.stringify({
            sku: String(st.skus[i] || '').trim(),
            attributes: rows[i],
            barcode: String(st.barcodes[i] || '').trim() || null,
            price_isk: null, price_eur: null, stock: 0, active: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        st.status[i] = res.ok ? 'ok' : (data.error || t('form.error'));
      } catch {
        st.status[i] = t('form.error');
      }
      st.done++;
      if (this._destroyed) return;
      this._paintAddValue();
    }
    st.busy = false;
    if (this._destroyed) return;
    const created = rows.filter((_, i) => st.status[i] === 'ok').length;
    const failed = rows.filter((_, i) => st.status[i] !== 'ok' && String(st.skus[i] || '').trim()).length;
    const value = st.value.trim();
    await this._reload();
    if (this._destroyed) return;
    if (!failed) {
      showToast(t('adminProducts.addValueDone', { n: created, value }), 'success');
      this._closeAddValue();
    } else {
      st.fixedRows = rows;
      this._paintAddValue();
      const live = this._host.querySelector('#vgrid-av-live');
      if (live) live.textContent = t('adminProducts.addValueSomeFailed', { n: failed });
    }
  }
}
