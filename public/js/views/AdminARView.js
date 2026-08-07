// AdminARView (/admin/books/ar) — who owes you money, and how late they are.
//
// Buckets are measured from the DUE date, not the invoice date: "31–60" means one
// to two months past when payment was owed, which is the number you act on.
//
// Customers are grouped by a key the server derives — the user id when the buyer
// had an account, otherwise their email. A guest who checked out twice under two
// different addresses therefore shows up twice, which is inherent to an
// email-keyed model and is stated on the page rather than hidden.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { fetchAging, agingCsvUrl } from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigate, navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { isk, statTile, errorBanner } from './booksShared.js';

export class AdminARView {
  constructor() {
    this._el = null;
    this._generation = 0;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('ar')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.ar.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.ar.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(agingCsvUrl())}">
            ${escHtml(t('adminBooks.exportCsv'))}
          </a>
        </div>
      </div>
      <div id="ar-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;

    this._el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-customer-key]');
      if (row) {
        navigate(href(`/admin/books/ar/${encodeURIComponent(row.dataset.customerKey)}`));
      }
    });

    this._load();
    return renderAdminShell({ activePath: '/admin/books/ar', content: this._el });
  }

  async _load() {
    const generation = ++this._generation;
    const body = this._el.querySelector('#ar-body');
    try {
      const { customers, totals } = await fetchAging();
      if (generation !== this._generation) return;
      body.innerHTML = this._renderBody(customers, totals);
    } catch (err) {
      if (generation !== this._generation) return;
      body.innerHTML = errorBanner(err.message);
    }
  }

  _renderBody(customers, totals) {
    if (!customers.length) {
      return `<p class="admin-shop__hint">${escHtml(t('adminBooks.ar.empty'))}</p>`;
    }

    const overdue = totals.d1_30 + totals.d31_60 + totals.d61_90 + totals.d90_plus;
    const tiles = [
      statTile({
        label: t('adminBooks.ar.tileTotal'),
        value: isk(totals.total),
        hint: t('adminBooks.ar.tileTotalHint', { count: customers.length }),
      }),
      statTile({
        label: t('adminBooks.ar.tileOverdue'),
        value: isk(overdue),
        hint: t('adminBooks.ar.tileOverdueHint'),
        tone: overdue > 0 ? 'warn' : '',
      }),
      statTile({
        label: t('adminBooks.ar.tileWorst'),
        value: isk(totals.d90_plus),
        hint: t('adminBooks.ar.tileWorstHint'),
        tone: totals.d90_plus > 0 ? 'warn' : '',
      }),
    ].join('');

    const rows = customers.map(c => `
      <tr data-customer-key="${escHtml(c.customer_key)}">
        <td>
          <a href="${escHtml(href(`/admin/books/ar/${encodeURIComponent(c.customer_key)}`))}"
            >${escHtml(c.customer_name || t('adminBooks.ar.unknownCustomer'))}</a>
          ${c.customer_email ? `<div class="books-muted">${escHtml(c.customer_email)}</div>` : ''}
        </td>
        <td class="num">${escHtml(String(c.open_invoices))}</td>
        <td class="num">${escHtml(isk(c.current))}</td>
        <td class="num">${escHtml(isk(c.d1_30))}</td>
        <td class="num">${escHtml(isk(c.d31_60))}</td>
        <td class="num">${escHtml(isk(c.d61_90))}</td>
        <td class="num">${escHtml(isk(c.d90_plus))}</td>
        <td class="num"><strong>${escHtml(isk(c.total))}</strong></td>
      </tr>`).join('');

    return `
      <div class="books-stats">${tiles}</div>
      <table class="admin-table books-table books-table--clickable">
        <thead><tr>
          <th>${escHtml(t('adminBooks.col.customer'))}</th>
          <th class="num">${escHtml(t('adminBooks.ar.invoices'))}</th>
          <th class="num">${escHtml(t('adminBooks.ar.current'))}</th>
          <th class="num">1–30</th>
          <th class="num">31–60</th>
          <th class="num">61–90</th>
          <th class="num">90+</th>
          <th class="num">${escHtml(t('adminBooks.col.total'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td><strong>${escHtml(t('adminBooks.ar.totals'))}</strong></td>
          <td></td>
          <td class="num">${escHtml(isk(totals.current))}</td>
          <td class="num">${escHtml(isk(totals.d1_30))}</td>
          <td class="num">${escHtml(isk(totals.d31_60))}</td>
          <td class="num">${escHtml(isk(totals.d61_90))}</td>
          <td class="num">${escHtml(isk(totals.d90_plus))}</td>
          <td class="num"><strong>${escHtml(isk(totals.total))}</strong></td>
        </tr></tfoot>
      </table>
      <p class="admin-shop__hint">${escHtml(t('adminBooks.ar.guestNote'))}</p>`;
  }

  destroy() {
    this._generation += 1;
  }
}
