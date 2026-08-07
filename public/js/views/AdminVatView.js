// AdminVatView (/admin/books/vat) — the VSK return.
//
// The screen is built around one idea: filing is the moment a number stops being
// yours and becomes something you have told Skatturinn. So it does not present a
// "file" button next to a total. It presents the RSK 10.01 boxes, says where each
// figure came from, lists what it thinks you should look at first, and only then
// offers to file — after which the period locks and the figures are frozen.
//
// Blockers are things that would make the return knowably wrong. They can be
// overridden, because a system that cannot be overridden gets worked around, but
// doing so demands a written reason that is stored with the return.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchVatPeriods, fetchVatPeriod, fileVatReturn, unlockVatPeriod, vatCsvUrl,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk, errorBanner } from './booksShared.js';

const LEVEL_TONE = { blocker: 'error', warning: 'warn', info: 'info' };

/**
 * A finding in the reader's language.
 *
 * The server sends a stable `code` plus structured params, and its own English
 * `message` as a fallback. This is the one screen where the TEXT IS THE PRODUCT —
 * these sentences are what stand between the owner and a wrong filing — so they are
 * translated rather than passed through. An unrecognised code falls back to the
 * server's wording, which is worse than a translation but far better than blank.
 */
function findingText(f) {
  const key = `adminBooks.vat.finding.${f.code}`;
  const params = {
    count: f.count,
    amount: f.amount === undefined ? '' : isk(f.amount),
    due_on: f.due_on || '',
    days: f.days_left === undefined ? '' : Math.abs(f.days_left),
    date: f.filed_at ? String(f.filed_at).slice(0, 10) : '',
  };
  const translated = t(key, params);
  // t() returns the key itself when there is no entry for it.
  return translated === key ? f.message : translated;
}

