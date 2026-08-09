// AdminBinsView (/admin/bins) — the BIN System: a visual board of warehouse
// stock. Zone chips → a derived grid of bin cells (occupied / multi / free) →
// click a bin to see its products → Move them between bins. A search box (with
// an optional barcode scanner) resolves a SKU / barcode / BIN / product name.
// The "Queue" badge lists unbinned items; "Mismatches" lists malformed codes.
//
// Greenfield view modelled on Orri's "Workshop" BIN System tool, adapted to this
// app's dark admin theme. Mirrors AdminRolesView's class/shell/modal patterns.
import { isAuthenticated } from '../services/auth.js';
import {
  getBoard, getZone, getBinItems, getQueue, getMismatches,
  lookupCode, searchBins, moveItem,
} from '../services/adminBins.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { BarcodeScanner } from '../components/BarcodeScanner.js';

export class AdminBinsView {
  constructor() {
    this._el = null;
    this._zones = [];        // [{ zone, bins, items }]
    this._summary = { bins: 0, items: 0, queue: 0, mismatches: 0 };
    this._activeZone = null;
    this._activeBin = null;
    this._scanner = null;
    this._searchTimer = null;
  }

  async render() {
    if (!isAuthenticated()) { navigateReplace(href('/')); return document.createTextNode(''); }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-bins';
    this._el.innerHTML = `
      <div class="admin-bins__head">
        <div>
          <h1 class="admin-title">${t('adminBins.title')}</h1>
          <p class="admin-shop__hint">${t('adminBins.subtitle')}</p>
        </div>
        <div class="admin-bins__badges">
          <button type="button" class="admin-bins__badge" data-queue hidden></button>
          <button type="button" class="admin-bins__badge admin-bins__badge--warn" data-mismatch hidden></button>
        </div>
      </div>
      <div class="admin-bins__search">
        <input type="search" id="bin-search" autocomplete="off" spellcheck="false"
               placeholder="${escHtml(t('adminBins.searchPlaceholder'))}" />
        ${BarcodeScanner.isSupported()
          ? `<button type="button" class="btn btn--ghost" id="bin-scan">${t('adminBins.scan')}</button>` : ''}
        <div class="admin-bins__results" id="bin-results" hidden></div>
      </div>
      <div class="admin-bins__zones" id="bin-zones"></div>
      <div class="admin-bins__board">
        <div class="admin-bins__panel" id="bin-panel" hidden></div>
        <div class="admin-bins__grid" id="bin-grid"><div class="admin-loading">${t('form.loading')}</div></div>
      </div>
    `;

    const search = this._el.querySelector('#bin-search');
    search.addEventListener('input', () => this._runSearch(search.value.trim()));
    this._el.querySelector('#bin-scan')?.addEventListener('click', () => this._startScan());
    this._el.querySelector('[data-queue]').addEventListener('click', () => this._openList('queue'));
    this._el.querySelector('[data-mismatch]').addEventListener('click', () => this._openList('mismatches'));

    await this._load();
    return renderAdminShell({ activePath: '/admin/bins', content: this._el });
  }

  // ── data ────────────────────────────────────────────────────────────────────
  async _load() {
    const grid = this._el.querySelector('#bin-grid');
    try {
      const data = await getBoard();
      this._zones = data.zones || [];
      this._summary = data.summary || this._summary;
      this._paintBadges();
      this._paintZones();
      if (this._zones.length) {
        const stillThere = this._zones.some(z => z.zone === this._activeZone);
        await this._selectZone(stillThere ? this._activeZone : this._zones[0].zone);
      } else {
        this._activeZone = null;
        grid.innerHTML = `<p class="admin-bins__empty admin-bins__empty--big">${t('adminBins.zonesEmpty')}</p>`;
      }
    } catch (err) {
      grid.innerHTML = `<p class="admin-error">${escHtml(err.message || t('adminBins.loadError'))}</p>`;
    }
  }

  // ── badges (Queue / Mismatches) ───────────────────────────────────────────────
  _paintBadges() {
    const q = this._el.querySelector('[data-queue]');
    const m = this._el.querySelector('[data-mismatch]');
    q.textContent = t('adminBins.queue', { n: this._summary.queue || 0 });
    q.hidden = false;
    m.textContent = t('adminBins.mismatches', { n: this._summary.mismatches || 0 });
    // Only surface the mismatches badge when there's something wrong.
    m.hidden = !this._summary.mismatches;
  }

  // ── zone chips ────────────────────────────────────────────────────────────────
  _paintZones() {
    const el = this._el.querySelector('#bin-zones');
    el.innerHTML = this._zones.map(z =>
      `<button type="button" class="admin-bins__chip${z.zone === this._activeZone ? ' is-active' : ''}" data-zone="${escHtml(z.zone)}">`
      + `<span class="admin-bins__chip-zone">${escHtml(z.zone)}</span>`
      + `<span class="admin-bins__chip-count">${z.bins}</span></button>`
    ).join('');
    el.querySelectorAll('[data-zone]').forEach(b =>
      b.addEventListener('click', () => this._selectZone(b.dataset.zone)));
  }

