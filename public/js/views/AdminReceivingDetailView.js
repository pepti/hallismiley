// AdminReceivingDetailView — one goods receipt (/admin/receiving/:id).
// Ported from icelandicstore #23 (AdminGoodsReceiptDetailView.js), harvest 2
// lane 6a. The flow, top to bottom:
//   1. read the supplier's lines from their file (.csv/.xlsx/.pdf — the ONE
//      product-file reader on the server), matched to our catalogue by SKU,
//      then barcode; an unmatched line is matched by hand (kit Combobox,
//      attached lazily on focus because the rows re-render) or skipped;
//   2. scan the goods in (ScanInput; a scan counts one, or "units per scan");
//   3. read the difference — short, over, not on the invoice;
//   4. finalise: ONE audited stock batch by what was RECEIVED, refused a
//      second time; the receipt then prints as a PDF.
// Every write answers with the receipt's whole state, so the page repaints
// from one shape.
import { canSeeView } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href, getLocale } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { ScanInput } from '../components/ScanInput.js';
import { attachCombobox } from '../components/Combobox.js';
import { adminPageTitle } from '../utils/pageTitle.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import { unitName, parseCount } from '../utils/stockUnits.js';
import {
  getReceipt, importLines, updateLine, scan, deleteScan, finalizeReceipt, cancelReceipt, receiptPdfUrl, searchItems,
} from '../services/adminReceiving.js';

const VARIANCE_CLASS = { exact: 'ok', short: 'low', over: 'watch', not_received: 'out', pending: 'none' };

export class AdminReceivingDetailView {
  constructor(id) {
    this._id = String(id || '');
    this._state = null;
    this._excluded = new Set();   // not-on-invoice groups NOT to receive
    this._perScan = 1;
    this._busy = false;
    this._gen = 0;
    this._destroyed = false;
    this._scan = null;
    this._combos = [];            // [{ input, detach }] — lazily attached matchers
    this.documentTitle = adminPageTitle(t('adminReceiving.title'), getLocale());
    this._onClick = this._onClick.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onFocusIn = this._onFocusIn.bind(this);
  }

  async render() {
    if (!canSeeView('receiving')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'main admin-page stock-page receiving-detail';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('adminReceiving.title')}</p>
          <h1 class="admin-title" data-title>${t('form.loading')}</h1>
          <p class="receiving-detail__meta" data-meta></p>
        </div>
        <a href="${href('/admin/receiving')}" class="btn btn--outline" data-route="/admin/receiving">← ${t('adminReceiving.back')}</a>
      </div>
      <div data-body><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    el.addEventListener('click', this._onClick);
    el.addEventListener('change', this._onChange);
    el.addEventListener('focusin', this._onFocusIn);
    this._load();
    return renderAdminShell({ activePath: '/admin/receiving', content: el });
  }

  destroy() {
    this._destroyed = true;
    this._detachCombos();
    if (this._scan) { this._scan.destroy(); this._scan = null; }
    if (this._el) {
      this._el.removeEventListener('click', this._onClick);
      this._el.removeEventListener('change', this._onChange);
      this._el.removeEventListener('focusin', this._onFocusIn);
    }
  }

  _detachCombos() {
    for (const c of this._combos) { try { c.detach(); } catch { /* gone */ } }
    this._combos = [];
  }

  async _load() {
    const gen = ++this._gen;
    try {
      const state = await getReceipt(this._id);
      if (gen !== this._gen || this._destroyed) return;
      this._apply(state);
    } catch (err) {
      if (gen !== this._gen || this._destroyed) return;
      this._el.querySelector('[data-title]').textContent = t('adminReceiving.title');
      this._el.querySelector('[data-body]').innerHTML = `<p class="admin-error">${escHtml(err.status === 404 ? t('adminReceiving.notFound') : t('adminReceiving.loadError'))}</p>`;
    }
  }

  _apply(state) {
    this._state = state;
    const r = state.receipt;
    const label = r.reference ? `${r.supplier_name} · ${r.reference}` : r.supplier_name;
    this.documentTitle = adminPageTitle(label, getLocale());
    document.title = this.documentTitle;
    this._paint();
  }

  get _draft() { return this._state && this._state.receipt.status === 'draft'; }

