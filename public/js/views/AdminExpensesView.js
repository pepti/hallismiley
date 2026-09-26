// AdminExpensesView (/admin/books/expenses) — purchases and their receipts.
//
// This screen is where a non-expert owner is most likely to cost themselves money,
// so it argues with you rather than just recording what you type:
//
//   * It asks the server for the VAT verdict as you fill the form, and says in
//     plain Icelandic WHY a deduction is refused (blocked account, no supplier VSK
//     number, exempt purchase) before you commit the entry.
//   * It warns when the purchase looks like one already entered — double-posting a
//     supplier invoice inflates input VAT, i.e. under-pays tax.
//   * It keeps the missing-receipt count in front of you, because "no fylgiskjal,
//     no deduction" is absolute and a year-end reconstruction is miserable.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchExpenses, fetchAccounts, fetchSuppliers, fetchMissingDocuments,
  previewExpenseVat, createExpense, uploadDocument, attachExpenseDocument,
  documentUrl, expensesCsvUrl,
  fetchIntake, fetchIntakeSuggestions, uploadToIntake, acceptIntake, rejectIntake,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { toMinorUnits, amountStep, minorUnitsFor } from '../utils/money.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { attachCombobox } from '../components/Combobox.js';
import { isk, errorBanner } from './booksShared.js';

const PAGE_SIZE = 50;
const VAT_CODES = ['input_24', 'input_11', 'reverse_charge_24', 'exempt', 'none'];

