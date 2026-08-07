// AdminInvoiceDetailView (/admin/books/invoices/:id) — one invoice, in full.
//
// Shows the document as issued (per-rate VAT included, because that is what the
// invoice must legally state), its settlement history, and the audit trail of who
// did what. The two actions are recording a payment and issuing a credit note —
// there is deliberately no "edit" and no "delete", because an issued invoice is
// append-only (Reglugerð 505/2013 gr. 9) and the database enforces that.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchInvoice, recordPayment, issueCreditNote, invoicePdfUrl, newIdempotencyKey,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk, statusPill, errorBanner } from './booksShared.js';

const METHODS = ['bank_transfer', 'cash', 'card', 'stripe', 'other'];

export class AdminInvoiceDetailView {
  constructor(id) {
    this._id = id;
    this._el = null;
    this._invoice = null;
    // Generated once per form instance, not per submit: a retry after a network
    // failure must reuse the SAME key, or a payment that actually landed would be
    // booked twice.
    this._paymentKey = newIdempotencyKey();
    this._busy = false;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('invoices')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    this._load();
    return renderAdminShell({ activePath: '/admin/books/invoices', content: this._el });
  }

  async _load() {
    try {
      const data = await fetchInvoice(this._id);
      this._invoice = data.invoice;
      this._history = data.history || [];
      this._paint();
    } catch (err) {
      this._el.innerHTML = errorBanner(err.message);
    }
  }

  _paint() {
    const inv = this._invoice;
    const canWrite = isAdmin();
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">
            ${escHtml(t(inv.series === 'receipt' ? 'adminBooks.receiptNo' : 'adminBooks.invoiceNo',
              { number: inv.invoice_number }))}
          </h1>
          <p class="admin-shop__hint">
            ${statusPill(inv.display_status)}
            ${escHtml(t('adminBooks.detail.issuedOn', { date: inv.issued_at }))}
            · ${escHtml(t('adminBooks.detail.dueOn', { date: inv.due_at }))}
            ${inv.days_overdue > 0
              ? ` · <strong>${escHtml(t('adminBooks.detail.daysOverdue', { days: inv.days_overdue }))}</strong>`
              : ''}
          </p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(invoicePdfUrl(inv.id))}">
            ${escHtml(t('adminBooks.detail.downloadPdf'))}
          </a>
        </div>
      </div>

      <div class="books-columns">
        <section class="books-section">
          <h2 class="books-section__title">${escHtml(t('adminBooks.detail.billTo'))}</h2>
          <p>
            <strong>${escHtml(inv.customer_name || '')}</strong><br/>
            ${(inv.customer_address || '').split('\n').filter(Boolean)
              .map(l => escHtml(l)).join('<br/>')}
            ${inv.customer_email ? `<br/>${escHtml(inv.customer_email)}` : ''}
          </p>
        </section>
        <section class="books-section">
          <h2 class="books-section__title">${escHtml(t('adminBooks.detail.seller'))}</h2>
          <p>
            <strong>${escHtml(inv.seller_name || '')}</strong><br/>
            ${escHtml(t('adminBooks.detail.kennitala'))}: ${escHtml(inv.seller_kennitala || '')}<br/>
            ${escHtml(t('adminBooks.detail.vatNumber'))}: ${escHtml(inv.seller_vat_number || '')}
          </p>
        </section>
      </div>