  // ── paint ───────────────────────────────────────────────────────────────────
  _paint() {
    const { receipt: r, lines, extras, scans, summary: s } = this._state;
    this._el.querySelector('[data-title]').textContent = r.supplier_name;
    const meta = [
      r.reference ? escHtml(r.reference) : '',
      `<span class="stock-pill stock-pill--rcv-${escHtml(r.status)}">${escHtml(t('adminReceiving.status.' + r.status))}</span>`,
      r.status === 'finalized'
        ? escHtml(t('adminReceiving.finalizedBy', { when: formatDateTime(r.finalized_at), who: r.finalized_by_name || '—' }))
        : escHtml(t('adminReceiving.createdAt', { when: formatDateTime(r.created_at) })),
    ].filter(Boolean).join(' · ');
    this._el.querySelector('[data-meta]').innerHTML = meta;

    this._detachCombos();
    const body = this._el.querySelector('[data-body]');
    const hadScan = Boolean(this._scan);
    body.innerHTML = `
      ${r.note ? `<p class="stock-intro">${escHtml(r.note)}</p>` : ''}
      <div class="receiving-actions">
        ${this._draft ? `<label class="btn btn--outline receiving-file">
            ${t('adminReceiving.importFile')}
            <input type="file" accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-file />
          </label>` : ''}
        <a class="btn btn--outline" href="${receiptPdfUrl(r.id)}" target="_blank" rel="noopener">${t('adminReceiving.pdf')}</a>
        ${this._draft ? `<button type="button" class="btn btn--ghost" data-cancel>${t('adminReceiving.cancel')}</button>
          <button type="button" class="btn btn--primary" data-finalize>${t('adminReceiving.finalize')}</button>` : ''}
      </div>
      <p class="receiving-help">${t('adminReceiving.fileHelp')}</p>
      <dl class="receiving-summary">
        ${this._stat(t('adminReceiving.sumLines'), s.lines)}
        ${this._stat(t('adminReceiving.sumUnmatched'), s.unmatched, s.unmatched ? 'out' : '')}
        ${this._stat(t('adminReceiving.sumShort'), s.short, s.short ? 'low' : '')}
        ${this._stat(t('adminReceiving.sumOver'), s.over, s.over ? 'watch' : '')}
        ${this._stat(t('adminReceiving.sumExtras'), s.notOnInvoice, s.notOnInvoice ? 'watch' : '')}
        ${this._stat(t('adminReceiving.sumUnits'), `${formatNumber(s.receivedUnits)} / ${formatNumber(s.expectedUnits)}`)}
      </dl>
      ${this._draft ? `<div class="receiving-scan">
        <div data-scan-host></div>
        <label class="form-label receiving-scan__qty" for="rcv-per-scan">${t('adminReceiving.perScan')}
          <input id="rcv-per-scan" class="form-input form-input--sm" type="number" min="1" step="1" inputmode="numeric"
                 value="${this._perScan}" data-per-scan />
        </label>
      </div>` : ''}
      <h2 class="receiving-h2">${t('adminReceiving.linesTitle')}</h2>
      <div class="admin-table-wrap">${this._linesTable(lines)}</div>
      ${extras.length ? `<h2 class="receiving-h2">${t('adminReceiving.extrasTitle')}</h2>
        <p class="receiving-help">${t('adminReceiving.extrasHelp')}</p>
        <div class="admin-table-wrap">${this._extrasTable(extras)}</div>` : ''}
      ${scans.length ? `<h2 class="receiving-h2">${t('adminReceiving.scansTitle')}</h2>
        <ul class="receiving-scans">${scans.map(sc => `<li>
          <span class="stock-muted">${escHtml(formatDateTime(sc.created_at))}</span>
          <span>${escHtml(unitName(sc))}</span>
          <span class="stock-num">×${formatNumber(sc.qty)}</span>
          ${sc.receipt_line_id ? '' : `<span class="stock-pill stock-pill--watch">${t('adminReceiving.notOnInvoice')}</span>`}
          ${this._draft ? `<button type="button" class="btn btn--sm btn--ghost" data-undo="${escHtml(sc.id)}">${t('adminReceiving.undo')}</button>` : ''}
        </li>`).join('')}</ul>` : ''}
    `;

    if (this._draft) {
      if (!this._scan) this._scan = new ScanInput({ onScan: (code) => this._onScan(code) });
      body.querySelector('[data-scan-host]').appendChild(this._scan.mountInput({
        placeholder: t('adminReceiving.scanPlaceholder'), hint: t('adminReceiving.scanHint'),
      }));
      this._scan.attachGlobal();
      if (hadScan) this._scan.focus();
    } else if (this._scan) {
      this._scan.destroy();
      this._scan = null;
    }
  }

  _stat(label, value, tone = '') {
    return `<div class="receiving-summary__item${tone ? ' receiving-summary__item--' + tone : ''}">
      <dt>${escHtml(label)}</dt><dd>${typeof value === 'number' ? formatNumber(value) : escHtml(String(value))}</dd></div>`;
  }