export class AdminExpensesView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._searchTimer = null;
    this._vatTimer = null;
    this._accounts = [];
    this._suppliers = [];
    this._detachSupplier = null;
    this._pendingDocumentId = null;
    this._busy = false;
    this._state = { q: '', missingDocument: false, offset: 0, total: 0 };
    // The intake queue: documents waiting for a person. When one is being
    // accepted, the entry form posts to /intake/:id/accept instead of /expenses,
    // with the queued document forced as the fylgiskjal.
    this._intakeItems = [];
    this._acceptIntakeId = null;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('expenses')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.expenses.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.expenses.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(expensesCsvUrl())}">
            ${escHtml(t('adminBooks.exportCsv'))}
          </a>
        </div>
      </div>
      <div id="exp-missing"></div>
      <div id="exp-intake"></div>
      ${isAdmin() ? this._formShell() : ''}
      <div class="books-filters">
        <input type="search" id="exp-q" autocomplete="off" spellcheck="false"
               placeholder="${escHtml(t('adminBooks.expenses.searchPlaceholder'))}" />
        <label class="books-check">
          <input type="checkbox" id="exp-missing-only" />
          ${escHtml(t('adminBooks.expenses.missingOnly'))}
        </label>
      </div>
      <div id="exp-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;

    this._wireFilters();
    this._wireIntake();
    if (isAdmin()) await this._loadFormData();
    this._loadMissing();
    this._loadIntake();
    this._load();

    return renderAdminShell({ activePath: '/admin/books/expenses', content: this._el });
  }

  // ── The entry form ─────────────────────────────────────────────────────────

  _formShell() {
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.expenses.add'))}</h2>
        <form id="exp-form" class="books-form books-form--wide">
          <div id="exp-accepting"></div>
          <div class="books-form__grid">
            <label>${escHtml(t('adminBooks.expenses.supplier'))}
              <input type="text" name="supplier_name" maxlength="200" required />
            </label>
            <label>${escHtml(t('adminBooks.expenses.supplierKennitala'))}
              <input type="text" name="supplier_kennitala" maxlength="20" />
            </label>
            <label>${escHtml(t('adminBooks.expenses.supplierVatNumber'))}
              <input type="text" name="supplier_vat_number" maxlength="20" />
              <small>${escHtml(t('adminBooks.expenses.vatNumberHint'))}</small>
            </label>
            <label>${escHtml(t('adminBooks.expenses.country'))}
              <input type="text" name="supplier_country" maxlength="3" value="IS" />
            </label>
            <label>${escHtml(t('adminBooks.expenses.invoiceNo'))}
              <input type="text" name="supplier_invoice_no" maxlength="100" />
            </label>
            <label>${escHtml(t('adminBooks.expenses.date'))}
              <input type="date" name="expense_date" required />
            </label>
            <label>${escHtml(t('adminBooks.expenses.amountGross'))}
              <input type="number" name="amount_gross" min="1" step="1" inputmode="decimal" required />
              <small id="exp-amount-hint">${escHtml(t('adminBooks.expenses.amountHint'))}</small>
            </label>
            <label>${escHtml(t('adminBooks.expenses.currency'))}
              <select name="currency">
                ${['ISK', 'EUR', 'USD', 'GBP', 'DKK'].map(c =>
    `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
              </select>
            </label>
            <label>${escHtml(t('adminBooks.expenses.account'))}
              <select name="account_code" id="exp-account" required></select>
            </label>
            <label>${escHtml(t('adminBooks.expenses.vatCode'))}
              <select name="vat_code" id="exp-vat-code">
                ${VAT_CODES.map(c =>
    `<option value="${escHtml(c)}">${escHtml(t(`adminBooks.vatCode.${c}`))}</option>`).join('')}
              </select>
            </label>
            <label class="books-form__wide">${escHtml(t('adminBooks.expenses.description'))}
              <input type="text" name="description" maxlength="500" />
            </label>
            <label class="books-form__wide">${escHtml(t('adminBooks.expenses.receipt'))}
              <input type="file" id="exp-file"
                     accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" />
              <small id="exp-file-status">${escHtml(t('adminBooks.expenses.receiptHint'))}</small>
            </label>
          </div>
          <div id="exp-verdict"></div>
          <div id="exp-duplicates"></div>
          <button type="submit" class="btn">${escHtml(t('adminBooks.expenses.save'))}</button>
        </form>
      </section>`;
  }

  async _loadFormData() {
    try {
      const [{ accounts }, { suppliers }] = await Promise.all([fetchAccounts(), fetchSuppliers()]);
      // The server decides what is a valid purchase destination and says so per
      // account; offering a control account like Viðskiptakröfur or Bankainnstæða
      // would invite an entry that silently corrupts a control balance.
      this._accounts = accounts.filter(a => a.purchasable);
      this._suppliers = suppliers;
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    const accountSelect = this._el.querySelector('#exp-account');
    if (accountSelect) {
      accountSelect.innerHTML = this._accounts.map(a =>
        `<option value="${escHtml(a.code)}"${a.input_vat_blocked ? ' data-blocked="1"' : ''}>${
          escHtml(`${a.code} — ${a.name}`)}${a.input_vat_blocked ? ' ⚠' : ''}</option>`).join('');
    }
    // A searchable dropdown instead of the native <datalist>, which showed no
    // affordance and filtered itself empty once the field held a value.
    // Ported from icelandicstore #194 (Combobox). The kennitala is a quiet note
    // on the row and a hidden match key, so two suppliers of one name are told
    // apart and typing a kennitala finds the name. Still free text: a new
    // supplier stays typeable.
    const supplierInput = this._el.querySelector('input[name="supplier_name"]');
    if (supplierInput) {
      if (this._detachSupplier) this._detachSupplier();
      const entries = this._suppliers.map(s => ({
        value: s.supplier_name,
        label: s.supplier_name,
        meta: s.supplier_kennitala || '',
        keywords: s.supplier_kennitala || '',
      }));
      // Picking a known supplier fills its kennitala when that field is still
      // empty, so two suppliers of one name are told apart in the entry too.
      this._detachSupplier = attachCombobox(supplierInput, () => entries, {
        onPick: (entry) => {
          const kt = this._el.querySelector('input[name="supplier_kennitala"]');
          if (kt && !kt.value.trim() && entry.meta) {
            kt.value = entry.meta;
            kt.dispatchEvent(new Event('input', { bubbles: true }));
          }
        },
      });
    }
    this._wireForm();
    this._refreshVerdict();
  }

  _wireForm() {
    const form = this._el.querySelector('#exp-form');
    if (!form) return;

    // Re-ask the server for the verdict whenever an input that affects it changes.
    // Debounced: the VSK-number field changes on every keystroke.
    const watch = ['account_code', 'vat_code', 'supplier_country', 'supplier_vat_number'];
    form.addEventListener('input', (e) => {
      if (!watch.includes(e.target.name)) return;
      clearTimeout(this._vatTimer);
      this._vatTimer = setTimeout(() => this._refreshVerdict(), 200);
    });
    form.addEventListener('change', (e) => {
      if (watch.includes(e.target.name)) this._refreshVerdict();
      if (e.target.name === 'currency') this._syncAmountInput(form);
    });

    // Upload the receipt as soon as it is chosen, so the entry can reference it.
    const fileInput = this._el.querySelector('#exp-file');
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const status = this._el.querySelector('#exp-file-status');
        const file = fileInput.files && fileInput.files[0];
        if (!file) { this._pendingDocumentId = null; return; }
        status.textContent = t('adminBooks.expenses.uploading');
        try {
          const { document: doc, duplicates } = await uploadDocument(file, { kind: 'supplier_invoice' });
          this._pendingDocumentId = doc.id;
          status.textContent = duplicates.length
            ? t('adminBooks.expenses.uploadedDuplicate', { name: doc.original_name })
            : t('adminBooks.expenses.uploaded', { name: doc.original_name });
        } catch (err) {
          this._pendingDocumentId = null;
          status.textContent = err.message;
        }
      });
    }

    form.addEventListener('submit', e => this._submit(e, form, { allowDuplicate: false }));
  }

  // The amount field follows the currency: whole krónur for ISK, two decimals for
  // anything else — and the hint says which. "The total actually paid" read as
  // krónur is exactly how a USD invoice ends up booked a hundredfold too small.
  _syncAmountInput(form) {
    const currency = form.querySelector('[name="currency"]').value;
    const input = form.querySelector('[name="amount_gross"]');
    const hint = form.querySelector('#exp-amount-hint');
    const step = amountStep(currency);
    input.step = step;
    input.min = step;
    if (hint) {
      hint.textContent = currency === 'ISK'
        ? t('adminBooks.expenses.amountHint')
        : t('adminBooks.expenses.amountHintForeign', { currency });
    }
  }

  async _refreshVerdict() {
    const form = this._el.querySelector('#exp-form');
    const target = this._el.querySelector('#exp-verdict');
    if (!form || !target) return;
    const fd = new FormData(form);
    if (!fd.get('account_code')) return;
    try {
      const { verdict } = await previewExpenseVat({
        account_code: fd.get('account_code'),
        vat_code: fd.get('vat_code'),
        supplier_country: fd.get('supplier_country') || 'IS',
        supplier_vat_number: fd.get('supplier_vat_number') || '',
      });
      target.innerHTML = verdict.deductible
        ? `<div class="books-banner books-banner--ok">${escHtml(
          verdict.reverseCharge
            ? t('adminBooks.expenses.verdictReverseCharge')
            : t('adminBooks.expenses.verdictDeductible', { rate: verdict.rate })
        )}</div>`
        : `<div class="books-banner books-banner--warn">
             <strong>${escHtml(t('adminBooks.expenses.verdictBlocked'))}</strong>
             <div>${escHtml(verdict.reason || '')}</div>
           </div>`;
    } catch {
      // A failed preview must not block the entry — the server re-decides on save.
      target.innerHTML = '';
    }
  }

  async _submit(e, form, { allowDuplicate }) {
    e.preventDefault();
    if (this._busy) return;
    const fd = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    this._busy = true;
    if (button) button.disabled = true;
    try {
      const body = {
        supplier_name: fd.get('supplier_name'),
        supplier_kennitala: fd.get('supplier_kennitala') || null,
        supplier_vat_number: fd.get('supplier_vat_number') || '',
        supplier_country: fd.get('supplier_country') || 'IS',
        supplier_invoice_no: fd.get('supplier_invoice_no') || null,
        description: fd.get('description') || '',
        expense_date: fd.get('expense_date'),
        // The API takes MINOR units (aurar/cents); the person typed major units.
        // Sending the field raw booked a USD 20.00 invoice as USD 0.20.
        amount_gross: toMinorUnits(fd.get('amount_gross'), fd.get('currency')),
        currency: fd.get('currency'),
        vat_code: fd.get('vat_code'),
        account_code: fd.get('account_code'),
        document_id: this._pendingDocumentId,
        allow_duplicate: allowDuplicate,
      };
      // Accepting a queued document: same figures, same validation, same posting —
      // the server forces the queued file as the fylgiskjal and stamps the row.
      const accepting = this._acceptIntakeId;
      if (accepting) await acceptIntake(accepting, body);
      else await createExpense(body);
      showToast(t(accepting ? 'adminBooks.intake.accepted' : 'adminBooks.expenses.saved'), 'success');
      form.reset();
      this._pendingDocumentId = null;
      this._el.querySelector('#exp-duplicates').innerHTML = '';
      const status = this._el.querySelector('#exp-file-status');
      if (status) status.textContent = t('adminBooks.expenses.receiptHint');
      if (accepting) this._cancelAccept();
      this._loadMissing();
      this._loadIntake();
      this._load();
    } catch (err) {
      if (err.duplicates && err.duplicates.length) {
        this._showDuplicates(form, err);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      this._busy = false;
      if (button) button.disabled = false;
    }
  }

  // Show what the server thinks this duplicates, and let the user insist.
  _showDuplicates(form, err) {
    const box = this._el.querySelector('#exp-duplicates');
    box.innerHTML = `
      <div class="books-banner books-banner--warn">
        <strong>${escHtml(err.message)}</strong>
        <ul>${err.duplicates.map(d => `<li>${escHtml(
    `${d.expense_date} · ${d.supplier_name} · ${isk(d.amount_gross)}`
    + (d.supplier_invoice_no ? ` · ${d.supplier_invoice_no}` : '')
  )}</li>`).join('')}</ul>
        <button type="button" class="btn btn--ghost" id="exp-force">
          ${escHtml(t('adminBooks.expenses.saveAnyway'))}
        </button>
      </div>`;
    box.querySelector('#exp-force').addEventListener('click', () => {
      this._submit(new Event('submit'), form, { allowDuplicate: true });
    });
  }

  // ── Missing receipts ──────────────────────────────────────────────────────

  // ── The intake queue ───────────────────────────────────────────────────────
  //
  // A queued document is a PROPOSAL; nothing is booked until an admin opens it
  // into the entry form, checks every figure and submits. The badge says which
  // rung of the trust ladder the document came in on (Peppol / XML / read /
  // manual) — the pre-fill is a time-saver, never a decision.

  async _loadIntake() {
    const target = this._el.querySelector('#exp-intake');
    if (!target) return;
    try {
      const { items } = await fetchIntake({ status: 'pending', limit: 20 });
      this._intakeItems = items || [];
      target.innerHTML = this._intakeHtml();
    } catch {
      target.innerHTML = '';
    }
  }

  _intakeHtml() {
    const items = this._intakeItems;
    const admin = isAdmin();
    const upload = admin ? `
      <label class="books-check">
        <input type="file" id="exp-intake-file"
               accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,text/xml,application/xml" />
        ${escHtml(t('adminBooks.intake.upload'))}
      </label>` : '';
    if (!items.length && !admin) return '';
    const rows = items.length ? `
      <table class="admin-table books-table books-table--tight">
        <thead><tr>
          <th>${escHtml(t('adminBooks.intake.colSource'))}</th>
          <th>${escHtml(t('adminBooks.intake.colDocument'))}</th>
          <th>${escHtml(t('adminBooks.expenses.supplier'))}</th>
          <th>${escHtml(t('adminBooks.expenses.date'))}</th>
          <th class="num">${escHtml(t('adminBooks.expenses.amountGross'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${items.map(i => `
          <tr>
            <td><span class="books-pill books-pill--${i.source_kind === 'manual' ? 'muted' : 'info'}">${escHtml(t(`adminBooks.intake.source.${i.source_kind}`))}</span></td>
            <td><a class="books-link" href="${escHtml(documentUrl(i.document_id))}">${escHtml(i.original_name || '')}</a>
              ${(i.parse_problems || []).length ? `<div class="books-muted">${escHtml(t('adminBooks.intake.parseProblems'))} ${escHtml((i.parse_problems || []).join('; '))}</div>` : ''}</td>
            <td>${escHtml(i.supplier_name || '—')}${i.supplier_invoice_no ? ` · ${escHtml(i.supplier_invoice_no)}` : ''}</td>
            <td>${escHtml(i.document_date || '—')}</td>
            <td class="num">${i.amount_gross ? escHtml(`${i.amount_gross} ${i.currency}`) : '—'}</td>
            <td class="books-actions">${admin ? `
              <button type="button" class="btn btn--sm" data-intake-accept="${escHtml(i.id)}">${escHtml(t('adminBooks.intake.open'))}</button>
              <button type="button" class="btn btn--sm btn--ghost" data-intake-reject="${escHtml(i.id)}">${escHtml(t('adminBooks.intake.reject'))}</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<p class="admin-shop__hint">${escHtml(t('adminBooks.intake.empty'))}</p>`;
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.intake.title', { count: items.length }))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.intake.hint'))}</p>
        ${upload}
        <div id="exp-intake-status"></div>
        ${rows}
      </section>`;
  }

  _wireIntake() {
    const box = this._el.querySelector('#exp-intake');
    if (!box) return;
    box.addEventListener('change', async (e) => {
      if (e.target.id !== 'exp-intake-file') return;
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const status = box.querySelector('#exp-intake-status');
      try {
        const { intake } = await uploadToIntake(file);
        showToast(t('adminBooks.intake.uploaded', { name: intake.original_name || file.name }), 'success');
        await this._loadIntake();
      } catch (err) {
        const msg = err.code === 'ALREADY_QUEUED' ? t('adminBooks.intake.alreadyQueued') : err.message;
        if (status) status.innerHTML = errorBanner(msg);
        else showToast(msg, 'error');
      }
    });
    box.addEventListener('click', async (e) => {
      const accept = e.target.closest('[data-intake-accept]');
      if (accept) { this._startAccept(accept.dataset.intakeAccept); return; }
      const reject = e.target.closest('[data-intake-reject]');
      if (reject) {
        const reason = window.prompt(t('adminBooks.intake.rejectPrompt'));
        if (reason === null) return;
        if (!reason.trim()) { showToast(t('adminBooks.intake.rejectPrompt'), 'error'); return; }
        try {
          await rejectIntake(reject.dataset.intakeReject, reason.trim());
          showToast(t('adminBooks.intake.rejected'), 'success');
          if (this._acceptIntakeId === reject.dataset.intakeReject) this._cancelAccept();
          this._loadIntake();
        } catch (err) { showToast(err.message, 'error'); }
      }
    });
  }

  // Open a queued document into the entry form. The suggestion pre-fills what it
  // can; the operator sees and can change every figure before submitting.
  async _startAccept(id) {
    const form = this._el.querySelector('#exp-form');
    if (!form) return;
    let suggestion;
    try {
      ({ suggestion } = await fetchIntakeSuggestions(id));
    } catch (err) { showToast(err.message, 'error'); return; }
    suggestion = suggestion || {};
    this._acceptIntakeId = id;
    form.reset();
    this._pendingDocumentId = null;
    const set = (name, value) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el || value === null || value === undefined || value === '') return;
      if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(value))) return;
      el.value = String(value);
    };
    set('supplier_name', suggestion.supplier_name);
    set('supplier_kennitala', suggestion.supplier_kennitala);
    set('supplier_vat_number', suggestion.supplier_vat_number);
    set('supplier_country', suggestion.supplier_country);
    set('supplier_invoice_no', suggestion.supplier_invoice_no);
    set('expense_date', suggestion.expense_date);
    set('currency', suggestion.currency || 'ISK');
    // Minor units on the wire, major units in the field (the same conversion the
    // form applies on the way out, reversed).
    if (suggestion.amount_gross) {
      const cur = form.querySelector('[name="currency"]').value;
      this._syncAmountInput(form);
      set('amount_gross', suggestion.amount_gross / minorUnitsFor(cur));
    }
    set('account_code', suggestion.account_code);
    set('vat_code', suggestion.vat_code);
    this._paintAccepting();
    this._refreshVerdict();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _cancelAccept() {
    this._acceptIntakeId = null;
    this._paintAccepting();
  }

  _paintAccepting() {
    const box = this._el.querySelector('#exp-accepting');
    if (!box) return;
    if (!this._acceptIntakeId) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="books-banner books-banner--info">
        ${escHtml(t('adminBooks.intake.accepting'))}
        <button type="button" class="btn btn--sm btn--ghost" id="exp-accept-cancel">${escHtml(t('adminBooks.intake.cancelAccept'))}</button>
      </div>`;
    box.querySelector('#exp-accept-cancel').addEventListener('click', () => this._cancelAccept());
  }

  async _loadMissing() {
    const target = this._el.querySelector('#exp-missing');
    if (!target) return;
    try {
      const { count, unsubstantiated_vat: vat } = await fetchMissingDocuments({ limit: 1 });
      target.innerHTML = count === 0 ? '' : `
        <div class="books-banner books-banner--warn">
          <strong>${escHtml(t('adminBooks.expenses.missingTitle', { count }))}</strong>
          <div>${escHtml(t('adminBooks.expenses.missingHint', { amount: isk(vat) }))}</div>
        </div>`;
    } catch {
      target.innerHTML = '';
    }
  }

  // ── List ───────────────────────────────────────────────────────────────────

  _wireFilters() {
    const qInput = this._el.querySelector('#exp-q');
    qInput.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._state.q = qInput.value.trim();
        this._state.offset = 0;
        this._load();
      }, 250);
    });
    this._el.querySelector('#exp-missing-only').addEventListener('change', (e) => {
      this._state.missingDocument = e.target.checked;
      this._state.offset = 0;
      this._load();
    });
    this._el.addEventListener('click', async (e) => {
      const page = e.target.closest('[data-page]');
      if (page) {
        this._state.offset = Math.max(0, Number(page.dataset.page) || 0);
        this._load();
        return;
      }
      // Attach a receipt to an existing entry — the queue's whole purpose.
      const attach = e.target.closest('[data-attach]');
      if (attach) this._attachTo(attach.dataset.attach);
    });
  }

  _attachTo(expenseId) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';
    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      try {
        const { document: doc } = await uploadDocument(file, { kind: 'supplier_invoice' });
        await attachExpenseDocument(expenseId, doc.id);
        showToast(t('adminBooks.expenses.attached'), 'success');
        this._loadMissing();
        this._load();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    picker.click();
  }

  async _load() {
    const generation = ++this._generation;
    const body = this._el.querySelector('#exp-body');
    body.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    try {
      const data = await fetchExpenses({
        q: this._state.q,
        missing_document: this._state.missingDocument ? 'true' : '',
        limit: PAGE_SIZE,
        offset: this._state.offset,
      });
      if (generation !== this._generation) return;
      this._state.total = data.total;
      body.innerHTML = this._renderTable(data.expenses);
    } catch (err) {
      if (generation !== this._generation) return;
      body.innerHTML = errorBanner(err.message);
    }
  }

  _renderTable(expenses) {
    if (!expenses.length) {
      return `<p class="admin-shop__hint">${escHtml(t('adminBooks.expenses.empty'))}</p>`;
    }
    const rows = expenses.map(e => `
      <tr>
        <td>${escHtml(e.expense_date)}</td>
        <td>${escHtml(e.supplier_name)}
          ${e.supplier_invoice_no ? `<span class="books-muted"> · ${escHtml(e.supplier_invoice_no)}</span>` : ''}
        </td>
        <td>${escHtml(`${e.account_code} — ${e.account_name}`)}</td>
        <td class="num">${escHtml(isk(e.amount_net))}</td>
        <td class="num">${escHtml(isk(e.amount_vat))}
          ${e.vat_deductible ? '' : `<span class="books-muted" title="${escHtml(e.non_deductible_reason || '')}"> ⚠</span>`}
        </td>
        <td class="num">${escHtml(isk(e.amount_gross))}</td>
        <td>${e.document_name
    ? `<a href="${escHtml(documentUrl(e.document_id))}">${escHtml(t('adminBooks.expenses.viewReceipt'))}</a>`
    : (isAdmin()
      ? `<button type="button" class="btn btn--ghost btn--sm" data-attach="${escHtml(e.id)}">${
        escHtml(t('adminBooks.expenses.attach'))}</button>`
      : `<span class="books-muted">${escHtml(t('adminBooks.expenses.noReceipt'))}</span>`)}
        </td>
      </tr>`).join('');

    const from = this._state.offset + 1;
    const to = Math.min(this._state.offset + expenses.length, this._state.total);
    const prev = Math.max(0, this._state.offset - PAGE_SIZE);
    const next = this._state.offset + PAGE_SIZE;

    return `
      <table class="admin-table books-table">
        <thead><tr>
          <th>${escHtml(t('adminBooks.col.date'))}</th>
          <th>${escHtml(t('adminBooks.expenses.supplier'))}</th>
          <th>${escHtml(t('adminBooks.expenses.account'))}</th>
          <th class="num">${escHtml(t('adminBooks.detail.netTotal'))}</th>
          <th class="num">${escHtml(t('adminBooks.col.vat'))}</th>
          <th class="num">${escHtml(t('adminBooks.col.total'))}</th>
          <th>${escHtml(t('adminBooks.expenses.receipt'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="books-pager">
        <span>${escHtml(t('adminBooks.invoices.showing', { from, to, total: this._state.total }))}</span>
        <button type="button" class="btn btn--ghost" data-page="${prev}"
          ${this._state.offset === 0 ? 'disabled' : ''}>${escHtml(t('form.previous'))}</button>
        <button type="button" class="btn btn--ghost" data-page="${next}"
          ${next >= this._state.total ? 'disabled' : ''}>${escHtml(t('form.next'))}</button>
      </div>`;
  }

  destroy() {
    this._generation += 1;
    clearTimeout(this._searchTimer);
    clearTimeout(this._vatTimer);
    if (this._detachSupplier) { this._detachSupplier(); this._detachSupplier = null; }
  }
}
