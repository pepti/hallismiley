// AdminStatementView (/admin/books/ar/:customerKey) — one customer's account.
//
// Every charge and credit in date order with a running balance. This is what you
// send someone who asks "what do I actually owe you", and what an accountant reads
// to check the receivables control account against the subledger.
//
// Charges and credits are interleaved chronologically rather than listed as
// invoices-then-payments, because a running balance is only meaningful in the order
// things actually happened.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { fetchStatement } from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { isk, errorBanner } from './booksShared.js';

export class AdminStatementView {
  constructor(customerKey) {
    this._key = customerKey;
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
    this._el.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    this._load();
    return renderAdminShell({ activePath: '/admin/books/ar', content: this._el });
  }

  async _load() {
    const generation = ++this._generation;
    try {
      const { statement } = await fetchStatement(this._key);
      if (generation !== this._generation) return;
      this._el.innerHTML = this._renderBody(statement);
    } catch (err) {
      if (generation !== this._generation) return;
      this._el.innerHTML = errorBanner(err.message);
    }
  }

  _renderBody(s) {
    const rows = s.lines.map(l => `
      <tr>
        <td>${escHtml(l.occurred_on)}</td>
        <td>${escHtml(t(`adminBooks.statement.kind.${l.kind}`))}</td>
        <td>${l.invoice_id && l.kind === 'invoice'
    ? `<a href="${escHtml(href(`/admin/books/invoices/${l.invoice_id}`))}">${escHtml(l.reference || '')}</a>`
    : escHtml(l.reference || '')}
        </td>
        <td>${escHtml(l.due_on || '')}</td>
        <td class="num">${l.charge ? escHtml(isk(l.charge)) : ''}</td>
        <td class="num">${l.credit ? escHtml(isk(l.credit)) : ''}</td>
        <td class="num">${escHtml(isk(l.balance))}</td>
      </tr>`).join('');

    return `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(s.customer_name || t('adminBooks.ar.unknownCustomer'))}</h1>
          <p class="admin-shop__hint">
            ${s.customer_email ? escHtml(s.customer_email) + ' · ' : ''}
            ${escHtml(t('adminBooks.statement.subtitle'))}
          </p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(href('/admin/books/ar'))}">
            ${escHtml(t('adminBooks.statement.backToAr'))}
          </a>
        </div>
      </div>

      <table class="admin-table books-table">
        <thead><tr>
          <th>${escHtml(t('adminBooks.col.date'))}</th>
          <th>${escHtml(t('adminBooks.statement.type'))}</th>
          <th>${escHtml(t('adminBooks.statement.reference'))}</th>
          <th>${escHtml(t('adminBooks.statement.due'))}</th>
          <th class="num">${escHtml(t('adminBooks.statement.charge'))}</th>
          <th class="num">${escHtml(t('adminBooks.statement.credit'))}</th>
          <th class="num">${escHtml(t('adminBooks.statement.balance'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="books-totals__grand">
          <td colspan="6"><strong>${escHtml(t('adminBooks.statement.closing'))}</strong></td>
          <td class="num"><strong>${escHtml(isk(s.closing_balance))}</strong></td>
        </tr></tfoot>
      </table>
      ${s.closing_balance < 0
    ? `<p class="admin-shop__hint">${escHtml(t('adminBooks.statement.inCredit'))}</p>` : ''}`;
  }

  destroy() {
    this._generation += 1;
  }
}
