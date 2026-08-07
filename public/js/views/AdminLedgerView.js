// AdminLedgerView (/admin/books/ledger) — the ledger itself and the reports on it.
//
// Every other books screen shows one kind of event. This one shows the thing they
// all write to, which makes it the screen an accountant asks for by name. Four
// reports, all read from the same posted journal lines, so they cannot disagree
// with each other or with the VSK return:
//
//   Prófjöfnuður  every account's debit and credit — if it does not balance,
//                 nothing else here is worth reading, so that verdict is stated
//                 outright rather than left to be inferred from two numbers
//   Rekstur       revenue less expenses for a period
//   Staða         assets, liabilities and equity as at a date
//   Dagbók        every posted entry, drillable to the document behind it
//
// Manual posting lives here too, admin-only. It is the sharpest tool in the system:
// it can put anything anywhere. So the form refuses to submit unbalanced, refuses
// to submit without an explanation, and shows the running debit/credit totals while
// you type — an unbalanced entry should be visible before it is attempted, not
// arrive as a server error.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchTrialBalance, fetchProfitAndLoss, fetchBalanceSheet, fetchJournal,
  fetchAccountLedger, fetchAccounts, postManualEntry, reverseJournalEntry,
  trialBalanceCsvUrl, journalCsvUrl,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk, statTile, errorBanner } from './booksShared.js';

const TABS = ['trial', 'pl', 'bs', 'journal'];
const PAGE_SIZE = 25;

// Source types the journal filter offers. Kept in step with the enum the controller
// validates against — an option here that the server rejects is a dead filter.
const SOURCE_TYPES = [
  'invoice', 'payment', 'credit_note', 'expense', 'manual', 'reversal',
  'vat_settlement', 'bank', 'stripe', 'payroll', 'pos', 'opening',
];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