      ${this._renderLines()}
      ${this._renderTotals()}
      ${this._renderSettlement()}
      ${canWrite ? this._renderActions() : ''}
      ${this._renderHistory()}
    `;

    if (canWrite) this._wireActions();
  }

  _renderLines() {
    const inv = this._invoice;
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.detail.lines'))}</h2>
        <table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.col.description'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.qty'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.unitPrice'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.vatRate'))}</th>
            <th class="num">${escHtml(t('adminBooks.col.lineTotal'))}</th>
          </tr></thead>
          <tbody>${inv.lines.map(l => `
            <tr>
              <td>
                ${escHtml(l.description)}
                ${l.sku ? `<span class="books-muted"> (${escHtml(l.sku)})</span>` : ''}
                ${l.discount_gross > 0
                  ? `<div class="books-muted">${escHtml(t('adminBooks.detail.discountLine', {
                      amount: isk(l.discount_gross) }))}</div>`
                  : ''}
              </td>
              <td class="num">${escHtml(String(l.quantity))}</td>
              <td class="num">${escHtml(isk(l.unit_price_gross))}</td>
              <td class="num">${escHtml(String(l.vat_rate))}%</td>
              <td class="num">${escHtml(isk(l.line_gross))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </section>`;
  }

  _renderTotals() {
    const inv = this._invoice;
    // VAT per rate, as the invoice must state it — one aggregate figure is not
    // enough on a mixed-rate document.
    const rateRows = inv.vat_by_rate.map(b => b.rate === 0
      ? `<tr><td>${escHtml(t('adminBooks.detail.zeroRated'))}</td>
           <td class="num">${escHtml(isk(b.net))}</td></tr>`
      : `<tr><td>${escHtml(t('adminBooks.detail.vatAtRate', { rate: b.rate }))}</td>
           <td class="num">${escHtml(isk(b.vat))}</td></tr>`).join('');

    return `
      <section class="books-section books-totals">
        <table class="books-table">
          <tbody>
            ${inv.discount_total > 0
              ? `<tr><td>${escHtml(t('adminBooks.detail.discountTotal'))}</td>
                   <td class="num">-${escHtml(isk(inv.discount_total))}</td></tr>` : ''}
            <tr><td>${escHtml(t('adminBooks.detail.netTotal'))}</td>
                <td class="num">${escHtml(isk(inv.subtotal_net))}</td></tr>
            ${rateRows}
            <tr class="books-totals__grand">
              <td>${escHtml(t('adminBooks.detail.grossTotal'))}</td>
              <td class="num">${escHtml(isk(inv.total_gross))}</td></tr>
            ${inv.amount_credited > 0
              ? `<tr><td>${escHtml(t('adminBooks.detail.credited'))}</td>
                   <td class="num">-${escHtml(isk(inv.amount_credited))}</td></tr>` : ''}
            ${inv.amount_paid > 0
              ? `<tr><td>${escHtml(t('adminBooks.detail.paid'))}</td>
                   <td class="num">-${escHtml(isk(inv.amount_paid))}</td></tr>` : ''}
            <tr class="books-totals__grand">
              <td>${escHtml(t('adminBooks.detail.outstanding'))}</td>
              <td class="num">${escHtml(isk(inv.outstanding))}</td></tr>
          </tbody>
        </table>
        ${inv.original_currency !== 'ISK'
          ? `<p class="admin-shop__hint">${escHtml(t('adminBooks.detail.fxNote', {
              amount: (inv.original_total_gross / 100).toFixed(2),
              currency: inv.original_currency,
              rate: inv.fx_rate,
            }))}</p>` : ''}
        ${inv.zero_rate_reason
          ? `<p class="admin-shop__hint">${escHtml(inv.zero_rate_reason)}</p>` : ''}
      </section>`;
  }

  _renderSettlement() {
    const inv = this._invoice;
    if (!inv.payments.length && !inv.credit_notes.length) return '';
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.detail.settlement'))}</h2>
        <table class="admin-table books-table">
          <tbody>
            ${inv.payments.map(p => `
              <tr>
                <td>${escHtml(p.received_at)}</td>
                <td>${escHtml(t(`adminBooks.method.${p.method}`))}</td>
                <td>${escHtml(p.reference || '')}</td>
                <td class="num">${escHtml(isk(p.amount))}</td>
              </tr>`).join('')}
            ${inv.credit_notes.map(c => `
              <tr>
                <td>${escHtml(c.issued_at)}</td>
                <td>${escHtml(t('adminBooks.detail.creditNoteNo', { number: c.credit_note_number }))}</td>
                <td>${escHtml(c.reason)}</td>
                <td class="num">-${escHtml(isk(c.amount_gross))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>`;
  }

  _renderActions() {
    const inv = this._invoice;
    const settled = inv.outstanding <= 0;
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.detail.actions'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.detail.actionsHint'))}</p>
        <div class="books-columns">
          <form id="pay-form" class="books-form" ${settled ? 'hidden' : ''}>
            <h3>${escHtml(t('adminBooks.detail.recordPayment'))}</h3>
            <label>${escHtml(t('adminBooks.detail.amount'))}
              <input type="number" name="amount" min="1" step="1" required
                     value="${escHtml(String(inv.outstanding))}" />
            </label>
            <label>${escHtml(t('adminBooks.detail.method'))}
              <select name="method">
                ${METHODS.map(m => `<option value="${escHtml(m)}">${
                  escHtml(t(`adminBooks.method.${m}`))}</option>`).join('')}
              </select>
            </label>
            <label>${escHtml(t('adminBooks.detail.receivedAt'))}
              <input type="date" name="received_at" />
            </label>
            <label>${escHtml(t('adminBooks.detail.reference'))}
              <input type="text" name="reference" maxlength="200" />
            </label>
            <button type="submit" class="btn">${escHtml(t('adminBooks.detail.recordPayment'))}</button>
          </form>

          <form id="credit-form" class="books-form">
            <h3>${escHtml(t('adminBooks.detail.issueCreditNote'))}</h3>
            <p class="admin-shop__hint">${escHtml(t('adminBooks.detail.creditHint'))}</p>
            <label>${escHtml(t('adminBooks.detail.amount'))}
              <input type="number" name="amount_gross" min="1" step="1" required />
            </label>
            <label>${escHtml(t('adminBooks.detail.reason'))}
              <input type="text" name="reason" maxlength="500" required />
            </label>
            <button type="submit" class="btn btn--ghost">
              ${escHtml(t('adminBooks.detail.issueCreditNote'))}
            </button>
          </form>
        </div>
      </section>`;
  }

  _wireActions() {
    const payForm = this._el.querySelector('#pay-form');
    if (payForm) {
      payForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (this._busy) return;
        const fd = new FormData(payForm);
        await this._submit(payForm, () => recordPayment(this._id, {
          amount: Number(fd.get('amount')),
          method: fd.get('method'),
          received_at: fd.get('received_at') || undefined,
          reference: fd.get('reference') || '',
          // Same key across retries — see the constructor.
          idempotency_key: this._paymentKey,
        }), t('adminBooks.detail.paymentRecorded'));
      });
    }

