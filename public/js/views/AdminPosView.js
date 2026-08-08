// AdminPosView (/admin/books/pos) — sölukassi.
//
// A till has one job and a person waiting while it does it, so this screen is built
// around a single rule: nothing is committed until "Ganga frá sölu", and then everything
// is committed at once. There is no "start a sale" call and no server-side basket. The
// basket lives here, in the page, and the sale is one request.
//
// That is not a shortcut. A half-open transaction at a counter means a receipt printed
// with no entry posted, or cash in the drawer against no document, and unlike every
// other screen in these books nobody comes back later to reconcile a till.
//
// The totals shown while ringing up are computed HERE as well as on the server, from the
// same rule — VAT extracted from the price, never added to it. Two implementations of
// arithmetic is normally a smell; here the alternative is a customer watching a spinner
// after every scan. The server's figures are authoritative and the receipt shows those;
// if they ever disagreed the sale would still be right, and the display wrong.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchPosCatalogue, fetchPosDay, fetchPosReceipts, ringUpSale, receiptPdfUrl, posCsvUrl,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk, statTile, errorBanner } from './booksShared.js';

const TENDERS = ['cash', 'card'];
const VAT_RATES = [24, 11, 0];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// The same extraction the server does. Integer arithmetic, rounded once — matching
// server/utils/vat.js splitVatInclusive so the preview cannot drift by a króna.
function splitInclusive(gross, rate) {
  const g = Math.round(Number(gross) || 0);
  const r = Number(rate) || 0;
  if (r === 0) return { net: g, vat: 0 };
  const vat = Math.round((g * r) / (100 + r));
  return { net: g - vat, vat };
}

