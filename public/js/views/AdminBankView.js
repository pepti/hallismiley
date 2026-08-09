// AdminBankView (/admin/books/bank) — bank and card reconciliation.
//
// The screen leads with the question that matters: does the ledger agree with the
// bank? A difference there means something is in the books that is not at the bank,
// or the other way round, and no amount of tidy-looking data changes that.
//
// Below it, every statement line that has not been resolved. Matching is SUGGESTED,
// never automatic: a wrongly auto-matched line looks reconciled and stops being
// investigated, which is worse than one that still needs attention.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchBankStatus, fetchBankTransactions, importBankStatement,
  fetchBankSuggestions, resolveBankTransaction, syncStripe, fetchAccounts,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk, statTile, errorBanner } from './booksShared.js';

const PAGE_SIZE = 50;
const STATES = ['unmatched', 'matched', 'explained', 'ignored'];

export class AdminBankView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._busy = false;
    this._accounts = [];
    this._state = { state: 'unmatched', offset: 0, total: 0 };
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('bank')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.bank.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.bank.subtitle'))}</p>
        </div>
      </div>
      <div id="bank-status"></div>
      ${isAdmin() ? this._toolsShell() : ''}
      <div class="books-filters">
        <select id="bank-state">
          ${STATES.map(s => `<option value="${escHtml(s)}"${s === 'unmatched' ? ' selected' : ''}>${
            escHtml(t(`adminBooks.bank.state.${s}`))}</option>`).join('')}
        </select>
      </div>
      <div id="bank-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;

    this._el.querySelector('#bank-state').addEventListener('change', (e) => {
      this._state.state = e.target.value;
      this._state.offset = 0;
      this._load();
    });
    this._el.addEventListener('click', (e) => {
      const page = e.target.closest('[data-page]');
      if (page) {
        this._state.offset = Math.max(0, Number(page.dataset.page) || 0);
        this._load();
        return;
      }
      const resolve = e.target.closest('[data-resolve]');
      if (resolve) this._openResolve(resolve.dataset.resolve);
    });

    if (isAdmin()) this._wireTools();
    this._loadStatus();
    this._load();
    if (isAdmin()) this._loadAccounts();

    return renderAdminShell({ activePath: '/admin/books/bank', content: this._el });
  }

  async _loadAccounts() {
    try {
      const { accounts } = await fetchAccounts();
      this._accounts = accounts;
    } catch { this._accounts = []; }
  }

  _toolsShell() {
    return `
      <div class="books-columns">
        <form id="bank-import" class="books-form">
          <h3>${escHtml(t('adminBooks.bank.import'))}</h3>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.bank.importHint'))}</p>
          <label>${escHtml(t('adminBooks.bank.csvFile'))}
            <input type="file" id="bank-file" accept=".csv,text/csv,text/plain" />
          </label>
          <label>${escHtml(t('adminBooks.bank.orPaste'))}
            <textarea name="csv" rows="4" spellcheck="false"></textarea>
          </label>
          <button type="submit" class="btn">${escHtml(t('adminBooks.bank.importButton'))}</button>
        </form>
        <form id="stripe-sync" class="books-form">
          <h3>${escHtml(t('adminBooks.bank.stripeSync'))}</h3>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.bank.stripeHint'))}</p>
          <label>${escHtml(t('adminBooks.bank.since'))}
            <input type="date" name="since" />
          </label>
          <button type="submit" class="btn btn--ghost">
            ${escHtml(t('adminBooks.bank.stripeButton'))}
          </button>
        </form>
      </div>`;
  }

  _wireTools() {
    const importForm = this._el.querySelector('#bank-import');
    const fileInput = this._el.querySelector('#bank-file');
    // Read the file into the textarea rather than uploading it: a statement is not a
    // document to retain (the bank keeps it, and the entries carry their own trail),
    // so there is nothing to store and no reason to involve the upload machinery.
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      importForm.querySelector('textarea[name="csv"]').value = await file.text();
      showToast(t('adminBooks.bank.fileRead', { name: file.name }), 'success');
    });

    importForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this._busy) return;
      const csv = new FormData(importForm).get('csv');
      if (!String(csv || '').trim()) {
        showToast(t('adminBooks.bank.noCsv'), 'error');
        return;
      }
      await this._submit(importForm, async () => {
        const r = await importBankStatement(String(csv));
        showToast(t('adminBooks.bank.imported', {
          imported: r.imported, duplicates: r.duplicates,
        }), 'success');
        if (r.problems && r.problems.length) {
          // Unreadable lines are reported, never dropped quietly — a statement line
          // the importer skipped is exactly the kind of gap this screen exists to find.
          showToast(t('adminBooks.bank.someLinesSkipped', { count: r.problems.length }), 'error');
        }
        importForm.reset();
      });
    });

    const stripeForm = this._el.querySelector('#stripe-sync');
    stripeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this._busy) return;
      const since = new FormData(stripeForm).get('since');
      await this._submit(stripeForm, async () => {
        const r = await syncStripe(since || undefined);
        showToast(t('adminBooks.bank.stripeSynced', {
          posted: r.posted, skipped: r.skipped,
        }), 'success');
      });
    });
  }

  async _loadStatus() {
    const target = this._el.querySelector('#bank-status');
    try {
      const s = await fetchBankStatus();
      const reconciled = s.difference === 0;
      target.innerHTML = `
        <div class="books-stats">
          ${statTile({
    label: t('adminBooks.bank.ledgerBalance'),
    value: isk(s.ledger_balance),
    hint: t('adminBooks.bank.ledgerBalanceHint'),
  })}
          ${statTile({
    label: t('adminBooks.bank.statementBalance'),
    value: s.statement_balance === null ? '—' : isk(s.statement_balance),
    hint: s.statement_date
      ? t('adminBooks.bank.statementAsOf', { date: s.statement_date })
      : t('adminBooks.bank.noStatement'),
  })}
          ${statTile({
    label: t('adminBooks.bank.difference'),
    value: s.difference === null ? '—' : isk(s.difference),
    hint: reconciled
      ? t('adminBooks.bank.reconciled')
      : t('adminBooks.bank.notReconciled'),
    tone: reconciled || s.difference === null ? '' : 'warn',
  })}
          ${statTile({
    label: t('adminBooks.bank.clearing'),
    value: isk(s.clearing_balance),
    hint: t('adminBooks.bank.clearingHint'),
  })}
          ${statTile({
    label: t('adminBooks.bank.unmatched'),
    value: String(s.unmatched_count),
    hint: t('adminBooks.bank.unmatchedHint', { amount: isk(s.unmatched_total) }),
    tone: s.unmatched_count > 0 ? 'warn' : '',
  })}
        </div>`;
    } catch (err) {
      target.innerHTML = errorBanner(err.message);
    }
  }

  async _load() {
    const generation = ++this._generation;
    const body = this._el.querySelector('#bank-body');
    body.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    try {
      const data = await fetchBankTransactions({
        state: this._state.state, limit: PAGE_SIZE, offset: this._state.offset,
      });
      if (generation !== this._generation) return;
      this._state.total = data.total;
      body.innerHTML = this._renderTable(data.transactions);
    } catch (err) {
      if (generation !== this._generation) return;
      body.innerHTML = errorBanner(err.message);
    }
  }

  _renderTable(rows) {
    if (!rows.length) {
      return `<p class="admin-shop__hint">${escHtml(t('adminBooks.bank.empty'))}</p>`;
    }
    const from = this._state.offset + 1;
    const to = Math.min(this._state.offset + rows.length, this._state.total);
    const prev = Math.max(0, this._state.offset - PAGE_SIZE);
    const next = this._state.offset + PAGE_SIZE;

    return `
      <table class="admin-table books-table">
        <thead><tr>
          <th>${escHtml(t('adminBooks.col.date'))}</th>
          <th>${escHtml(t('adminBooks.bank.description'))}</th>
          <th class="num">${escHtml(t('adminBooks.bank.amount'))}</th>
          <th class="num">${escHtml(t('adminBooks.bank.balanceAfter'))}</th>
          <th>${escHtml(t('adminBooks.col.status'))}</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${escHtml(r.booked_on)}</td>
            <td>${escHtml(r.description || '')}
              ${r.counterparty ? `<div class="books-muted">${escHtml(r.counterparty)}</div>` : ''}
              ${r.note ? `<div class="books-muted">${escHtml(r.note)}</div>` : ''}
            </td>
            <td class="num">${escHtml(isk(r.amount))}</td>
            <td class="num">${r.balance_after === null ? '' : escHtml(isk(r.balance_after))}</td>
            <td>
              ${r.match_state === 'unmatched'
    ? (isAdmin()
      ? `<button type="button" class="btn btn--ghost btn--sm" data-resolve="${escHtml(r.id)}">${
        escHtml(t('adminBooks.bank.resolve'))}</button>`
      : `<span class="books-pill books-pill--warn">${escHtml(t('adminBooks.bank.state.unmatched'))}</span>`)
    : `<span class="books-pill books-pill--${r.match_state === 'ignored' ? 'muted' : 'ok'}">${
      escHtml(t(`adminBooks.bank.state.${r.match_state}`))}</span>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="books-pager">
        <span>${escHtml(t('adminBooks.invoices.showing', { from, to, total: this._state.total }))}</span>
        <button type="button" class="btn btn--ghost" data-page="${prev}"
          ${this._state.offset === 0 ? 'disabled' : ''}>${escHtml(t('form.previous'))}</button>
        <button type="button" class="btn btn--ghost" data-page="${next}"
          ${next >= this._state.total ? 'disabled' : ''}>${escHtml(t('form.next'))}</button>
      </div>`;
  }

  // Resolve one line: pick a suggestion, or explain it against an account.
  async _openResolve(id) {
    let data;
    try {
      data = await fetchBankSuggestions(id);
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    const tx = data.transaction;
    const panel = document.createElement('div');
    panel.className = 'books-banner books-banner--info books-resolve';
    panel.innerHTML = `
      <strong>${escHtml(`${tx.booked_on} · ${isk(tx.amount)} · ${tx.description || ''}`)}</strong>
      ${data.suggestions.length ? `
        <div class="books-resolve__suggestions">
          <div>${escHtml(t('adminBooks.bank.suggestions'))}</div>
          ${data.suggestions.filter(s => s.kind === 'invoice').map(s => `
            <button type="button" class="btn btn--ghost btn--sm"
                    data-pick-invoice="${escHtml(s.invoice_id)}">
              ${escHtml(`#${s.invoice_number} · ${s.customer_name} · ${isk(s.outstanding)} · ${
                t(`adminBooks.bank.confidence.${s.confidence}`)}`)}
            </button>`).join('')}
          ${data.suggestions.filter(s => s.kind === 'expense').map(s => `
            <div class="books-muted">${escHtml(`${s.supplier_name} · ${isk(s.amount_gross)} · ${
              t(`adminBooks.bank.confidence.${s.confidence}`)} — ${t('adminBooks.bank.expenseHint')}`)}</div>`).join('')}
        </div>` : `<div class="books-muted">${escHtml(t('adminBooks.bank.noSuggestions'))}</div>`}
      <form class="books-form" data-explain>
        <label>${escHtml(t('adminBooks.bank.account'))}
          <select name="account_code">
            <option value="">${escHtml(t('adminBooks.bank.pickAccount'))}</option>
            ${this._accounts.map(a => `<option value="${escHtml(a.code)}">${
    escHtml(`${a.code} — ${a.name}`)}</option>`).join('')}
          </select>
        </label>
        <label>${escHtml(t('adminBooks.bank.reason'))}
          <input type="text" name="reason" maxlength="500" required />
        </label>
        <div class="books-actions">
          <button type="submit" class="btn">${escHtml(t('adminBooks.bank.explainButton'))}</button>
          <button type="button" class="btn btn--ghost" data-suspense>
            ${escHtml(t('adminBooks.bank.suspenseButton'))}
          </button>
          <button type="button" class="btn btn--ghost" data-ignore>
            ${escHtml(t('adminBooks.bank.ignoreButton'))}
          </button>
        </div>
      </form>`;

    const body = this._el.querySelector('#bank-body');
    body.prepend(panel);

    const run = async (payload) => {
      try {
        await resolveBankTransaction(id, payload);
        showToast(t('adminBooks.bank.resolved'), 'success');
        panel.remove();
        this._loadStatus();
        this._load();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    panel.querySelectorAll('[data-pick-invoice]').forEach((b) => {
      b.addEventListener('click', () => run({ kind: 'invoice', invoice_id: b.dataset.pickInvoice }));
    });
    const form = panel.querySelector('[data-explain]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (!fd.get('account_code')) { showToast(t('adminBooks.bank.pickAccount'), 'error'); return; }
      run({ kind: 'explained', account_code: fd.get('account_code'), reason: fd.get('reason') });
    });
    panel.querySelector('[data-suspense]').addEventListener('click', () => {
      const reason = new FormData(form).get('reason');
      if (!String(reason || '').trim()) { showToast(t('adminBooks.bank.reasonRequired'), 'error'); return; }
      run({ kind: 'suspense', reason });
    });
    panel.querySelector('[data-ignore]').addEventListener('click', () => {
      const reason = new FormData(form).get('reason');
      if (!String(reason || '').trim()) { showToast(t('adminBooks.bank.reasonRequired'), 'error'); return; }
      run({ kind: 'ignore', reason });
    });
  }

  async _submit(form, action) {
    const button = form.querySelector('button[type="submit"]');
    this._busy = true;
    if (button) button.disabled = true;
    try {
      await action();
      this._loadStatus();
      this._load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
      if (button) button.disabled = false;
    }
  }

  destroy() {
    this._generation += 1;
  }
}
