// AdminBooksView (/admin/books) — the Bókhald overview.
//
// This screen answers the three questions an owner-operator actually has, in the
// order they matter: what did I invoice, who owes me, and how much of the money in
// my account is not mine because it is VSK I have collected on the state's behalf.
// The last one is the reason most small Icelandic businesses hit a cash crunch, so
// it gets its own tile rather than being buried in a report.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { fetchDashboard } from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { isk, statTile, readinessBanner, errorBanner } from './booksShared.js';

export class AdminBooksView {
  constructor() {
    this._el = null;
    // Guards against a stale response painting over a newer one when the range is
    // changed twice quickly.
    this._generation = 0;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('books')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.subtitle'))}</p>
        </div>
        <label class="books-range">
          <span>${escHtml(t('adminBooks.range'))}</span>
          <select id="books-range">
            <option value="30">${escHtml(t('adminBooks.range30'))}</option>
            <option value="60" selected>${escHtml(t('adminBooks.range60'))}</option>
            <option value="180">${escHtml(t('adminBooks.range180'))}</option>
            <option value="365">${escHtml(t('adminBooks.range365'))}</option>
          </select>
        </label>
      </div>
      <div id="books-readiness"></div>
      <div id="books-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;

    this._el.querySelector('#books-range').addEventListener('change', (e) => {
      this._load(Number(e.target.value) || 60);
    });
    this._load(60);

    return renderAdminShell({ activePath: '/admin/books', content: this._el });
  }

  async _load(days) {
    const generation = ++this._generation;
    const body = this._el.querySelector('#books-body');
    const readiness = this._el.querySelector('#books-readiness');
    body.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;

    try {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);
      const data = await fetchDashboard({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
      if (generation !== this._generation) return; // a newer request has landed
      readiness.innerHTML = readinessBanner(data.readiness);
      body.innerHTML = this._renderBody(data);
    } catch (err) {
      if (generation !== this._generation) return;
      body.innerHTML = errorBanner(err.message);
    }
  }

  _renderBody(data) {
    const m = data.metrics;
    // VSK collected but not yet remitted. Presented as "not your money" because
    // that is the single most useful framing for someone who is not an accountant.
    const vatOwed = m.output_vat;
    const tiles = [
      statTile({
        label: t('adminBooks.tile.invoiced'),
        value: isk(m.invoiced_gross),
        hint: t('adminBooks.tile.invoicedHint', { count: m.invoices_issued }),
      }),
      statTile({
        label: t('adminBooks.tile.revenueNet'),
        value: isk(m.revenue_net),
        hint: t('adminBooks.tile.revenueNetHint'),
      }),
      statTile({
        label: t('adminBooks.tile.vatOwed'),
        value: isk(vatOwed),
        hint: t('adminBooks.tile.vatOwedHint'),
        tone: vatOwed > 0 ? 'warn' : '',
      }),
      statTile({
        label: t('adminBooks.tile.receivable'),
        value: isk(m.ar_outstanding),
        hint: t('adminBooks.tile.receivableHint'),
      }),
      statTile({
        label: t('adminBooks.tile.overdue'),
        value: isk(m.ar_overdue),
        hint: t('adminBooks.tile.overdueHint', { count: m.ar_overdue_count }),
        tone: m.ar_overdue > 0 ? 'warn' : '',
      }),
    ].join('');

    const rows = (data.timeseries || []).slice(-30).reverse();
    const table = rows.length
      ? `
        <table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.col.date'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.gross'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.vat'))}</th>
          </tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${escHtml(r.day)}</td>
              <td class="num">${escHtml(isk(r.gross))}</td>
              <td class="num">${escHtml(isk(r.vat))}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : `<p class="admin-shop__hint">${escHtml(t('adminBooks.empty'))}</p>`;

    return `
      <div class="books-stats">${tiles}</div>
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.recent'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.recentHint'))}</p>
        ${table}
      </section>
    `;
  }

  destroy() {
    this._generation += 1;
  }
}