export class AdminVatView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._periods = [];
    this._selected = null;
    this._detail = null;
    this._busy = false;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('vat')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.vat.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.vat.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(vatCsvUrl())}">
            ${escHtml(t('adminBooks.exportCsv'))}
          </a>
        </div>
      </div>
      <div id="vat-periods"></div>
      <div id="vat-detail"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
    `;

    this._el.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-period]');
      if (pick) {
        this._selected = pick.dataset.period;
        this._loadDetail();
      }
    });

    await this._loadPeriods();
    return renderAdminShell({ activePath: '/admin/books/vat', content: this._el });
  }

  async _loadPeriods() {
    try {
      const { periods, current_period: current } = await fetchVatPeriods();
      this._periods = periods;
      // Default to the period we are actually in, falling back to the newest that
      // has any activity — an empty future period is a useless landing view.
      this._selected = this._selected
        || (periods.find(p => p.period === current) ? current : null)
        || (periods.find(p => p.entry_count > 0) || periods[0] || {}).period
        || null;
      this._paintPeriods();
      if (this._selected) await this._loadDetail();
      else this._el.querySelector('#vat-detail').innerHTML =
        `<p class="admin-shop__hint">${escHtml(t('adminBooks.vat.noPeriods'))}</p>`;
    } catch (err) {
      this._el.querySelector('#vat-detail').innerHTML = errorBanner(err.message);
    }
  }

  _paintPeriods() {
    const target = this._el.querySelector('#vat-periods');
    target.innerHTML = `
      <table class="admin-table books-table books-table--clickable">
        <thead><tr>
          <th>${escHtml(t('adminBooks.vat.period'))}</th>
          <th>${escHtml(t('adminBooks.vat.range'))}</th>
          <th>${escHtml(t('adminBooks.vat.deadline'))}</th>
          <th class="num">${escHtml(t('adminBooks.vat.entries'))}</th>
          <th class="num">${escHtml(t('adminBooks.vat.payable'))}</th>
          <th>${escHtml(t('adminBooks.col.status'))}</th>
        </tr></thead>
        <tbody>${this._periods.map(p => `
          <tr data-period="${escHtml(p.period)}"
              class="${p.period === this._selected ? 'is-selected' : ''}">
            <td>${escHtml(p.period)}</td>
            <td>${escHtml(`${p.starts_on} – ${p.ends_on}`)}</td>
            <td>${escHtml(p.due_on || '')}</td>
            <td class="num">${escHtml(String(p.entry_count))}</td>
            <td class="num">${p.payable === null ? '' : escHtml(isk(p.payable))}</td>
            <td>${p.filed
    ? `<span class="books-pill books-pill--ok">${escHtml(t('adminBooks.vat.filed'))}</span>`
    : (p.status === 'locked'
      ? `<span class="books-pill books-pill--muted">${escHtml(t('adminBooks.vat.locked'))}</span>`
      : `<span class="books-pill books-pill--info">${escHtml(t('adminBooks.vat.open'))}</span>`)}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async _loadDetail() {
    const generation = ++this._generation;
    const target = this._el.querySelector('#vat-detail');
    target.innerHTML = `<div class="admin-loading">${escHtml(t('form.loading'))}</div>`;
    this._paintPeriods();
    try {
      const detail = await fetchVatPeriod(this._selected);
      if (generation !== this._generation) return;
      this._detail = detail;
      target.innerHTML = this._renderDetail(detail);
      this._wireActions();
    } catch (err) {
      if (generation !== this._generation) return;
      target.innerHTML = errorBanner(err.message);
    }
  }

  _renderDetail(d) {
    // A filed period shows what WAS reported; an open one shows what the ledger
    // currently says. Both are labelled, because the difference between them is how
    // you notice something was back-dated into a closed period.
    const figures = d.filed || d.derived;
    const isFiled = Boolean(d.filed);

    const boxRow = (box, labelKey, value, hintKey) => `
      <tr>
        <td class="books-vat__box">${escHtml(box)}</td>
        <td>
          ${escHtml(t(labelKey))}
          <div class="books-muted">${escHtml(t(hintKey))}</div>
        </td>
        <td class="num">${escHtml(isk(value))}</td>
      </tr>`;

    return `
      <section class="books-section">
        <h2 class="books-section__title">
          ${escHtml(t('adminBooks.vat.returnFor', { period: d.period }))}
          ${isFiled
    ? `<span class="books-pill books-pill--ok">${escHtml(t('adminBooks.vat.filedOn', {
      date: String(d.filed.filed_at).slice(0, 10), who: d.filed.filed_by_username || '',
    }))}</span>`
    : ''}
        </h2>
        <p class="admin-shop__hint">${escHtml(
    isFiled ? t('adminBooks.vat.asFiledHint') : t('adminBooks.vat.derivedHint')
  )}</p>

        <table class="admin-table books-table books-vat__boxes">
          <tbody>
            ${boxRow('A', 'adminBooks.vat.boxA', figures.box_a_net_24, 'adminBooks.vat.boxAHint')}
            ${boxRow('B', 'adminBooks.vat.boxB', figures.box_b_net_11, 'adminBooks.vat.boxBHint')}
            ${boxRow('C', 'adminBooks.vat.boxC', figures.box_c_net_zero, 'adminBooks.vat.boxCHint')}
            ${boxRow('D', 'adminBooks.vat.boxD', figures.box_d_output, 'adminBooks.vat.boxDHint')}
            ${d.derived.output_vat_reverse_charge > 0 ? `
              <tr class="books-vat__sub">
                <td></td>
                <td>
                  ${escHtml(t('adminBooks.vat.boxDDomestic'))}
                  <div class="books-muted">${escHtml(t('adminBooks.vat.boxDSplitHint'))}</div>
                </td>
                <td class="num">${escHtml(isk(d.derived.output_vat_domestic))}</td>
              </tr>
              <tr class="books-vat__sub">
                <td></td>
                <td>${escHtml(t('adminBooks.vat.boxDReverse'))}</td>
                <td class="num">${escHtml(isk(d.derived.output_vat_reverse_charge))}</td>
              </tr>` : ''}
            ${boxRow('E', 'adminBooks.vat.boxE', figures.box_e_input, 'adminBooks.vat.boxEHint')}
            <tr class="books-totals__grand">
              <td class="books-vat__box">F</td>
              <td>
                ${escHtml(figures.box_f_payable >= 0
    ? t('adminBooks.vat.boxFPayable') : t('adminBooks.vat.boxFRefund'))}
                <div class="books-muted">${escHtml(t('adminBooks.vat.boxFHint'))}</div>
              </td>
              <td class="num"><strong>${escHtml(isk(Math.abs(figures.box_f_payable)))}</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      ${this._renderFindings(d.findings)}
      ${this._renderSources(d.derived)}
      ${isAdmin() ? this._renderActions(d, isFiled) : ''}
    `;
  }

  _renderFindings(findings) {
    if (!findings || !findings.length) {
      return `<div class="books-banner books-banner--ok">${
        escHtml(t('adminBooks.vat.nothingToReview'))}</div>`;
    }
    // Blockers first — the ordering is the advice.
    const order = { blocker: 0, warning: 1, info: 2 };
    const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.vat.review'))}</h2>
        ${sorted.map(f => `
          <div class="books-banner books-banner--${escHtml(LEVEL_TONE[f.level] || 'info')}">
            <strong>${escHtml(t(`adminBooks.vat.level.${f.level}`))}</strong>
            <div>${escHtml(findingText(f))}</div>
          </div>`).join('')}
      </section>`;
  }

  // Where each box came from. An accountant asking "which account is this 240.000"
  // should not have to run a query.
  _renderSources(derived) {
    const rows = (derived && derived.detail && derived.detail.by_account) || [];
    if (!rows.length) return '';
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.vat.sources'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.vat.sourcesHint'))}</p>
        <table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.expenses.account'))}</th>
            <th>${escHtml(t('adminBooks.vat.vatCode'))}</th>
            <th class="num">${escHtml(t('adminBooks.vat.debit'))}</th>
            <th class="num">${escHtml(t('adminBooks.vat.credit'))}</th>
            <th class="num">${escHtml(t('adminBooks.statement.balance'))}</th>
          </tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${escHtml(r.code)}</td>
              <td>${escHtml(r.vat_code || '')}</td>
              <td class="num">${escHtml(isk(r.debit))}</td>
              <td class="num">${escHtml(isk(r.credit))}</td>
              <td class="num">${escHtml(isk(r.balance))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </section>`;
  }

  _renderActions(d, isFiled) {
    if (isFiled) {
      return `
        <section class="books-section">
          <h2 class="books-section__title">${escHtml(t('adminBooks.vat.reopen'))}</h2>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.vat.reopenHint'))}</p>
          <form id="vat-unlock" class="books-form">
            <label>${escHtml(t('adminBooks.vat.reopenReason'))}
              <input type="text" name="reason" maxlength="300" required />
            </label>
            <button type="submit" class="btn btn--ghost">
              ${escHtml(t('adminBooks.vat.reopenButton'))}
            </button>
          </form>
        </section>`;
    }

    const blocked = !d.can_file;
    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.vat.fileTitle'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.vat.fileHint'))}</p>
        <form id="vat-file" class="books-form">
          <label>${escHtml(t('adminBooks.vat.note'))}
            <input type="text" name="note" maxlength="1000" />
          </label>
          ${blocked ? `
            <label class="books-check">
              <input type="checkbox" name="override" />
              ${escHtml(t('adminBooks.vat.override'))}
            </label>
            <p class="books-muted">${escHtml(t('adminBooks.vat.overrideHint'))}</p>` : ''}
          <button type="submit" class="btn"${blocked ? ' data-blocked="1"' : ''}>
            ${escHtml(t('adminBooks.vat.fileButton'))}
          </button>
        </form>
      </section>`;
  }

  _wireActions() {
    const fileForm = this._el.querySelector('#vat-file');
    if (fileForm) {
      fileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (this._busy) return;
        const fd = new FormData(fileForm);
        const override = fd.get('override') === 'on';
        // Filing locks the period. Confirm explicitly — this is not undoable
        // without an audited re-open.
        if (!window.confirm(t('adminBooks.vat.confirmFile', { period: this._selected }))) return;
        await this._submit(fileForm, () => fileVatReturn(this._selected, {
          note: fd.get('note') || '',
          override_blockers: override,
        }), t('adminBooks.vat.filedToast'));
      });
    }

    const unlockForm = this._el.querySelector('#vat-unlock');
    if (unlockForm) {
      unlockForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (this._busy) return;
        const fd = new FormData(unlockForm);
        if (!window.confirm(t('adminBooks.vat.confirmReopen'))) return;
        await this._submit(unlockForm, () => unlockVatPeriod(this._selected, {
          reason: fd.get('reason'),
        }), t('adminBooks.vat.reopenedToast'));
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
      await this._loadPeriods();
    } catch (err) {
      // The server's message explains what is blocking, so it is shown verbatim.
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
