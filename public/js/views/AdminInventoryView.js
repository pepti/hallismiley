// AdminInventoryView — Birgðavakt / Inventory Watch (/admin/inventory).
// Ported from icelandicstore #13 (AdminInventoryView.js) and #15 (its own
// load-error message, the stricter count check), harvest 2 lane 6a, onto the
// engine's admin kit: sortableTh/bindSortable headers, admin-chips filters,
// listState deep links, stickyHScroll, formatNumber.
//
// One row per stocked unit — a product without variants, or one variant — with
// the three numbers (On hand · Committed · Available, models/Inventory.js),
// units sold in the last 90 days, months of cover and a status bucket
// (utils/inventoryStatus.js on the server). The whole report is one payload;
// search, the status filter (?status=, deep-linkable), the needs-attention
// scope and the sort are client-side. "Fix stock" opens an inline panel that
// PATCHes an absolute count, audited server-side through Inventory.correct.
// Engine difference: a count is a whole number ≥ 0 (stock >= 0 is kept).
import { canSeeView } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { sortableTh, cycleSort, bindSortable } from '../components/adminTable.js';
import { readListState, syncListState } from '../utils/listState.js';
import { attachStickyHScroll } from '../utils/stickyHScroll.js';
import { formatNumber } from '../utils/format.js';
import { getInventoryReport, correctStock } from '../services/adminInventory.js';
import { stockTabsHtml, unitName, REASONS, MAX_STOCK, parseCount } from '../utils/stockUnits.js';