  _linesTable(lines) {
    if (!lines.length) return `<p class="admin-state">${t('adminReceiving.noLines')}</p>`;
    const draft = this._draft;
    const rows = lines.map((l) => {
      const skipped = l.match_status === 'skipped' || l.match_status === 'new_product';
      const matched = Boolean(l.product_id) && !skipped;
      const code = l.file_sku || l.barcode || l.supplier_ref || '';
      let item;
      if (skipped) item = `<span class="stock-muted">${t('adminReceiving.skipped')}</span>`;
      else if (matched) item = `<span class="stock-name">${escHtml(unitName(l))}</span>${l.sku ? `<span class="stock-sku">${escHtml(l.sku)}</span>` : ''}`;
      else item = draft
        ? `<input type="text" class="form-input form-input--sm" data-match="${escHtml(l.id)}" autocomplete="off"
             placeholder="${escHtml(t('adminReceiving.matchPlaceholder'))}" aria-label="${escHtml(t('adminReceiving.matchPlaceholder'))}" />`
        : `<span class="stock-pill stock-pill--out">${t('adminReceiving.unmatched')}</span>`;
      const variance = skipped || !l.variance ? ''
        : `<span class="stock-pill stock-pill--${VARIANCE_CLASS[l.variance] || 'none'}">${escHtml(t('adminReceiving.variance.' + l.variance))}</span>`;
      const expected = draft && !skipped
        ? `<input type="number" min="0" step="1" inputmode="numeric" class="form-input form-input--sm stock-qty"
             data-expected="${escHtml(l.id)}" value="${Number(l.expected_qty) || 0}" aria-label="${escHtml(t('adminReceiving.colExpected'))}" />`
        : formatNumber(l.expected_qty);
      const action = !draft ? ''
        : skipped
          ? `<button type="button" class="btn btn--sm btn--ghost" data-unskip="${escHtml(l.id)}">${t('adminReceiving.unskip')}</button>`
          : `${matched ? `<button type="button" class="btn btn--sm btn--ghost" data-unmatch="${escHtml(l.id)}">${t('adminReceiving.rematch')}</button>` : ''}
             <button type="button" class="btn btn--sm btn--ghost" data-skip="${escHtml(l.id)}">${t('adminReceiving.skip')}</button>`;
      return `<tr class="${skipped ? 'is-muted' : ''}${matched ? '' : ' is-unmatched'}">
        <td>${code ? `<span class="stock-sku">${escHtml(code)}</span>` : ''}${l.supplier_description ? `<span class="receiving-desc">${escHtml(l.supplier_description)}</span>` : ''}</td>
        <td class="stock-c-name">${item}</td>
        <td class="stock-num">${expected}</td>
        <td class="stock-num">${formatNumber(l.received_qty)}</td>
        <td>${variance}</td>
        <td class="admin-table__actions">${action}</td>
      </tr>`;
    }).join('');
    return `<table class="admin-table stock-table receiving-lines">
      <thead><tr>
        <th scope="col">${t('adminReceiving.colFile')}</th>
        <th scope="col">${t('adminReceiving.colItem')}</th>
        <th scope="col" class="stock-num">${t('adminReceiving.colExpected')}</th>
        <th scope="col" class="stock-num">${t('adminReceiving.colReceived')}</th>
        <th scope="col">${t('adminReceiving.colVariance')}</th>
        <th scope="col"><span class="sr-only">${t('adminInventory.colActions')}</span></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  _extrasTable(extras) {
    const draft = this._draft;
    return `<table class="admin-table stock-table">
      <thead><tr>
        <th scope="col">${t('adminReceiving.colItem')}</th>
        <th scope="col" class="stock-num">${t('adminReceiving.colReceived')}</th>
        ${draft ? `<th scope="col">${t('adminReceiving.receiveIntoStock')}</th>` : ''}
      </tr></thead>
      <tbody>${extras.map(x => `<tr>
        <td class="stock-c-name"><span class="stock-name">${escHtml(unitName(x))}</span>${x.sku ? `<span class="stock-sku">${escHtml(x.sku)}</span>` : ''}</td>
        <td class="stock-num">${formatNumber(x.qty)}</td>
        ${draft ? `<td><input type="checkbox" data-extra="${escHtml(x.key)}" ${this._excluded.has(x.key) ? '' : 'checked'}
            aria-label="${escHtml(t('adminReceiving.receiveIntoStockFor', { name: unitName(x) }))}" /></td>` : ''}
      </tr>`).join('')}</tbody></table>`;
  }

  // ── actions ─────────────────────────────────────────────────────────────────
  async _run(fn, { ok = null } = {}) {
    if (this._busy) return;
    this._busy = true;
    try {
      const state = await fn();
      if (this._destroyed) return;
      this._apply(state);
      if (ok) showToast(ok(state), 'success');
    } catch (err) {
      if (this._destroyed) return;
      const first = err.lines && err.lines[0] && err.lines[0].message;
      showToast(first ? `${err.message} ${first}` : (err.message || t('adminReceiving.saveError')), 'error');
    } finally {
      this._busy = false;
    }
  }

  async _onScan(code) {
    try {
      const state = await scan(this._id, code, this._perScan);
      if (this._destroyed) return;
      if (state.scanned && state.scanned.matched) this._scan.feedbackOk();
      else this._scan.feedbackWrong();
      this._apply(state);
    } catch (err) {
      if (this._destroyed) return;
      if (this._scan) this._scan.feedbackErr();
      showToast(err.message || t('adminReceiving.saveError'), 'error');
    }
  }

  _onFocusIn(e) {
    const input = e.target.closest('[data-match]');
    if (!input || this._combos.some(c => c.input === input)) return;
    // Rows re-render on every write: drop matchers whose input left the page.
    this._combos = this._combos.filter((c) => {
      if (c.input.isConnected) return true;
      try { c.detach(); } catch { /* gone */ }
      return false;
    });
    const lineId = input.dataset.match;
    const detach = attachCombobox(input, async (q) => {
      try {
        const items = await searchItems(q);
        return items.map(it => ({ value: it, label: unitName(it), meta: it.sku || '', keywords: [it.sku, it.barcode].filter(Boolean) }));
      } catch { return []; }
    }, {
      debounceMs: 250,
      minQuery: 2,
      onPick: (entry) => {
        if (!entry || !entry.value) return;
        this._run(() => updateLine(this._id, lineId, {
          productId: entry.value.product_id, variantId: entry.value.variant_id || null,
        }));
      },
    });
    this._combos.push({ input, detach });
  }

  _onChange(e) {
    const file = e.target.closest('[data-file]');
    if (file && file.files && file.files[0]) {
      const f = file.files[0];
      this._run(() => importLines(this._id, f), {
        ok: (st) => t('adminReceiving.imported', { n: st.imported ? st.imported.added : 0, m: st.imported ? st.imported.matched : 0 }),
      });
      file.value = '';
      return;
    }
    const exp = e.target.closest('[data-expected]');
    if (exp) {
      const parsed = parseCount(exp.value);
      if (parsed.error) { showToast(t('adminInventory.invalidCount'), 'error'); return; }
      this._run(() => updateLine(this._id, exp.dataset.expected, { expectedQty: parsed.value }));
      return;
    }
    const per = e.target.closest('[data-per-scan]');
    if (per) {
      const parsed = parseCount(per.value);
      this._perScan = parsed.error || parsed.value < 1 ? 1 : Math.min(parsed.value, 100000);
      per.value = String(this._perScan);
      return;
    }
    const extra = e.target.closest('[data-extra]');
    if (extra) {
      if (extra.checked) this._excluded.delete(extra.dataset.extra);
      else this._excluded.add(extra.dataset.extra);
    }
  }

  _onClick(e) {
    const skip = e.target.closest('[data-skip]');
    if (skip) { this._run(() => updateLine(this._id, skip.dataset.skip, { matchStatus: 'skipped' })); return; }
    const unskip = e.target.closest('[data-unskip]');
    if (unskip) { this._run(() => updateLine(this._id, unskip.dataset.unskip, { matchStatus: 'matched' })); return; }
    const unmatch = e.target.closest('[data-unmatch]');
    if (unmatch) { this._run(() => updateLine(this._id, unmatch.dataset.unmatch, { productId: null })); return; }
    const undo = e.target.closest('[data-undo]');
    if (undo) { this._run(() => deleteScan(this._id, undo.dataset.undo)); return; }
    if (e.target.closest('[data-cancel]')) {
      if (!window.confirm(t('adminReceiving.cancelConfirm'))) { showToast(t('admin.actionCancelled'), 'info'); return; }
      this._run(() => cancelReceipt(this._id));
      return;
    }
    if (e.target.closest('[data-finalize]')) {
      const s = this._state.summary;
      if (!window.confirm(t('adminReceiving.finalizeConfirm', { units: formatNumber(s.receivedUnits) }))) {
        showToast(t('admin.actionCancelled'), 'info');
        return;
      }
      this._run(() => finalizeReceipt(this._id, [...this._excluded]), {
        ok: (st) => t('adminReceiving.finalized', { units: formatNumber(st.finalized ? st.finalized.units : 0) }),
      });
    }
  }
}
