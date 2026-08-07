// AdminInvoicesView (/admin/books/invoices) — the invoice register.
//
// Search, filter by derived status, sort, paginate. Every filter round-trips to the
// server: filtering client-side over a partial page silently hides rows, which is
// exactly how an "export all" that only held 200 rows came to look complete in the
// system this replaces.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { fetchInvoices } from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigate, navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { isk, statusPill, errorBanner } from './booksShared.js';

const PAGE_SIZE = 50;
const STATUSES = ['', 'issued', 'part_paid', 'paid', 'overdue', 'credited', 'cancelled'];

export class AdminInvoicesView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._searchTimer = null;
    this._state = { q: '', status: '', sort: 'issued', dir: 'desc', offset: 0, total: 0 };
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('invoices')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.invoices.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.invoices.subtitle'))}</p>
        </div>
      </div>
      <div class="books-filters">
        <input type="search" id="inv-q" autocomplete="off" spellcheck="false"
               placeholder="${escHtml(t('adminBooks.invoices.searchPlaceholder'))}" />
        <select id="inv-status" aria-label="${escHtml(t('adminBooks.invoices.filterStatus'))}">
          ${STATUSES.map(s => `<option value="${escHtml(s)}">${
            escHtml(s ? t(`adminBooks.status.${s}`) : t('adminBooks.invoices.allStatuses'))
          }</option>`).join('')}
        </select>
      </div>
      <div id="inv-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;

    const qInput = this._el.querySelector('#inv-q');
    qInput.addEventListener('input', () => {
      // Debounced so typing does not fire a request per keystroke.
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._state.q = qInput.value.trim();
        this._state.offset = 0;
        this._load();
      }, 250);
    });
    this._el.querySelector('#inv-status').addEventListener('change', (e) => {
      this._state.status = e.target.value;
      this._state.offset = 0;
      this._load();
    });

    // One delegated listener rather than per-row handlers, so re-rendering the
    // table does not leak listeners.
    this._el.addEventListener('click', (e) => {
      const sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) {
        const key = sortBtn.dataset.sort;
        if (this._state.sort === key) {
          this._state.dir = this._state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this._state.sort = key;
          this._state.dir = 'desc';
        }
        this._state.offset = 0;
        this._load();
        return;
      }
      const page = e.target.closest('[data-page]');
      if (page) {
        this._state.offset = Math.max(0, Number(page.dataset.page) || 0);
        this._load();
        return;
      }
      // Let a real link handle itself (modifier-click, middle-click, new tab).
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-invoice-id]');
      if (row) navigate(href(`/admin/books/invoices/${row.dataset.invoiceId}`));
    });

    this._load();
    return renderAdminShell({ activePath: '/admin/books/invoices', content: this._el });
  }

  async _load() {
    const generation = ++this._generation;
    const body = this._el.querySelector('#inv-body');
    body.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    try {
      const data = await fetchInvoices({
        q: this._state.q,
        status: this._state.status,
        sort: this._state.sort,
        dir: this._state.dir,
        limit: PAGE_SIZE,
        offset: this._state.offset,
      });
      if (generation !== this._generation) return;
      this._state.total = data.total;
      body.innerHTML = this._renderTable(data.invoices);
    } catch (err) {
      if (generation !== this._generation) return;
      body.innerHTML = errorBanner(err.message);
    }
  }

  _sortHead(key, labelKey, { num = false } = {}) {
    const active = this._state.sort === key;
    const arrow = active ? (this._state.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th${num ? ' class="num"' : ''}>
      <button type="button" class="books-sort${active ? ' is-active' : ''}" data-sort="${escHtml(key)}">
        ${escHtml(t(labelKey))}${arrow}
      </button></th>`;
  }

  _renderTable(invoices) {
    if (!invoices.length) {
      return `<p class="admin-shop__hint">${escHtml(t('adminBooks.invoices.empty'))}</p>`;
    }
    // The invoice number is a real link, so the row works with the keyboard,
    // middle-click and open-in-new-tab. The whole row stays clickable as a
    // convenience on top of that, not instead of it — a focusable <tr> that Enter
    // does nothing on is worse than no affordance at all.
    const rows = invoices.map(inv => `
      <tr data-invoice-id="${escHtml(inv.id)}">
        <td><a href="${escHtml(href(`/admin/books/invoices/${inv.id}`))}"
               >${escHtml(String(inv.invoice_number))}</a></td>
        <td>${escHtml(inv.issued_at || '')}</td>
        <td>${escHtml(inv.customer_name || '')}</td>
        <td class="num">${escHtml(isk(inv.total_gross))}</td>
        <td class="num">${escHtml(isk(inv.vat_total))}</td>
        <td class="num">${escHtml(isk(inv.outstanding))}</td>
        <td>${statusPill(inv.display_status)}</td>
      </tr>`).join('');

    const from = this._state.offset + 1;
    const to = Math.min(this._state.offset + invoices.length, this._state.total);
    const prev = Math.max(0, this._state.offset - PAGE_SIZE);
    const next = this._state.offset + PAGE_SIZE;
    const pager = `
      <div class="books-pager">
        <span>${escHtml(t('adminBooks.invoices.showing', { from, to, total: this._state.total }))}</span>
        <button type="button" class="btn btn--ghost" data-page="${prev}"
          ${this._state.offset === 0 ? 'disabled' : ''}>${escHtml(t('form.previous'))}</button>
        <button type="button" class="btn btn--ghost" data-page="${next}"
          ${next >= this._state.total ? 'disabled' : ''}>${escHtml(t('form.next'))}</button>
      </div>`;

    return `
      <table class="admin-table books-table books-table--clickable">
        <thead><tr>
          ${this._sortHead('number', 'adminBooks.col.number')}
          ${this._sortHead('issued', 'adminBooks.col.issued')}
          ${this._sortHead('customer', 'adminBooks.col.customer')}
          ${this._sortHead('total', 'adminBooks.col.total', { num: true })}
          <th class="num">${escHtml(t('adminBooks.col.vat'))}</th>
          ${this._sortHead('outstanding', 'adminBooks.col.outstanding', { num: true })}
          <th>${escHtml(t('adminBooks.col.status'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${pager}`;
  }

  destroy() {
    this._generation += 1;
    clearTimeout(this._searchTimer);
  }
}