const STATUSES = ['out', 'critical', 'low', 'watch', 'ok'];
const SEVERITY = { out: 0, critical: 1, low: 2, watch: 3, ok: 4 };
const DEFAULTS = { status: '', q: '', scope: 'needs', sort: 'status', dir: 'asc' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class AdminInventoryView {
  constructor() {
    const st = readListState(DEFAULTS);
    this._status = STATUSES.includes(st.status) ? st.status : '';
    this._q = st.q || '';
    this._scope = st.scope === 'all' ? 'all' : 'needs';
    this._sort = { field: st.sort || 'status', dir: st.dir === 'desc' ? 'desc' : 'asc' };
    this._report = null;
    this._openKey = null;
    this._gen = 0;
    this._destroyed = false;
    this._detach = [];
    this._onClick = this._onClick.bind(this);
    this._onInput = this._onInput.bind(this);
  }

  async render() {
    if (!canSeeView('inventory')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'main admin-page stock-page';
    el.innerHTML = `
      <div class="admin-header">
        <div>
          <p class="admin-eyebrow">${t('admin.navGroup.shop')}</p>
          <h1 class="admin-title">${t('adminInventory.title')}</h1>
        </div>
      </div>
      ${stockTabsHtml('inventory')}
      <p class="stock-intro">${t('adminInventory.intro')}</p>
      <div class="admin-chips stock-chips" data-chips role="group" aria-label="${escHtml(t('adminInventory.filterLabel'))}"></div>
      <div class="admin-toolbar stock-toolbar">
        <input type="search" class="form-input admin-search" data-search
               placeholder="${escHtml(t('adminInventory.searchPlaceholder'))}"
               aria-label="${escHtml(t('adminInventory.searchPlaceholder'))}"
               autocomplete="off" value="${escHtml(this._q)}" />
        <div class="admin-chips" role="group" aria-label="${escHtml(t('adminInventory.scopeLabel'))}" data-scopes></div>
      </div>
      <div class="admin-table-wrap" data-table><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    el.addEventListener('click', this._onClick);
    el.addEventListener('input', this._onInput);
    const wrap = el.querySelector('[data-table]');
    this._detach.push(bindSortable(wrap, (field) => {
      this._sort = cycleSort(this._sort, field);
      this._openKey = null;
      this._syncUrl();
      this._paintTable();
    }));
    const sticky = attachStickyHScroll(wrap, { label: t('adminInventory.title') });
    if (sticky && sticky.detach) this._detach.push(() => sticky.detach());
    this._load();
    return renderAdminShell({ activePath: '/admin/inventory', content: el });
  }

  destroy() {
    this._destroyed = true;
    for (const d of this._detach) { try { d(); } catch { /* already gone */ } }
    this._detach = [];
    if (this._el) {
      this._el.removeEventListener('click', this._onClick);
      this._el.removeEventListener('input', this._onInput);
    }
  }

  _syncUrl() {
    syncListState(href('/admin/inventory'), {
      status: this._status, q: this._q, scope: this._scope, sort: this._sort.field, dir: this._sort.dir,
    }, DEFAULTS);
  }

  async _load() {
    const gen = ++this._gen;
    try {
      const report = await getInventoryReport();
      if (gen !== this._gen || this._destroyed) return;
      this._report = report || { items: [], counts: {}, total: 0 };
      this._paintChips();
      this._paintScopes();
      this._paintTable();
    } catch {
      if (gen !== this._gen || this._destroyed) return;
      // Its own message (ice #15): a generic "could not load" read as a
      // network fault when the report query was the thing that failed.
      this._el.querySelector('[data-table]').innerHTML = `
        <p class="admin-error">${t('adminInventory.loadError')}
          <button type="button" class="btn btn--sm btn--outline admin-error__retry" data-retry>${t('adminInventory.retry')}</button>
        </p>`;
    }
  }

  // ── filtering / sorting ─────────────────────────────────────────────────────
  _visible() {
    const q = this._q.trim().toLowerCase();
    const items = (this._report.items || []).filter((it) => {
      if (this._status) { if (it.status !== this._status) return false; }
      else if (this._scope === 'needs' && it.status === 'ok') return false;
      if (q) {
        const hay = `${unitName(it)} ${it.sku || ''} ${it.bin || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const { field, dir } = this._sort;
    const sign = dir === 'asc' ? 1 : -1;
    const cover = (it) => (it.cover_months == null ? Infinity : it.cover_months);
    return items.sort((a, b) => {
      let d;
      switch (field) {
        case 'name':      d = collator.compare(unitName(a), unitName(b)); break;
        case 'bin':       d = collator.compare(a.bin || '~', b.bin || '~'); break;
        case 'onhand':    d = a.on_hand - b.on_hand; break;
        case 'committed': d = a.committed - b.committed; break;
        case 'available': d = a.available - b.available; break;
        case 'sold':      d = a.units_window - b.units_window; break;
        case 'cover':     d = cover(a) - cover(b); break;
        default:          d = SEVERITY[a.status] - SEVERITY[b.status];
      }
      // Fastest-selling first inside a tie, whichever way the column runs.
      if (d === 0) return b.units_window - a.units_window;
      return d * sign;
    });
  }

  // ── paint ───────────────────────────────────────────────────────────────────
  _paintChips() {
    const c = (this._report && this._report.counts) || {};
    this._el.querySelector('[data-chips]').innerHTML = STATUSES.map((s) => `
      <button type="button" class="admin-chip stock-chip stock-chip--${s}" data-chip="${s}" aria-pressed="${this._status === s}">
        <span class="stock-dot stock-dot--${s}" aria-hidden="true"></span>${escHtml(t('adminInventory.status.' + s))}
        <span class="admin-chip__n">${formatNumber(c[s] || 0)}</span>
      </button>`).join('');
  }

  _paintScopes() {
    const on = (s) => !this._status && this._scope === s;
    this._el.querySelector('[data-scopes]').innerHTML = `
      <button type="button" class="admin-chip" data-scope="needs" aria-pressed="${on('needs')}">${t('adminInventory.needsAttention')}</button>
      <button type="button" class="admin-chip" data-scope="all" aria-pressed="${on('all')}">${t('adminInventory.showAll')}</button>`;
  }

  _paintTable() {
    if (!this._report) return;
    const wrap = this._el.querySelector('[data-table]');
    const rows = this._visible();
    const s = this._sort;
    const head = `<tr>
      ${sortableTh(t('adminInventory.colProduct'), 'name', s)}
      ${sortableTh(t('adminInventory.colBin'), 'bin', s)}
      ${sortableTh(t('adminInventory.colOnHand'), 'onhand', s)}
      ${sortableTh(t('adminInventory.colCommitted'), 'committed', s)}
      ${sortableTh(t('adminInventory.colAvailable'), 'available', s)}
      ${sortableTh(t('adminInventory.colSold'), 'sold', s)}
      ${sortableTh(t('adminInventory.colCover'), 'cover', s)}
      ${sortableTh(t('adminInventory.colStatus'), 'status', s)}
      <th scope="col" class="admin-table__actions-col"><span class="sr-only">${t('adminInventory.colActions')}</span></th>
    </tr>`;
    if (!rows.length) {
      const empty = (this._report.items || []).length ? t('adminInventory.emptyFiltered') : t('adminInventory.empty');
      wrap.innerHTML = `<table class="admin-table stock-table"><thead>${head}</thead>
        <tbody><tr><td colspan="9" class="admin-state">${escHtml(empty)}</td></tr></tbody></table>`;
      return;
    }
    wrap.innerHTML = `<table class="admin-table stock-table"><thead>${head}</thead>
      <tbody>${rows.map(it => this._row(it)).join('')}</tbody></table>`;
  }

  _row(it) {
    const open = this._openKey === it.key;
    const cover = it.cover_months == null ? '—' : formatNumber(Math.round(it.cover_months * 10) / 10);
    const main = `<tr class="stock-row${open ? ' is-open' : ''}" data-key="${escHtml(it.key)}">
      <td class="stock-c-name">
        <span class="stock-name">${escHtml(unitName(it))}</span>
        ${it.sku ? `<span class="stock-sku">${escHtml(it.sku)}</span>` : ''}
      </td>
      <td>${it.bin ? `<span class="stock-bin">${escHtml(it.bin)}</span>` : '<span class="stock-muted">—</span>'}</td>
      <td class="stock-num">${formatNumber(it.on_hand)}</td>
      <td class="stock-num stock-muted">${formatNumber(it.committed)}</td>
      <td class="stock-num${it.available <= 0 ? ' stock-num--zero' : ''}">${formatNumber(it.available)}</td>
      <td class="stock-num">${formatNumber(it.units_window)}</td>
      <td class="stock-num stock-muted">${escHtml(cover)}</td>
      <td><span class="stock-pill stock-pill--${it.status}">${escHtml(t('adminInventory.status.' + it.status))}</span></td>
      <td class="admin-table__actions">
        <button type="button" class="btn btn--sm btn--outline" data-fix="${escHtml(it.key)}" aria-expanded="${open}">${t('adminInventory.fixStock')}</button>
      </td>
    </tr>`;
    return open ? main + this._fixRow(it) : main;
  }

  _fixRow(it) {
    const reasons = REASONS.map(r => `<option value="${r}">${escHtml(t('adminInventory.reason.' + r))}</option>`).join('');
    const id = `fix-${it.key.replace(/[^a-z0-9]/gi, '')}`;
    return `<tr class="stock-fix-row"><td colspan="9">
      <form class="stock-fix" data-fix-form="${escHtml(it.key)}" novalidate>
        <p class="stock-fix__title">${escHtml(t('adminInventory.fixTitle', { name: unitName(it) }))}</p>
        <dl class="stock-fix__now">
          <div><dt>${t('adminInventory.colOnHand')}</dt><dd>${formatNumber(it.on_hand)}</dd></div>
          <div><dt>${t('adminInventory.colCommitted')}</dt><dd>${formatNumber(it.committed)}</dd></div>
          <div><dt>${t('adminInventory.colAvailable')}</dt><dd>${formatNumber(it.available)}</dd></div>
        </dl>
        <div class="stock-fix__fields">
          <label class="form-label" for="${id}-n">${t('adminInventory.newCount')}
            <input id="${id}-n" class="form-input form-input--sm" type="number" min="0" step="1" max="${MAX_STOCK}"
                   inputmode="numeric" data-fix-count value="${Number(it.on_hand) || 0}" required />
          </label>
          <label class="form-label" for="${id}-r">${t('adminInventory.reasonLabel')}
            <select id="${id}-r" class="form-input form-input--sm" data-fix-reason>${reasons}</select>
          </label>
          <label class="form-label stock-fix__note" for="${id}-t">${t('adminInventory.noteLabel')}
            <input id="${id}-t" class="form-input form-input--sm" type="text" maxlength="500" data-fix-note />
          </label>
        </div>
        <div class="stock-fix__actions">
          <button type="submit" class="btn btn--sm btn--primary" data-fix-save>${t('adminInventory.save')}</button>
          <button type="button" class="btn btn--sm btn--ghost" data-fix-close>${t('adminInventory.close')}</button>
        </div>
      </form>
    </td></tr>`;
  }

  // ── events ────────────────────────────────────────────────────────────────
  _onInput(e) {
    if (!e.target.closest('[data-search]')) return;
    this._q = e.target.value || '';
    this._openKey = null;
    this._syncUrl();
    this._paintTable();
  }

  _onClick(e) {
    if (e.target.closest('[data-retry]')) { this._load(); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      this._status = this._status === chip.dataset.chip ? '' : chip.dataset.chip;
      this._openKey = null;
      this._syncUrl(); this._paintChips(); this._paintScopes(); this._paintTable();
      return;
    }
    const scope = e.target.closest('[data-scope]');
    if (scope) {
      this._scope = scope.dataset.scope;
      this._status = '';
      this._openKey = null;
      this._syncUrl(); this._paintChips(); this._paintScopes(); this._paintTable();
      return;
    }
    const fix = e.target.closest('[data-fix]');
    if (fix) {
      this._openKey = this._openKey === fix.dataset.fix ? null : fix.dataset.fix;
      this._paintTable();
      if (this._openKey) {
        const input = this._el.querySelector('[data-fix-count]');
        if (input) { input.focus(); input.select(); }
      }
      return;
    }
    if (e.target.closest('[data-fix-close]')) { this._openKey = null; this._paintTable(); return; }
    const save = e.target.closest('[data-fix-save]');
    if (save) { e.preventDefault(); this._save(save.closest('[data-fix-form]')); }
  }

  async _save(form) {
    if (!form) return;
    const key = form.dataset.fixForm;
    const it = (this._report.items || []).find(i => i.key === key);
    if (!it) return;
    const parsed = parseCount(form.querySelector('[data-fix-count]').value);
    if (parsed.error) {
      showToast(t(parsed.error === 'tooLarge' ? 'adminInventory.countTooLarge' : 'adminInventory.invalidCount',
        { max: formatNumber(MAX_STOCK) }), 'error');
      return;
    }
    const btn = form.querySelector('[data-fix-save]');
    btn.disabled = true;
    try {
      const out = await correctStock({
        productId: it.product_id,
        variantId: it.variant_id || undefined,
        stock: parsed.value,
        reason: form.querySelector('[data-fix-reason]').value,
        note: form.querySelector('[data-fix-note]').value.trim() || undefined,
      });
      if (this._destroyed) return;
      showToast(out.delta
        ? t('adminInventory.saved', { name: unitName(it), from: formatNumber(out.previous), to: formatNumber(out.stock) })
        : t('adminInventory.unchanged'), 'success');
      this._openKey = null;
      await this._load();
    } catch (err) {
      if (this._destroyed) return;
      const lineMsg = err.lines && err.lines[0] && err.lines[0].message;
      showToast(lineMsg || err.message || t('adminInventory.saveError'), 'error');
      btn.disabled = false;
    }
  }
}