    const creditForm = this._el.querySelector('#credit-form');
    if (creditForm) {
      creditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (this._busy) return;
        const fd = new FormData(creditForm);
        // Crediting is not reversible, so it asks first.
        if (!window.confirm(t('adminBooks.detail.confirmCredit'))) return;
        await this._submit(creditForm, () => issueCreditNote(this._id, {
          amount_gross: Number(fd.get('amount_gross')),
          reason: fd.get('reason'),
        }), t('adminBooks.detail.creditIssued'));
      });
    }
  }

  async _submit(form, action, successMessage) {
    const button = form.querySelector('button[type="submit"]');
    this._busy = true;
    if (button) button.disabled = true;
    try {
      await action();
      showToast(successMessage, 'success');
      // A successful payment consumes its key; the next one needs a fresh one.
      this._paymentKey = newIdempotencyKey();
      await this._load();
    } catch (err) {
      // The server's message is written to be shown: it explains what was wrong
      // (e.g. "exceeds the 4.000 kr. still outstanding").
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
      if (button) button.disabled = false;
    }
  }

  _renderHistory() {
    if (!this._history.length) return '';
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.detail.history'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.detail.historyHint'))}</p>
        <table class="admin-table books-table">
          <tbody>${this._history.map(h => `
            <tr>
              <td>${escHtml(String(h.created_at).slice(0, 19).replace('T', ' '))}</td>
              <td>${escHtml(t(`adminBooks.audit.${h.action}`))}</td>
              <td>${escHtml(h.actor_username || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </section>`;
  }
}