export class AdminLedgerView {
  constructor() {
    this._el = null;
    // Bumped on every load so a slow response for a tab the user has already left
    // cannot paint over the tab they are now looking at.
    this._generation = 0;
    this._tab = 'trial';
    this._busy = false;
    this._accounts = [];
    this._range = { from: yearStart(), to: isoToday() };
    this._journal = { offset: 0, total: 0, sourceType: '', accountCode: '' };
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('ledger')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.ledger.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.ledger.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" id="tb-csv" href="#">${escHtml(t('adminBooks.ledger.tbCsv'))}</a>
          <a class="btn btn--ghost" id="jrn-csv" href="#">${escHtml(t('adminBooks.ledger.journalCsv'))}</a>
        </div>
      </div>

      <div class="books-filters">
        <label>${escHtml(t('adminBooks.ledger.rangeFrom'))}
          <input type="date" id="led-from" value="${escHtml(this._range.from)}" />
        </label>
        <label>${escHtml(t('adminBooks.ledger.rangeTo'))}
          <input type="date" id="led-to" value="${escHtml(this._range.to)}" />
        </label>
      </div>

      <div class="books-tabs" role="tablist">
        ${TABS.map(tab => `
          <button type="button" class="books-tab${tab === this._tab ? ' is-active' : ''}"
                  role="tab" data-tab="${escHtml(tab)}"
                  aria-selected="${tab === this._tab ? 'true' : 'false'}">
            ${escHtml(t(`adminBooks.ledger.tab.${tab}`))}
          </button>`).join('')}
      </div>

      <div id="led-body"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
      ${isAdmin() ? this._manualShell() : ''}
    `;

    this._el.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        this._tab = tab.dataset.tab;
        this._journal.offset = 0;
        this._syncTabs();
        this._load();
        return;
      }
      const page = e.target.closest('[data-page]');
      if (page) {
        this._journal.offset = Math.max(0, Number(page.dataset.page) || 0);
        this._load();
        return;
      }
      // Drilling into an account is the move that turns a report figure into an
      // explanation, so every code in every report is a link into it.
      const acct = e.target.closest('[data-account]');
      if (acct) {
        this._openAccount(acct.dataset.account);
        return;
      }
      const rev = e.target.closest('[data-reverse]');
      if (rev) this._reverse(rev.dataset.reverse, rev.dataset.number);
    });

    for (const id of ['#led-from', '#led-to']) {
      this._el.querySelector(id).addEventListener('change', () => {
        this._range.from = this._el.querySelector('#led-from').value || yearStart();
        this._range.to = this._el.querySelector('#led-to').value || isoToday();
        this._journal.offset = 0;
        this._syncCsvLinks();
        this._load();
      });
    }

    this._syncCsvLinks();
    if (isAdmin()) {
      this._wireManual();
      this._loadAccounts();
    }
    this._load();

    return renderAdminShell({ activePath: '/admin/books/ledger', content: this._el });
  }

  _syncTabs() {
    for (const btn of this._el.querySelectorAll('[data-tab]')) {
      const on = btn.dataset.tab === this._tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  // The CSV links carry the range currently on screen, so a download matches what
  // the user is looking at rather than silently exporting everything.
  _syncCsvLinks() {
    const params = { from: this._range.from, to: this._range.to };
    this._el.querySelector('#tb-csv').href = trialBalanceCsvUrl(params);
    this._el.querySelector('#jrn-csv').href = journalCsvUrl(params);
  }

  async _loadAccounts() {
    try {
      const { accounts } = await fetchAccounts();
      this._accounts = accounts;
      this._refreshAccountOptions();
    } catch { this._accounts = []; }
  }

  async _load() {
    const gen = ++this._generation;
    const body = this._el.querySelector('#led-body');
    body.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    try {
      const html = await this._buildTab();
      if (gen !== this._generation) return;
      body.innerHTML = html;
    } catch (err) {
      if (gen !== this._generation) return;
      body.innerHTML = errorBanner(err.message);
    }
  }

  async _buildTab() {
    const { from, to } = this._range;
    if (this._tab === 'trial') return this._trialHtml(await fetchTrialBalance({ from, to }));
    if (this._tab === 'pl') return this._plHtml(await fetchProfitAndLoss({ from, to }));
    if (this._tab === 'bs') return this._bsHtml(await fetchBalanceSheet({ to }));
    return this._journalHtml(await fetchJournal({
      from, to, limit: PAGE_SIZE, offset: this._journal.offset,
      source_type: this._journal.sourceType, account_code: this._journal.accountCode,
    }));
  }

  // ── Trial balance ──────────────────────────────────────────────────────────

  _trialHtml(tb) {
    if (!tb.accounts.length) return `<p class="admin-empty">${escHtml(t('adminBooks.ledger.empty'))}</p>`;
    // The verdict first. An out-of-balance trial balance means a bug in the ledger
    // triggers, not a data-entry mistake, so it is stated as an error and not a hint.
    const verdict = tb.balanced
      ? `<div class="books-banner books-banner--ok" role="status">
           ${escHtml(t('adminBooks.ledger.balanced'))}
         </div>`
      : errorBanner(t('adminBooks.ledger.unbalanced', { amount: isk(tb.difference) }));

    return `
      ${verdict}
      <table class="admin-table books-table">
        <thead><tr>
          <th>${escHtml(t('adminBooks.ledger.code'))}</th>
          <th>${escHtml(t('adminBooks.ledger.account'))}</th>
          <th>${escHtml(t('adminBooks.ledger.type'))}</th>
          <th class="num">${escHtml(t('adminBooks.ledger.debit'))}</th>
          <th class="num">${escHtml(t('adminBooks.ledger.credit'))}</th>
          <th class="num">${escHtml(t('adminBooks.ledger.balance'))}</th>
        </tr></thead>
        <tbody>
          ${tb.accounts.map(a => `
            <tr>
              <td><button type="button" class="books-link" data-account="${escHtml(a.code)}">${
                escHtml(a.code)}</button></td>
              <td>${escHtml(a.name)}</td>
              <td>${escHtml(t(`adminBooks.ledger.accountType.${a.type}`))}</td>
              <td class="num">${a.debit ? escHtml(isk(a.debit)) : ''}</td>
              <td class="num">${a.credit ? escHtml(isk(a.credit)) : ''}</td>
              <td class="num">${escHtml(isk(a.balance))}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <th colspan="3">${escHtml(t('adminBooks.ledger.total'))}</th>
          <th class="num">${escHtml(isk(tb.debit_total))}</th>
          <th class="num">${escHtml(isk(tb.credit_total))}</th>
          <th></th>
        </tr></tfoot>
      </table>`;
  }

  // ── Profit and loss ────────────────────────────────────────────────────────

  _plHtml(pl) {
    const section = (label, lines, total) => `
      <tbody>
        <tr class="books-row--head"><th colspan="2">${escHtml(label)}</th></tr>
        ${lines.length
    ? lines.map(l => `
            <tr>
              <td><button type="button" class="books-link" data-account="${escHtml(l.code)}">${
    escHtml(l.code)}</button> ${escHtml(l.name)}</td>
              <td class="num">${escHtml(isk(l.amount))}</td>
            </tr>`).join('')
    : `<tr><td colspan="2" class="admin-empty">${escHtml(t('adminBooks.ledger.none'))}</td></tr>`}
        <tr class="books-row--sum">
          <th>${escHtml(t('adminBooks.ledger.subtotal'))}</th>
          <th class="num">${escHtml(isk(total))}</th>
        </tr>
      </tbody>`;

    return `
      <div class="books-stats">
        ${statTile({
    label: t('adminBooks.ledger.revenueTotal'),
    value: isk(pl.revenue_total),
    hint: t('adminBooks.ledger.revenueHint'),
  })}
        ${statTile({
    label: t('adminBooks.ledger.expenseTotal'),
    value: isk(pl.expense_total),
    hint: t('adminBooks.ledger.expenseHint'),
  })}
        ${statTile({
    label: t('adminBooks.ledger.profit'),
    value: isk(pl.profit),
    hint: t('adminBooks.ledger.profitHint'),
    tone: pl.profit < 0 ? 'warn' : 'ok',
  })}
      </div>
      <table class="admin-table books-table">
        ${section(t('adminBooks.ledger.revenue'), pl.revenue, pl.revenue_total)}
        ${section(t('adminBooks.ledger.expenses'), pl.expenses, pl.expense_total)}
      </table>`;
  }

  // ── Balance sheet ──────────────────────────────────────────────────────────

  _bsHtml(bs) {
    const rows = lines => (lines.length
      ? lines.map(l => `
          <tr>
            <td><button type="button" class="books-link" data-account="${escHtml(l.code)}">${
    escHtml(l.code)}</button> ${escHtml(l.name)}</td>
            <td class="num">${escHtml(isk(l.amount))}</td>
          </tr>`).join('')
      : `<tr><td colspan="2" class="admin-empty">${escHtml(t('adminBooks.ledger.none'))}</td></tr>`);

    const verdict = bs.balanced
      ? ''
      : errorBanner(t('adminBooks.ledger.bsUnbalanced', { amount: isk(bs.difference) }));

    return `
      ${verdict}
      <p class="admin-shop__hint">${escHtml(t('adminBooks.ledger.asAt', { date: bs.as_at }))}</p>
      <div class="books-columns">
        <table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.ledger.assets'))}</th>
            <th class="num">${escHtml(isk(bs.asset_total))}</th>
          </tr></thead>
          <tbody>${rows(bs.assets)}</tbody>
        </table>
        <table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.ledger.liabilities'))}</th>
            <th class="num">${escHtml(isk(bs.liability_total))}</th>
          </tr></thead>
          <tbody>${rows(bs.liabilities)}</tbody>
          <thead><tr>
            <th>${escHtml(t('adminBooks.ledger.equity'))}</th>
            <th class="num">${escHtml(isk(bs.equity_total))}</th>
          </tr></thead>
          <tbody>
            ${rows(bs.equity)}
            <tr>
              <td>${escHtml(t('adminBooks.ledger.retained'))}</td>
              <td class="num">${escHtml(isk(bs.retained_earnings))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="admin-shop__hint">${escHtml(t('adminBooks.ledger.retainedHint'))}</p>`;
  }

  // ── Journal ────────────────────────────────────────────────────────────────

  _journalHtml(page) {
    this._journal.total = page.total;
    const filters = `
      <div class="books-filters">
        <label>${escHtml(t('adminBooks.ledger.source'))}
          <select id="jrn-source">
            <option value="">${escHtml(t('adminBooks.ledger.allSources'))}</option>
            ${SOURCE_TYPES.map(s => `<option value="${escHtml(s)}"${
    s === this._journal.sourceType ? ' selected' : ''}>${
    escHtml(t(`adminBooks.ledger.sourceType.${s}`))}</option>`).join('')}
          </select>
        </label>
        <label>${escHtml(t('adminBooks.ledger.accountFilter'))}
          <input type="text" id="jrn-account" inputmode="numeric"
                 value="${escHtml(this._journal.accountCode)}"
                 placeholder="${escHtml(t('adminBooks.ledger.accountPlaceholder'))}" />
        </label>
      </div>`;

    const body = page.entries.length
      ? page.entries.map(e => this._entryHtml(e)).join('')
      : `<p class="admin-empty">${escHtml(t('adminBooks.ledger.empty'))}</p>`;

    const html = `${filters}<div class="books-journal">${body}</div>${this._pagerHtml(page)}`;
    // Rewiring after each paint, because the filter controls are inside the tab body
    // that _load() replaces wholesale.
    setTimeout(() => this._wireJournalFilters(), 0);
    return html;
  }

  _entryHtml(e) {
    const corrected = e.is_correction || e.reverses_entry_id;
    return `
      <article class="books-entry${corrected ? ' books-entry--correction' : ''}">
        <header class="books-entry__head">
          <strong>#${escHtml(String(e.entry_number))}</strong>
          <span>${escHtml(e.entry_date)}</span>
          <span class="books-pill books-pill--info">${
    escHtml(t(`adminBooks.ledger.sourceType.${e.source_type}`))}</span>
          ${corrected ? `<span class="books-pill books-pill--muted">${
    escHtml(t('adminBooks.ledger.correction'))}</span>` : ''}
          <span class="books-entry__memo">${escHtml(e.memo || '')}</span>
          ${e.created_by_username
    ? `<span class="books-entry__by">${escHtml(t('adminBooks.ledger.by', { user: e.created_by_username }))}</span>`
    : ''}
          ${isAdmin() && !e.reverses_entry_id
    ? `<button type="button" class="btn btn--ghost btn--sm"
                 data-reverse="${escHtml(e.id)}" data-number="${escHtml(String(e.entry_number))}">
                 ${escHtml(t('adminBooks.ledger.reverse'))}
               </button>`
    : ''}
        </header>
        <table class="admin-table books-table books-table--tight">
          <tbody>
            ${e.lines.map(l => `
              <tr>
                <td><button type="button" class="books-link" data-account="${escHtml(l.account_code)}">${
    escHtml(l.account_code)}</button> ${escHtml(l.account_name)}</td>
                <td>${escHtml(l.memo || '')}</td>
                <td class="num">${l.debit ? escHtml(isk(l.debit)) : ''}</td>
                <td class="num">${l.credit ? escHtml(isk(l.credit)) : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </article>`;
  }

  _pagerHtml(page) {
    const { offset } = this._journal;
    const prev = Math.max(0, offset - PAGE_SIZE);
    const next = offset + PAGE_SIZE;
    if (page.total <= PAGE_SIZE) return '';
    return `
      <div class="books-pager">
        <button type="button" class="btn btn--ghost" data-page="${prev}"${offset === 0 ? ' disabled' : ''}>
          ${escHtml(t('form.previous'))}
        </button>
        <span>${escHtml(t('adminBooks.ledger.showing', {
    from: offset + 1,
    to: Math.min(next, page.total),
    total: page.total,
  }))}</span>
        <button type="button" class="btn btn--ghost" data-page="${next}"${
  next >= page.total ? ' disabled' : ''}>
          ${escHtml(t('form.next'))}
        </button>
      </div>`;
  }

  _wireJournalFilters() {
    const source = this._el && this._el.querySelector('#jrn-source');
    const account = this._el && this._el.querySelector('#jrn-account');
    if (source) {
      source.addEventListener('change', () => {
        this._journal.sourceType = source.value;
        this._journal.offset = 0;
        this._load();
      });
    }
    if (account) {
      account.addEventListener('change', () => {
        this._journal.accountCode = account.value.trim();
        this._journal.offset = 0;
        this._load();
      });
    }
  }

  // ── Account drill-down ─────────────────────────────────────────────────────

  async _openAccount(code) {
    const { from, to } = this._range;
    let data;
    try {
      data = await fetchAccountLedger(code, { from, to });
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    const dialog = document.createElement('div');
    dialog.className = 'books-modal';
    dialog.innerHTML = `
      <div class="books-modal__panel" role="dialog" aria-modal="true">
        <h3>${escHtml(data.account.code)} — ${escHtml(data.account.name)}</h3>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.ledger.opening', {
    amount: isk(data.opening_balance),
  }))}</p>
        ${data.truncated
    ? `<div class="books-banner books-banner--warn">${
      escHtml(t('adminBooks.ledger.truncated'))}</div>`
    : ''}
        <table class="admin-table books-table books-table--tight">
          <thead><tr>
            <th>${escHtml(t('adminBooks.ledger.entry'))}</th>
            <th>${escHtml(t('adminBooks.col.date'))}</th>
            <th>${escHtml(t('adminBooks.ledger.memo'))}</th>
            <th class="num">${escHtml(t('adminBooks.ledger.debit'))}</th>
            <th class="num">${escHtml(t('adminBooks.ledger.credit'))}</th>
            <th class="num">${escHtml(t('adminBooks.ledger.balance'))}</th>
          </tr></thead>
          <tbody>
            ${data.lines.map(l => `
              <tr>
                <td>#${escHtml(String(l.entry_number))}</td>
                <td>${escHtml(l.entry_date)}</td>
                <td>${escHtml(l.line_memo || l.memo || '')}</td>
                <td class="num">${l.debit ? escHtml(isk(l.debit)) : ''}</td>
                <td class="num">${l.credit ? escHtml(isk(l.credit)) : ''}</td>
                <td class="num">${escHtml(isk(l.balance))}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <th colspan="5">${escHtml(t('adminBooks.ledger.closing'))}</th>
            <th class="num">${escHtml(isk(data.closing_balance))}</th>
          </tr></tfoot>
        </table>
        <button type="button" class="btn" data-close>${escHtml(t('common.close'))}</button>
      </div>`;
    const close = () => dialog.remove();
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) close();
    });
    document.body.appendChild(dialog);
  }

  // ── Manual entry ───────────────────────────────────────────────────────────

  _manualShell() {
    return `
      <details class="books-manual">
        <summary>${escHtml(t('adminBooks.ledger.manualTitle'))}</summary>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.ledger.manualHint'))}</p>
        <form id="manual-entry" class="books-form">
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.col.date'))}
              <input type="date" name="entry_date" value="${escHtml(isoToday())}" required />
            </label>
            <label class="grow">${escHtml(t('adminBooks.ledger.memo'))}
              <input type="text" name="memo" maxlength="500" required
                     placeholder="${escHtml(t('adminBooks.ledger.memoPlaceholder'))}" />
            </label>
          </div>
          <div id="manual-lines"></div>
          <div class="books-form__row">
            <button type="button" class="btn btn--ghost btn--sm" id="manual-add">
              ${escHtml(t('adminBooks.ledger.addLine'))}
            </button>
            <span id="manual-totals" class="books-manual__totals"></span>
          </div>
          <button type="submit" class="btn" id="manual-submit">
            ${escHtml(t('adminBooks.ledger.post'))}
          </button>
        </form>
      </details>`;
  }

  _wireManual() {
    const form = this._el.querySelector('#manual-entry');
    const lines = this._el.querySelector('#manual-lines');
    // Two lines to start with, because the smallest legal entry has two — starting
    // with one invites a submit that cannot possibly balance.
    lines.appendChild(this._lineRow());
    lines.appendChild(this._lineRow());
    this._refreshAccountOptions();
    this._refreshTotals();

    this._el.querySelector('#manual-add').addEventListener('click', () => {
      lines.appendChild(this._lineRow());
      this._refreshAccountOptions();
      this._refreshTotals();
    });

    lines.addEventListener('input', () => this._refreshTotals());
    lines.addEventListener('click', (e) => {
      const drop = e.target.closest('[data-drop-line]');
      if (!drop) return;
      if (lines.children.length <= 2) {
        showToast(t('adminBooks.ledger.minLines'), 'error');
        return;
      }
      drop.closest('.books-manual__line').remove();
      this._refreshTotals();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitManual(form);
    });
  }

  _lineRow() {
    const row = document.createElement('div');
    row.className = 'books-manual__line';
    row.innerHTML = `
      <select name="account_code" required>
        <option value="">${escHtml(t('adminBooks.ledger.pickAccount'))}</option>
      </select>
      <input type="text" name="line_memo" maxlength="200"
             placeholder="${escHtml(t('adminBooks.ledger.memo'))}" />
      <input type="number" name="debit" min="0" step="1" inputmode="numeric"
             placeholder="${escHtml(t('adminBooks.ledger.debit'))}" />
      <input type="number" name="credit" min="0" step="1" inputmode="numeric"
             placeholder="${escHtml(t('adminBooks.ledger.credit'))}" />
      <button type="button" class="btn btn--ghost btn--sm" data-drop-line
              aria-label="${escHtml(t('adminBooks.ledger.removeLine'))}">×</button>`;
    return row;
  }

  // Rebuilt rather than cloned, so a row added before the accounts arrive still gets
  // its options once they do.
  _refreshAccountOptions() {
    if (!this._el || !this._accounts.length) return;
    for (const select of this._el.querySelectorAll('.books-manual__line select')) {
      const keep = select.value;
      select.innerHTML = `
        <option value="">${escHtml(t('adminBooks.ledger.pickAccount'))}</option>
        ${this._accounts.map(a => `<option value="${escHtml(a.code)}"${
  a.code === keep ? ' selected' : ''}>${escHtml(a.code)} — ${escHtml(a.name)}</option>`).join('')}`;
    }
  }

  // The running verdict. Shown while typing because "unbalanced by 1.000 kr" is a
  // useful thing to see mid-edit, and a useless thing to be told after a submit.
  _refreshTotals() {
    const rows = [...this._el.querySelectorAll('.books-manual__line')];
    let debit = 0;
    let credit = 0;
    for (const r of rows) {
      debit += Number(r.querySelector('[name="debit"]').value) || 0;
      credit += Number(r.querySelector('[name="credit"]').value) || 0;
    }
    const el = this._el.querySelector('#manual-totals');
    const diff = debit - credit;
    const balanced = diff === 0 && debit > 0;
    // Three states, not two: an untouched form is not 'out by nothing', it is empty.
    // Saying 'out by 0' on a blank form reads as a complaint about nothing.
    if (debit === 0 && credit === 0) {
      el.textContent = t('adminBooks.ledger.totalsIdle');
    } else if (balanced) {
      el.textContent = t('adminBooks.ledger.willBalance', { amount: isk(debit) });
    } else {
      el.textContent = t('adminBooks.ledger.offBy', {
        debit: isk(debit), credit: isk(credit), amount: isk(Math.abs(diff)),
      });
    }
    el.className = `books-manual__totals${balanced ? ' is-ok' : ' is-warn'}`;
  }

  async _submitManual(form) {
    if (this._busy) return;
    const rows = [...this._el.querySelectorAll('.books-manual__line')];
    const lines = [];
    for (const r of rows) {
      const code = r.querySelector('[name="account_code"]').value;
      const debit = Number(r.querySelector('[name="debit"]').value) || 0;
      const credit = Number(r.querySelector('[name="credit"]').value) || 0;
      if (!code && !debit && !credit) continue; // an untouched row is not an error
      if (!code) { showToast(t('adminBooks.ledger.needAccount'), 'error'); return; }
      if ((debit > 0) === (credit > 0)) {
        showToast(t('adminBooks.ledger.oneSideOnly'), 'error');
        return;
      }
      lines.push({
        account_code: code,
        ...(debit > 0 ? { debit } : { credit }),
        memo: r.querySelector('[name="line_memo"]').value.trim(),
      });
    }
    if (lines.length < 2) { showToast(t('adminBooks.ledger.minLines'), 'error'); return; }
    const debitTotal = lines.reduce((a, l) => a + (l.debit || 0), 0);
    const creditTotal = lines.reduce((a, l) => a + (l.credit || 0), 0);
    // Checked here as well as by the database trigger. The trigger is the guarantee;
    // this is so the user gets a sentence instead of a constraint violation.
    if (debitTotal !== creditTotal) {
      showToast(t('adminBooks.ledger.mustBalance', { amount: isk(Math.abs(debitTotal - creditTotal)) }), 'error');
      return;
    }

    this._busy = true;
    const submit = this._el.querySelector('#manual-submit');
    submit.disabled = true;
    try {
      const { entry } = await postManualEntry({
        entry_date: form.elements.entry_date.value,
        memo: form.elements.memo.value.trim(),
        lines,
      });
      showToast(t('adminBooks.ledger.posted', { number: entry.entry_number }), 'success');
      form.reset();
      const holder = this._el.querySelector('#manual-lines');
      holder.innerHTML = '';
      holder.appendChild(this._lineRow());
      holder.appendChild(this._lineRow());
      this._refreshAccountOptions();
      this._refreshTotals();
      this._load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
      submit.disabled = false;
    }
  }

  // Reversal, not deletion — the entry stays and a mirror entry cancels it. The
  // reason is required because a reversal with no reason leaves two entries and no
  // explanation of which one was the mistake.
  async _reverse(id, number) {
    const reason = window.prompt(t('adminBooks.ledger.reversePrompt', { number }));
    if (reason === null) return;
    if (!reason.trim()) { showToast(t('adminBooks.ledger.reasonRequired'), 'error'); return; }
    try {
      const { entry } = await reverseJournalEntry(id, reason.trim());
      showToast(t('adminBooks.ledger.reversed', { number: entry.entry_number }), 'success');
      this._load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  destroy() {
    this._generation++;
    this._el = null;
  }
}