export class AdminPosView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._busy = false;
    this._catalogue = [];
    // The basket: [{ key, productId, description, quantity, unitPriceGross, vatRate, isService }]
    this._basket = [];
    this._tender = 'cash';
    this._day = null;
    this._receipts = [];
    this._lastReceipt = null;
    this._nextKey = 1;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('pos')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.pos.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.pos.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(posCsvUrl())}">
            ${escHtml(t('adminBooks.exportCsv'))}
          </a>
        </div>
      </div>
      <div id="pos-day"></div>
      ${isAdmin() ? `
        <div class="books-pos">
          <div class="books-pos__catalogue">
            <label class="books-pos__search">${escHtml(t('adminBooks.pos.search'))}
              <input type="search" id="pos-search" autocomplete="off"
                     placeholder="${escHtml(t('adminBooks.pos.searchPlaceholder'))}" />
            </label>
            <div id="pos-products" class="books-pos__products"></div>
            <details class="books-pos__freeform">
              <summary>${escHtml(t('adminBooks.pos.freeLine'))}</summary>
              <form id="pos-free" class="books-form">
                <p class="admin-shop__hint">${escHtml(t('adminBooks.pos.freeLineHint'))}</p>
                <label>${escHtml(t('adminBooks.col.description'))}
                  <input type="text" name="description" maxlength="300" required />
                </label>
                <div class="books-form__row">
                  <label>${escHtml(t('adminBooks.pos.priceWithVat'))}
                    <input type="number" name="price" min="1" step="1" required />
                  </label>
                  <label>${escHtml(t('adminBooks.col.vatRate'))}
                    <select name="vat_rate">
                      ${VAT_RATES.map(r => `<option value="${r}">${r}%</option>`).join('')}
                    </select>
                  </label>
                  <label class="books-check">
                    <input type="checkbox" name="is_service" />
                    ${escHtml(t('adminBooks.pos.isService'))}
                  </label>
                  <button type="submit" class="btn btn--ghost btn--sm">
                    ${escHtml(t('adminBooks.pos.addLine'))}
                  </button>
                </div>
              </form>
            </details>
          </div>
          <div class="books-pos__basket">
            <h3>${escHtml(t('adminBooks.pos.basket'))}</h3>
            <div id="pos-basket"></div>
          </div>
        </div>` : ''}
      <h3>${escHtml(t('adminBooks.pos.recent'))}</h3>
      <div id="pos-receipts"></div>
    `;

    if (isAdmin()) this._wireTill();
    await this._loadAll();
    return renderAdminShell({ activePath: '/admin/books/pos', content: this._el });
  }

  async _loadAll() {
    const gen = ++this._generation;
    try {
      const [day, receipts, catalogue] = await Promise.all([
        fetchPosDay({}),
        fetchPosReceipts({ limit: 20 }),
        isAdmin() ? fetchPosCatalogue() : Promise.resolve({ products: [] }),
      ]);
      if (gen !== this._generation) return;
      this._day = day;
      this._receipts = receipts.receipts;
      this._catalogue = catalogue.products;
      this._paintDay();
      this._paintReceipts();
      if (isAdmin()) {
        this._paintCatalogue();
        this._paintBasket();
      }
    } catch (err) {
      if (gen !== this._generation) return;
      this._el.querySelector('#pos-day').innerHTML = errorBanner(err.message);
    }
  }

  // ── The day ────────────────────────────────────────────────────────────────

  _paintDay() {
    const d = this._day;
    if (!d) return;
    const byMethod = Object.fromEntries(d.by_tender.map(x => [x.method, x]));
    const tiles = [
      statTile({
        label: t('adminBooks.pos.cashDrawer'),
        value: isk((byMethod.cash && byMethod.cash.gross) || 0),
        // The point of splitting by tender: this figure is checkable against the drawer.
        hint: t('adminBooks.pos.cashHint', { count: (byMethod.cash && byMethod.cash.sales) || 0 }),
      }),
      statTile({
        label: t('adminBooks.pos.cardTakings'),
        value: isk((byMethod.card && byMethod.card.gross) || 0),
        hint: t('adminBooks.pos.cardHint', { count: (byMethod.card && byMethod.card.sales) || 0 }),
      }),
      statTile({
        label: t('adminBooks.pos.dayTotal'),
        value: isk(d.total_gross),
        hint: t('adminBooks.pos.dayTotalHint'),
      }),
    ];
    if (d.credited) {
      tiles.push(statTile({
        label: t('adminBooks.pos.credited'),
        value: isk(d.credited),
        hint: t('adminBooks.pos.creditedHint'),
        tone: 'warn',
      }));
    }
    const vatRows = d.by_rate.length ? `
      <table class="admin-table books-table books-table--tight">
        <thead><tr>
          <th>${escHtml(t('adminBooks.col.vatRate'))}</th>
          <th class="num">${escHtml(t('adminBooks.detail.netTotal'))}</th>
          <th class="num">${escHtml(t('adminBooks.col.vat'))}</th>
          <th class="num">${escHtml(t('adminBooks.col.gross'))}</th>
        </tr></thead>
        <tbody>
          ${d.by_rate.map(r => `
            <tr>
              <td>${r.rate}%</td>
              <td class="num">${escHtml(isk(r.net))}</td>
              <td class="num">${escHtml(isk(r.vat))}</td>
              <td class="num">${escHtml(isk(r.gross))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="admin-shop__hint">${escHtml(t('adminBooks.pos.vatHint'))}</p>` : '';

    this._el.querySelector('#pos-day').innerHTML = `
      <h3>${escHtml(t('adminBooks.pos.today', { date: d.range.from }))}</h3>
      <div class="books-stats">${tiles.join('')}</div>
      ${vatRows}`;
  }

  // ── Catalogue ──────────────────────────────────────────────────────────────

  _paintCatalogue(filter = '') {
    const q = filter.trim().toLowerCase();
    const shown = q
      ? this._catalogue.filter(p => p.name.toLowerCase().includes(q)
        || (p.sku || '').toLowerCase().includes(q))
      : this._catalogue;
    const host = this._el.querySelector('#pos-products');
    if (!host) return;
    host.innerHTML = shown.length
      ? shown.slice(0, 60).map(p => `
          <button type="button" class="books-pos__tile" data-add="${escHtml(p.id)}">
            <span class="books-pos__tile-name">${escHtml(p.name)}</span>
            <span class="books-pos__tile-price">${escHtml(isk(p.price_isk))}</span>
            <span class="books-pos__tile-vat">${
  p.vat_rate === null ? escHtml(t('adminBooks.pos.noRate')) : `${p.vat_rate}%`}</span>
          </button>`).join('')
      : `<p class="admin-empty">${escHtml(t('adminBooks.pos.noProducts'))}</p>`;
  }

  // ── Basket ─────────────────────────────────────────────────────────────────

  _basketTotals() {
    const byRate = new Map();
    let gross = 0;
    let vat = 0;
    for (const l of this._basket) {
      const lineGross = l.unitPriceGross * l.quantity;
      const split = splitInclusive(lineGross, l.vatRate);
      gross += lineGross;
      vat += split.vat;
      const bucket = byRate.get(l.vatRate) || { rate: l.vatRate, net: 0, vat: 0, gross: 0 };
      bucket.net += split.net;
      bucket.vat += split.vat;
      bucket.gross += lineGross;
      byRate.set(l.vatRate, bucket);
    }
    return {
      gross, vat, net: gross - vat,
      byRate: [...byRate.values()].sort((a, b) => b.rate - a.rate),
    };
  }

  _paintBasket() {
    const host = this._el.querySelector('#pos-basket');
    if (!host) return;
    if (!this._basket.length) {
      host.innerHTML = `
        <p class="admin-empty">${escHtml(t('adminBooks.pos.emptyBasket'))}</p>
        ${this._lastReceipt ? this._lastReceiptHtml() : ''}`;
      return;
    }
    const totals = this._basketTotals();
    host.innerHTML = `
      <table class="admin-table books-table books-table--tight">
        <tbody>
          ${this._basket.map(l => `
            <tr>
              <td>
                ${escHtml(l.description)}
                <span class="books-pos__rate">${l.vatRate}%</span>
              </td>
              <td class="num">
                <button type="button" class="books-pos__qty" data-less="${l.key}"
                        aria-label="${escHtml(t('adminBooks.pos.fewer'))}">−</button>
                ${l.quantity}
                <button type="button" class="books-pos__qty" data-more="${l.key}"
                        aria-label="${escHtml(t('adminBooks.pos.more'))}">+</button>
              </td>
              <td class="num">${escHtml(isk(l.unitPriceGross * l.quantity))}</td>
              <td><button type="button" class="btn btn--ghost btn--sm" data-drop="${l.key}"
                          aria-label="${escHtml(t('adminBooks.ledger.removeLine'))}">×</button></td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          ${totals.byRate.map(r => `
            <tr class="books-pos__vat">
              <th colspan="2">${escHtml(t('adminBooks.detail.vatAtRate', { rate: r.rate }))}</th>
              <th class="num">${escHtml(isk(r.vat))}</th>
              <th></th>
            </tr>`).join('')}
          <tr>
            <th colspan="2">${escHtml(t('adminBooks.detail.netTotal'))}</th>
            <th class="num">${escHtml(isk(totals.net))}</th>
            <th></th>
          </tr>
          <tr class="books-pos__total">
            <th colspan="2">${escHtml(t('adminBooks.pos.toPay'))}</th>
            <th class="num">${escHtml(isk(totals.gross))}</th>
            <th></th>
          </tr>
        </tfoot>
      </table>

      <form id="pos-finish" class="books-form">
        <div class="books-form__row">
          <label>${escHtml(t('adminBooks.detail.method'))}
            <select name="tender">
              ${TENDERS.map(x => `<option value="${x}"${x === this._tender ? ' selected' : ''}>${
  escHtml(t(`adminBooks.method.${x}`))}</option>`).join('')}
            </select>
          </label>
          <label>${escHtml(t('adminBooks.pos.buyerName'))}
            <input type="text" name="customer_name" maxlength="200"
                   placeholder="${escHtml(t('adminBooks.pos.buyerOptional'))}" />
          </label>
          <label>${escHtml(t('adminBooks.detail.kennitala'))}
            <input type="text" name="customer_kennitala" maxlength="20"
                   placeholder="${escHtml(t('adminBooks.pos.ktOptional'))}" />
          </label>
        </div>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.pos.buyerHint'))}</p>
        <div class="books-form__row">
          <button type="submit" class="btn" id="pos-finish-btn">
            ${escHtml(t('adminBooks.pos.finish', { amount: isk(totals.gross) }))}
          </button>
          <button type="button" class="btn btn--ghost" id="pos-clear">
            ${escHtml(t('adminBooks.pos.clear'))}
          </button>
        </div>
      </form>
      ${this._lastReceipt ? this._lastReceiptHtml() : ''}`;

    const form = host.querySelector('#pos-finish');
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); this._finish(form); });
      form.elements.tender.addEventListener('change', (e) => { this._tender = e.target.value; });
    }
    const clear = host.querySelector('#pos-clear');
    if (clear) {
      clear.addEventListener('click', () => {
        this._basket = [];
        this._paintBasket();
      });
    }
  }

  _lastReceiptHtml() {
    const r = this._lastReceipt;
    return `
      <div class="books-banner books-banner--ok" role="status">
        <strong>${escHtml(t('adminBooks.pos.sold', {
    number: r.invoice_number, amount: isk(r.total_gross),
  }))}</strong>
        <a class="btn btn--ghost btn--sm" target="_blank" rel="noopener"
           href="${escHtml(receiptPdfUrl(r.id))}">
          ${escHtml(t('adminBooks.pos.printReceipt'))}
        </a>
      </div>`;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  _wireTill() {
    const search = this._el.querySelector('#pos-search');
    if (search) {
      search.addEventListener('input', () => this._paintCatalogue(search.value));
    }

    this._el.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) { this._addProduct(add.dataset.add); return; }
      const more = e.target.closest('[data-more]');
      if (more) { this._changeQty(Number(more.dataset.more), 1); return; }
      const less = e.target.closest('[data-less]');
      if (less) { this._changeQty(Number(less.dataset.less), -1); return; }
      const drop = e.target.closest('[data-drop]');
      if (drop) {
        this._basket = this._basket.filter(l => l.key !== Number(drop.dataset.drop));
        this._paintBasket();
      }
    });

    const free = this._el.querySelector('#pos-free');
    if (free) {
      free.addEventListener('submit', (e) => {
        e.preventDefault();
        const price = Number(free.elements.price.value);
        if (!Number.isInteger(price) || price <= 0) {
          showToast(t('adminBooks.pos.badPrice'), 'error');
          return;
        }
        this._basket.push({
          key: this._nextKey++,
          productId: null,
          description: free.elements.description.value.trim(),
          quantity: 1,
          unitPriceGross: price,
          vatRate: Number(free.elements.vat_rate.value),
          isService: free.elements.is_service.checked,
        });
        free.reset();
        this._paintBasket();
      });
    }
  }

  _addProduct(id) {
    const p = this._catalogue.find(x => x.id === id);
    if (!p) return;
    if (p.vat_rate === null) {
      // A till cannot ask questions, and guessing 24% for a book is the wrong tax.
      showToast(t('adminBooks.pos.productNoRate', { name: p.name }), 'error');
      return;
    }
    const existing = this._basket.find(l => l.productId === id
      && l.unitPriceGross === p.price_isk);
    if (existing) existing.quantity += 1;
    else {
      this._basket.push({
        key: this._nextKey++,
        productId: p.id,
        description: p.name,
        quantity: 1,
        unitPriceGross: p.price_isk,
        vatRate: p.vat_rate,
        isService: p.is_service,
      });
    }
    this._paintBasket();
  }

  _changeQty(key, delta) {
    const line = this._basket.find(l => l.key === key);
    if (!line) return;
    line.quantity += delta;
    if (line.quantity < 1) this._basket = this._basket.filter(l => l.key !== key);
    this._paintBasket();
  }

  async _finish(form) {
    if (this._busy || !this._basket.length) return;
    this._busy = true;
    const button = form.querySelector('#pos-finish-btn');
    if (button) button.disabled = true;
    try {
      const { receipt } = await ringUpSale({
        tender: form.elements.tender.value,
        sold_at: isoToday(),
        customer_name: form.elements.customer_name.value.trim(),
        customer_kennitala: form.elements.customer_kennitala.value.trim() || null,
        lines: this._basket.map(l => ({
          product_id: l.productId,
          description: l.description,
          quantity: l.quantity,
          unit_price_gross: l.unitPriceGross,
          vat_rate: l.vatRate,
          is_service: l.isService,
        })),
      });
      // Cleared only after the server has confirmed. Clearing optimistically would lose
      // the basket if the request failed, with a customer standing there.
      this._basket = [];
      this._lastReceipt = {
        id: receipt.id,
        invoice_number: receipt.invoice_number,
        total_gross: Number(receipt.total_gross),
      };
      showToast(t('adminBooks.pos.sold', {
        number: receipt.invoice_number, amount: isk(receipt.total_gross),
      }), 'success');
      await this._loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
      if (button) button.disabled = false;
    }
  }

  // ── Recent receipts ────────────────────────────────────────────────────────

  _paintReceipts() {
    const host = this._el.querySelector('#pos-receipts');
    if (!host) return;
    host.innerHTML = this._receipts.length
      ? `<table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.col.number'))}</th>
            <th>${escHtml(t('adminBooks.col.date'))}</th>
            <th>${escHtml(t('adminBooks.detail.method'))}</th>
            <th>${escHtml(t('adminBooks.col.customer'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.vat'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.gross'))}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${this._receipts.map(r => `
              <tr>
                <td>${escHtml(String(r.invoice_number))}</td>
                <td>${escHtml(r.issued_at)}</td>
                <td>${escHtml(r.tender ? t(`adminBooks.method.${r.tender}`) : '—')}</td>
                <td>${escHtml(r.customer_name)}</td>
                <td class="num">${escHtml(isk(r.vat_total))}</td>
                <td class="num">${escHtml(isk(r.total_gross))}${
  r.amount_credited ? ` <span class="books-pill books-pill--muted">${
    escHtml(t('adminBooks.detail.credited'))}</span>` : ''}</td>
                <td><a class="btn btn--ghost btn--sm" target="_blank" rel="noopener"
                       href="${escHtml(receiptPdfUrl(r.id))}">
                  ${escHtml(t('adminBooks.detail.downloadPdf'))}
                </a></td>
              </tr>`).join('')}
          </tbody>
        </table>`
      : `<p class="admin-empty">${escHtml(t('adminBooks.pos.noSales'))}</p>`;
  }

  destroy() {
    this._generation++;
    this._el = null;
  }
}