  // ── grid ──────────────────────────────────────────────────────────────────────
  async _selectZone(zone) {
    this._activeZone = zone;
    this._closePanel();
    this._el.querySelectorAll('#bin-zones .admin-bins__chip').forEach(c =>
      c.classList.toggle('is-active', c.dataset.zone === zone));
    const grid = this._el.querySelector('#bin-grid');
    grid.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    try {
      const { cells } = await getZone(zone);
      if (!cells || !cells.length) {
        grid.innerHTML = `<p class="admin-bins__empty">${t('adminBins.emptyZone')}</p>`;
        return;
      }
      grid.innerHTML = cells.map(c => {
        const label = c.kind === 'free' ? t('adminBins.free') : this._count(c.count);
        const tag = c.kind === 'free' ? 'span' : 'button';
        return `<${tag} type="button" class="admin-bins__cell admin-bins__cell--${c.kind}"`
          + `${c.kind === 'free' ? '' : ` data-bin="${escHtml(c.bin)}"`}>`
          + `<span class="admin-bins__cell-code">${escHtml(c.bin)}</span>`
          + `<span class="admin-bins__cell-count">${label}</span></${tag}>`;
      }).join('');
      grid.querySelectorAll('[data-bin]').forEach(b =>
        b.addEventListener('click', () => this._openBin(b.dataset.bin)));
    } catch (err) {
      grid.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  // ── bin detail panel ──────────────────────────────────────────────────────────
  async _openBin(bin) {
    this._activeBin = bin;
    const panel = this._el.querySelector('#bin-panel');
    panel.hidden = false;
    panel.innerHTML = `<div class="admin-loading">${t('form.loading')}</div>`;
    this._el.querySelectorAll('#bin-grid .admin-bins__cell').forEach(c =>
      c.classList.toggle('is-open', c.dataset.bin === bin));
    try {
      const { items } = await getBinItems(bin);
      if (!items.length) { this._closePanel(); return; } // moved out from under us
      panel.innerHTML = `
        <div class="admin-bins__panel-head">
          <h2>${t('adminBins.binLabel')} <code>${escHtml(bin)}</code>
            <span class="admin-bins__panel-count">${this._count(items.length)}</span></h2>
          <button type="button" class="admin-bins__panel-close" aria-label="${escHtml(t('adminBins.close'))}">✕</button>
        </div>
        <div class="admin-bins__items">${items.map((it, i) => this._itemRowHtml(it, i)).join('')}</div>`;
      panel.querySelector('.admin-bins__panel-close').addEventListener('click', () => this._closePanel());
      this._wireMoves(panel, items, () => this._refresh());
    } catch (err) {
      panel.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _closePanel() {
    this._activeBin = null;
    const panel = this._el.querySelector('#bin-panel');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    this._el.querySelectorAll('#bin-grid .admin-bins__cell.is-open')
      .forEach(c => c.classList.remove('is-open'));
  }

  // A single product/variant row (detail panel, queue, mismatches, search).
  _itemRowHtml(it, idx) {
    const meta = escHtml(it.sku || it.barcode || '');
    const binHtml = it.bin
      ? `<code class="admin-bins__bincode">${escHtml(it.bin)}</code>`
      : `<span class="admin-bins__nobin">${t('adminBins.noBin')}</span>`;
    return `<div class="admin-bins__item" data-row="${idx}">
      <div class="admin-bins__item-main">
        <span class="admin-bins__item-name">${escHtml(it.name)}</span>
        ${meta ? `<span class="admin-bins__item-meta">${meta}</span>` : ''}
      </div>
      ${binHtml}
      <button type="button" class="btn btn--sm btn--ghost" data-move="${idx}">${t('adminBins.move')}</button>
    </div>`;
  }

  // Wire the Move buttons of a rendered item list. `after` runs post-move (e.g.
  // re-render the list modal); the board/zone always refresh too.
  _wireMoves(container, list, after) {
    container.querySelectorAll('[data-move]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openMove(list[+b.dataset.move], after);
      }));
  }

  // ── move modal ────────────────────────────────────────────────────────────────
  _openMove(item, after) {
    if (!item) return;
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('adminBins.moveTitle')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${escHtml(t('adminBins.close'))}">✕</button>
        </header>
        <form class="admin-shop__form" id="bin-move-form">
          <p class="admin-bins__move-item">${escHtml(item.name)}${item.sku ? ` <span class="admin-bins__item-meta">${escHtml(item.sku)}</span>` : ''}</p>
          <label>${t('adminBins.moveTo')}
            <input type="text" name="bin" autocomplete="off" autocapitalize="characters"
                   placeholder="${escHtml(t('adminBins.movePlaceholder'))}" value="${escHtml(item.bin || '')}" />
          </label>
          <p class="admin-shop__error" id="bin-move-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            ${item.bin ? `<button type="button" class="btn btn--ghost" data-clear>${t('adminBins.clearBin')}</button>` : ''}
            <button type="submit" class="btn btn--primary">${t('adminBins.moveSave')}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    const errorEl = modal.querySelector('#bin-move-error');
    const input = modal.querySelector('input[name="bin"]');
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    input.focus();
    input.select();

    const submit = async (value) => {
      errorEl.textContent = '';
      try {
        await moveItem({ productId: item.productId, variantId: item.variantId, bin: value });
        close();
        showToast(value ? t('adminBins.moved', { bin: value.toUpperCase() }) : t('adminBins.clearBin'), 'success');
        await this._refresh();
        if (after) await after();
      } catch (err) {
        errorEl.textContent = err.message || t('adminBins.moveError');
      }
    };
    modal.querySelector('[data-clear]')?.addEventListener('click', () => submit(''));
    modal.querySelector('#bin-move-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(input.value.trim());
    });
  }

  // ── queue / mismatches list modal ─────────────────────────────────────────────
  _openList(kind) {
    const titleKey = kind === 'queue' ? 'adminBins.queueTitle' : 'adminBins.mismatchesTitle';
    const emptyKey = kind === 'queue' ? 'adminBins.queueEmpty' : 'adminBins.mismatchesEmpty';
    const fetcher  = kind === 'queue' ? getQueue : getMismatches;
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card admin-bins__list-card">
        <header>
          <h2>${t(titleKey)}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${escHtml(t('adminBins.close'))}">✕</button>
        </header>
        <div class="admin-bins__items" id="bin-list-body"><div class="admin-loading">${t('form.loading')}</div></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const body = modal.querySelector('#bin-list-body');
    const refresh = async () => {
      try {
        const { items } = await fetcher();
        if (!items.length) { body.innerHTML = `<p class="admin-bins__empty">${t(emptyKey)}</p>`; return; }
        body.innerHTML = items.map((it, i) => this._itemRowHtml(it, i)).join('');
        this._wireMoves(body, items, refresh);
      } catch (err) {
        body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
      }
    };
    refresh();
  }

  // ── search + scan ─────────────────────────────────────────────────────────────
  _runSearch(q) {
    clearTimeout(this._searchTimer);
    const box = this._el.querySelector('#bin-results');
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    this._searchTimer = setTimeout(async () => {
      try {
        const { results } = await searchBins(q);
        if (!results.length) {
          box.innerHTML = `<p class="admin-bins__empty">${t('adminBins.searchEmpty')}</p>`;
          box.hidden = false; return;
        }
        box.innerHTML = results.map((it, i) => this._itemRowHtml(it, i)).join('');
        box.hidden = false;
        this._wireMoves(box, results, () => this._refresh());
        // Clicking a result's main area jumps to where it lives.
        box.querySelectorAll('[data-row]').forEach(row =>
          row.querySelector('.admin-bins__item-main')?.addEventListener('click', () => {
            this._jumpToItem(results[+row.dataset.row]);
          }));
      } catch (err) {
        box.innerHTML = `<p class="admin-bins__empty">${escHtml(err.message)}</p>`;
        box.hidden = false;
      }
    }, 250);
  }

  _startScan() {
    if (!BarcodeScanner.isSupported()) return;
    const scanner = new BarcodeScanner({ onDetect: (code) => { scanner.close(); this._handleScan(code); } });
    this._scanner = scanner;
    scanner.open();
  }

  async _handleScan(code) {
    const search = this._el.querySelector('#bin-search');
    if (search) search.value = code;
    try {
      const { item } = await lookupCode(code);
      this._jumpToItem(item);
    } catch (err) {
      showToast(err.message || t('adminBins.searchEmpty'), 'error');
    }
  }

  // If the item has a bin, jump to its zone + open it; otherwise offer to assign.
  async _jumpToItem(item) {
    if (!item) return;
    const box = this._el.querySelector('#bin-results');
    if (box) { box.hidden = true; }
    const zone = this._zoneOf(item.bin);
    if (zone && this._zones.some(z => z.zone === zone)) {
      await this._selectZone(zone);
      await this._openBin(item.bin);
    } else {
      this._openMove(item);
    }
  }

  // ── refresh after a write ─────────────────────────────────────────────────────
  async _refresh() {
    const reopen = this._activeBin;
    await this._load();            // board (badges + zones) + re-selects the zone
    if (reopen && this._zones.some(z => z.zone === this._zoneOf(reopen))) {
      await this._openBin(reopen); // re-open the panel (it closes itself if now empty)
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────────
  _count(n) {
    return Number(n) === 1 ? t('adminBins.itemCountOne', { n }) : t('adminBins.itemCount', { n });
  }

  _zoneOf(bin) {
    const m = String(bin || '').trim().match(/^([A-Za-z]+)/);
    return m ? m[1].toUpperCase() : null;
  }

  destroy() {
    clearTimeout(this._searchTimer);
    if (this._scanner) { this._scanner.close(); this._scanner = null; }
  }
}
