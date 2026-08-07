// AdminPayrollView (/admin/books/payroll) — laun.
//
// This screen has an unusual job: most of the time its most important output is a
// REFUSAL. Payroll will not compute anything for a tax year whose figures nobody has
// confirmed, so the first thing the page has to do is explain that clearly enough that
// the owner knows what to go and look up, rather than reading it as a bug.
//
// So the layout is ordered by what blocks what:
//
//   1. Skattár      the statutory figures for the year, and whether a person has
//                   confirmed them against Skatturinn's published table. Nothing below
//                   works until this is green.
//   2. Starfsmenn   who is paid, at what, and on which rates
//   3. Launagreiðslur  the runs: draft, post, reverse, pay
//   4. Skuldir      what is currently owed to Skatturinn, the pension fund and the
//                   employees — read from the LEDGER, so it reflects what has actually
//                   been remitted rather than what was computed
//
// A note on the rate fields: they are entered as PERCENTAGES in the form because that is
// how Skatturinn publishes them, and converted to decimals on the way out. Asking
// someone to type 0.0635 when the table in front of them says 6.35% is how a
// transcription error gets made.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchPayrollYears, fetchPayrollYear, savePayrollYear, confirmPayrollYear,
  fetchEmployees, createEmployee, updateEmployee,
  fetchPayrollRuns, fetchPayrollRun, createPayrollRun, postPayrollRun,
  reversePayrollRun, payPayrollRun, payslipPdfUrl, payrollCsvUrl,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { isk, statTile, errorBanner } from './booksShared.js';

const EMPLOYMENT_TYPES = ['employee', 'owner', 'contractor'];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// Percent in the form, decimal on the wire. One place for the conversion, so a field
// added later cannot get it the other way round.
function pctToRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

function rateToPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  // Trailing zeros stripped so 6.35 does not read as 6.3500.
  return String(Number((n * 100).toFixed(4)));
}

export class AdminPayrollView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._busy = false;
    this._years = [];
    this._year = null;          // the selected year's detail
    this._employees = [];
    this._runs = [];
    this._liabilities = [];
    this._selectedYear = new Date().getFullYear();
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('payroll')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    this._el = document.createElement('div');
    this._el.className = 'main admin-page admin-books';
    this._el.innerHTML = `
      <div class="admin-books__head">
        <div>
          <h1 class="admin-title">${escHtml(t('adminBooks.payroll.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(payrollCsvUrl())}">
            ${escHtml(t('adminBooks.exportCsv'))}
          </a>
        </div>
      </div>
      <div id="pay-year"></div>
      <div id="pay-liabilities"></div>
      <div id="pay-employees"></div>
      <div id="pay-runs"></div>
    `;

    this._el.addEventListener('click', (e) => {
      const openRun = e.target.closest('[data-run]');
      if (openRun) { this._openRun(openRun.dataset.run); return; }
      const post = e.target.closest('[data-post-run]');
      if (post) { this._postRun(post.dataset.postRun); return; }
      const reverse = e.target.closest('[data-reverse-run]');
      if (reverse) { this._reverseRun(reverse.dataset.reverseRun); return; }
      const pay = e.target.closest('[data-pay-run]');
      if (pay) { this._payRun(pay.dataset.payRun, Number(pay.dataset.net)); return; }
      const editEmp = e.target.closest('[data-edit-employee]');
      if (editEmp) { this._openEmployeeForm(editEmp.dataset.editEmployee); return; }
      const newEmp = e.target.closest('[data-new-employee]');
      if (newEmp) { this._openEmployeeForm(null); return; }
      const confirmYear = e.target.closest('[data-confirm-year]');
      if (confirmYear) { this._confirmYear(Number(confirmYear.dataset.confirmYear)); return; }
      const editYear = e.target.closest('[data-edit-year]');
      if (editYear) this._openYearForm(Number(editYear.dataset.editYear));
    });

    await this._loadAll();
    return renderAdminShell({ activePath: '/admin/books/payroll', content: this._el });
  }

  async _loadAll() {
    const gen = ++this._generation;
    try {
      const [{ years }, { employees }, runs] = await Promise.all([
        fetchPayrollYears(),
        fetchEmployees({ include_inactive: 'true' }),
        fetchPayrollRuns({ limit: 24 }),
      ]);
      if (gen !== this._generation) return;
      this._years = years;
      this._employees = employees;
      this._runs = runs.runs;
      this._liabilities = runs.liabilities || [];

      // Default to the year the operator most likely wants: the current one if it has
      // figures, otherwise the newest year that has any.
      const current = years.find(y => y.tax_year === this._selectedYear);
      this._selectedYear = current ? current.tax_year
        : (years.length ? years[0].tax_year : new Date().getFullYear());

      this._year = null;
      if (years.some(y => y.tax_year === this._selectedYear)) {
        try {
          this._year = await fetchPayrollYear(this._selectedYear);
        } catch { this._year = null; }
      }
      if (gen !== this._generation) return;
      this._paint();
    } catch (err) {
      if (gen !== this._generation) return;
      this._el.querySelector('#pay-year').innerHTML = errorBanner(err.message);
    }
  }

  _paint() {
    this._el.querySelector('#pay-year').innerHTML = this._yearHtml();
    this._el.querySelector('#pay-liabilities').innerHTML = this._liabilitiesHtml();
    this._el.querySelector('#pay-employees').innerHTML = this._employeesHtml();
    this._el.querySelector('#pay-runs').innerHTML = this._runsHtml();
    this._wireYearPicker();
    if (isAdmin()) this._wireNewRun();
  }

  // ── The gate ───────────────────────────────────────────────────────────────

  _yearHtml() {
    const picker = `
      <div class="books-filters">
        <label>${escHtml(t('adminBooks.payroll.taxYear'))}
          <select id="pay-year-pick">
            ${this._yearOptions().map(y => `
              <option value="${y}"${y === this._selectedYear ? ' selected' : ''}>${y}</option>
            `).join('')}
          </select>
        </label>
        ${isAdmin() ? `
          <button type="button" class="btn btn--ghost btn--sm"
                  data-edit-year="${this._selectedYear}">
            ${escHtml(t('adminBooks.payroll.editFigures'))}
          </button>` : ''}
      </div>`;

    if (!this._year) {
      // The refusal, stated as a to-do with the source named. This is the message the
      // owner will see every January, so it has to say where to look.
      return `${picker}
        <div class="books-banner books-banner--warn" role="status">
          <strong>${escHtml(t('adminBooks.payroll.noFiguresTitle', { year: this._selectedYear }))}</strong>
          <p>${escHtml(t('adminBooks.payroll.noFiguresBody'))}</p>
        </div>`;
    }

    const y = this._year;
    const confirmed = Boolean(y.confirmed_at);
    const banner = confirmed
      ? `<div class="books-banner books-banner--ok" role="status">
           ${escHtml(t('adminBooks.payroll.confirmedBy', {
    date: String(y.confirmed_at).slice(0, 10),
    user: y.confirmed_by_username || '',
  }))}
           ${y.source_note ? `<p>${escHtml(y.source_note)}</p>` : ''}
         </div>`
      : `<div class="books-banner books-banner--error" role="alert">
           <strong>${escHtml(t('adminBooks.payroll.unconfirmedTitle', { year: y.year }))}</strong>
           <p>${escHtml(t('adminBooks.payroll.unconfirmedBody'))}</p>
           ${isAdmin() ? `
             <button type="button" class="btn" data-confirm-year="${y.year}">
               ${escHtml(t('adminBooks.payroll.confirmButton'))}
             </button>` : ''}
         </div>`;

    return `
      ${picker}
      ${banner}
      <div class="books-columns">
        <table class="admin-table books-table books-table--tight">
          <thead><tr>
            <th>${escHtml(t('adminBooks.payroll.figure'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.value'))}</th>
          </tr></thead>
          <tbody>
            <tr><td>${escHtml(t('adminBooks.payroll.personalAllowance'))}</td>
                <td class="num">${escHtml(isk(y.personal_allowance))}</td></tr>
            <tr><td>${escHtml(t('adminBooks.payroll.socialSecurity'))}</td>
                <td class="num">${escHtml(rateToPct(y.social_security_bp / 10000))}%</td></tr>
            <tr><td>${escHtml(t('adminBooks.payroll.pensionEmployee'))}</td>
                <td class="num">${escHtml(rateToPct(y.pension_employee_bp / 10000))}%</td></tr>
            <tr><td>${escHtml(t('adminBooks.payroll.pensionEmployer'))}</td>
                <td class="num">${escHtml(rateToPct(y.pension_employer_bp / 10000))}%</td></tr>
            <tr><td>${escHtml(t('adminBooks.payroll.municipalRate'))}</td>
                <td class="num">${escHtml(rateToPct(y.municipal_rate_bp / 10000))}%</td></tr>
          </tbody>
        </table>
        <table class="admin-table books-table books-table--tight">
          <thead><tr>
            <th>${escHtml(t('adminBooks.payroll.bandFrom'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.bandRate'))}</th>
          </tr></thead>
          <tbody>
            ${y.bands.map(b => `
              <tr>
                <td>${escHtml(isk(b.income_from))}</td>
                <td class="num">${escHtml(rateToPct(b.rate_bp / 10000))}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.bandsHint'))}</p>
      ${y.reference_wages && y.reference_wages.length ? `
        <table class="admin-table books-table books-table--tight">
          <thead><tr>
            <th>${escHtml(t('adminBooks.payroll.refCategory'))}</th>
            <th>${escHtml(t('adminBooks.payroll.refDescription'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.refMinimum'))}</th>
          </tr></thead>
          <tbody>
            ${y.reference_wages.map(w => `
              <tr>
                <td>${escHtml(w.category)}</td>
                <td>${escHtml(w.description || '')}</td>
                <td class="num">${escHtml(isk(w.monthly_min))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.refHint'))}</p>` : ''}
    `;
  }

  // The picker offers the years that have figures plus the current and next one, so a
  // year can be set up before January rather than in a hurry during it.
  _yearOptions() {
    const now = new Date().getFullYear();
    const set = new Set(this._years.map(y => y.tax_year));
    set.add(now);
    set.add(now + 1);
    set.add(this._selectedYear);
    return [...set].sort((a, b) => b - a);
  }

  _wireYearPicker() {
    const pick = this._el.querySelector('#pay-year-pick');
    if (!pick) return;
    pick.addEventListener('change', async () => {
      this._selectedYear = Number(pick.value);
      try {
        this._year = await fetchPayrollYear(this._selectedYear);
      } catch { this._year = null; }
      this._paint();
    });
  }

  // ── Liabilities ────────────────────────────────────────────────────────────

  _liabilitiesHtml() {
    const owed = this._liabilities.filter(l => l.balance !== 0);
    if (!owed.length) return '';
    return `
      <h3>${escHtml(t('adminBooks.payroll.owed'))}</h3>
      <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.owedHint'))}</p>
      <div class="books-stats">
        ${owed.map(l => statTile({
    label: l.name,
    value: isk(l.balance),
    hint: l.code,
    tone: l.balance > 0 ? 'warn' : '',
  })).join('')}
      </div>`;
  }

  // ── Employees ──────────────────────────────────────────────────────────────

  _employeesHtml() {
    return `
      <div class="admin-books__head">
        <h3>${escHtml(t('adminBooks.payroll.employees'))}</h3>
        ${isAdmin() ? `
          <button type="button" class="btn btn--ghost btn--sm" data-new-employee>
            ${escHtml(t('adminBooks.payroll.addEmployee'))}
          </button>` : ''}
      </div>
      ${this._employees.length ? `
        <table class="admin-table books-table">
          <thead><tr>
            <th>${escHtml(t('adminBooks.payroll.name'))}</th>
            <th>${escHtml(t('adminBooks.detail.kennitala'))}</th>
            <th>${escHtml(t('adminBooks.payroll.type'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.salary'))}</th>
            <th>${escHtml(t('adminBooks.payroll.pensionFund'))}</th>
            <th>${escHtml(t('adminBooks.col.status'))}</th>
            ${isAdmin() ? '<th></th>' : ''}
          </tr></thead>
          <tbody>
            ${this._employees.map(e => `
              <tr${e.is_active ? '' : ' class="is-muted"'}>
                <td>${escHtml(e.full_name)}</td>
                <td>${escHtml(e.kennitala)}</td>
                <td>${escHtml(t(`adminBooks.payroll.type.${e.employment_type}`))}${
  e.employment_type === 'owner' && e.reference_wage_category
    ? ` <span class="books-pill books-pill--info">${escHtml(e.reference_wage_category)}</span>` : ''}</td>
                <td class="num">${escHtml(isk(e.monthly_salary))}</td>
                <td>${escHtml(e.pension_fund || '—')}</td>
                <td>${escHtml(e.is_active
    ? t('adminBooks.payroll.active') : t('adminBooks.payroll.inactive'))}</td>
                ${isAdmin() ? `<td>
                  <button type="button" class="btn btn--ghost btn--sm"
                          data-edit-employee="${escHtml(e.id)}">
                    ${escHtml(t('form.edit'))}
                  </button></td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>`
    : `<p class="admin-empty">${escHtml(t('adminBooks.payroll.noEmployees'))}</p>`}
    `;
  }

  // ── Runs ───────────────────────────────────────────────────────────────────

  _runsHtml() {
    const canRun = Boolean(this._year && this._year.confirmed_at) && isAdmin();
    return `
      <div class="admin-books__head">
        <h3>${escHtml(t('adminBooks.payroll.runs'))}</h3>
      </div>
      ${canRun ? `
        <form id="pay-new-run" class="books-form">
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.period'))}
              <input type="month" name="period" required value="${escHtml(isoToday().slice(0, 7))}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.payDate'))}
              <input type="date" name="pay_date" required value="${escHtml(isoToday())}" />
            </label>
            <button type="submit" class="btn">${escHtml(t('adminBooks.payroll.draftRun'))}</button>
          </div>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.draftHint'))}</p>
        </form>` : ''}
      ${this._runs.length ? `
        <table class="admin-table books-table books-table--clickable">
          <thead><tr>
            <th>${escHtml(t('adminBooks.payroll.period'))}</th>
            <th>${escHtml(t('adminBooks.payroll.payDate'))}</th>
            <th>${escHtml(t('adminBooks.col.status'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.gross'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.withholding'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.net'))}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${this._runs.map(r => `
              <tr>
                <td><button type="button" class="books-link" data-run="${escHtml(r.id)}">${
  escHtml(r.period)}</button></td>
                <td>${escHtml(r.pay_date)}</td>
                <td><span class="books-pill books-pill--${escHtml(this._runTone(r.status))}">${
  escHtml(t(`adminBooks.payroll.status.${r.status}`))}</span></td>
                <td class="num">${escHtml(isk(r.gross_total))}</td>
                <td class="num">${escHtml(isk(r.withholding_total))}</td>
                <td class="num">${escHtml(isk(r.net_total))}</td>
                <td>${isAdmin() ? this._runActions(r) : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
    : `<p class="admin-empty">${escHtml(t('adminBooks.payroll.noRuns'))}</p>`}
    `;
  }

  _runTone(status) {
    return { draft: 'muted', posted: 'info', settled: 'ok', reversed: 'muted' }[status] || 'muted';
  }

  _runActions(r) {
    if (r.status === 'draft') {
      return `<button type="button" class="btn btn--sm" data-post-run="${escHtml(r.id)}">
                ${escHtml(t('adminBooks.payroll.post'))}
              </button>`;
    }
    if (r.status === 'posted') {
      return `
        <button type="button" class="btn btn--sm" data-pay-run="${escHtml(r.id)}"
                data-net="${r.net_total}">
          ${escHtml(t('adminBooks.payroll.pay'))}
        </button>
        <button type="button" class="btn btn--ghost btn--sm" data-reverse-run="${escHtml(r.id)}">
          ${escHtml(t('adminBooks.ledger.reverse'))}
        </button>`;
    }
    if (r.status === 'settled') {
      return `<button type="button" class="btn btn--ghost btn--sm"
                      data-reverse-run="${escHtml(r.id)}">
                ${escHtml(t('adminBooks.ledger.reverse'))}
              </button>`;
    }
    return '';
  }

  _wireNewRun() {
    const form = this._el.querySelector('#pay-new-run');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this._busy) return;
      this._busy = true;
      try {
        const { preflight } = await createPayrollRun({
          period: form.elements.period.value,
          pay_date: form.elements.pay_date.value,
        });
        const blockers = (preflight.findings || []).filter(f => f.level === 'blocker');
        showToast(blockers.length
          ? t('adminBooks.payroll.draftedWithBlockers', { count: blockers.length })
          : t('adminBooks.payroll.drafted'), blockers.length ? 'error' : 'success');
        await this._loadAll();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        this._busy = false;
      }
    });
  }

  // ── Run detail ─────────────────────────────────────────────────────────────

  async _openRun(id) {
    let data;
    try {
      data = await fetchPayrollRun(id);
    } catch (err) { showToast(err.message, 'error'); return; }
    const { run, payslips } = data;
    const findings = (run.preflight && run.preflight.findings) || [];

    const dialog = document.createElement('div');
    dialog.className = 'books-modal';
    dialog.innerHTML = `
      <div class="books-modal__panel" role="dialog" aria-modal="true">
        <h3>${escHtml(t('adminBooks.payroll.runTitle', { period: run.period }))}</h3>
        <p class="admin-shop__hint">
          ${escHtml(t('adminBooks.payroll.payDate'))}: ${escHtml(run.pay_date)} ·
          ${escHtml(t('adminBooks.payroll.taxYear'))}: ${escHtml(String(run.tax_year))} ·
          ${escHtml(t(`adminBooks.payroll.status.${run.status}`))}
        </p>
        ${run.preflight && run.preflight.overridden
    ? `<div class="books-banner books-banner--warn">
             <strong>${escHtml(t('adminBooks.payroll.overridden'))}</strong>
             <p>${escHtml(run.preflight.overridden)}</p>
           </div>` : ''}
        ${findings.length ? `
          <ul class="books-findings">
            ${findings.map(f => `<li class="is-${escHtml(f.level)}">${escHtml(f.message)}</li>`).join('')}
          </ul>` : ''}
        <table class="admin-table books-table books-table--tight">
          <thead><tr>
            <th>${escHtml(t('adminBooks.payroll.name'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.gross'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.pension'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.taxable'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.withholding'))}</th>
            <th class="num">${escHtml(t('adminBooks.payroll.net'))}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${payslips.map(s => `
              <tr>
                <td>${escHtml(s.employee_name || '')}</td>
                <td class="num">${escHtml(isk(s.gross))}</td>
                <td class="num">${escHtml(isk(s.pension_employee))}</td>
                <td class="num">${escHtml(isk(s.taxable_base))}</td>
                <td class="num">${escHtml(isk(s.withholding))}</td>
                <td class="num">${escHtml(isk(s.net_pay))}</td>
                <td><a class="btn btn--ghost btn--sm" target="_blank" rel="noopener"
                       href="${escHtml(payslipPdfUrl(s.id))}">
                  ${escHtml(t('adminBooks.payroll.payslip'))}
                </a></td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <th>${escHtml(t('adminBooks.ledger.total'))}</th>
            <th class="num">${escHtml(isk(run.gross_total))}</th>
            <th class="num">${escHtml(isk(run.pension_employee_total))}</th>
            <th></th>
            <th class="num">${escHtml(isk(run.withholding_total))}</th>
            <th class="num">${escHtml(isk(run.net_total))}</th>
            <th></th>
          </tr></tfoot>
        </table>
        <p class="admin-shop__hint">
          ${escHtml(t('adminBooks.payroll.employerCost', {
    amount: isk(run.gross_total + run.social_security_total + run.pension_employer_total),
  }))}
        </p>
        <button type="button" class="btn" data-close>${escHtml(t('common.close'))}</button>
      </div>`;
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.remove();
    });
    document.body.appendChild(dialog);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async _postRun(id) {
    if (this._busy) return;
    if (!window.confirm(t('adminBooks.payroll.confirmPost'))) return;
    this._busy = true;
    try {
      await postPayrollRun(id);
      showToast(t('adminBooks.payroll.posted'), 'success');
      await this._loadAll();
    } catch (err) {
      if (err.findings && err.findings.length) {
        // The blockers, then one question. Showing them and asking in the same breath is
        // the difference between an override that was considered and one that was
        // clicked through.
        const blockers = err.findings.filter(f => f.level === 'blocker').map(f => f.message);
        const reason = window.prompt(
          `${blockers.join('\n\n')}\n\n${t('adminBooks.payroll.overridePrompt')}`
        );
        if (reason && reason.trim()) {
          try {
            await postPayrollRun(id, reason.trim());
            showToast(t('adminBooks.payroll.postedOverridden'), 'success');
            await this._loadAll();
          } catch (e2) { showToast(e2.message, 'error'); }
        }
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      this._busy = false;
    }
  }

  async _reverseRun(id) {
    const reason = window.prompt(t('adminBooks.payroll.reversePrompt'));
    if (reason === null) return;
    if (!reason.trim()) { showToast(t('adminBooks.ledger.reasonRequired'), 'error'); return; }
    try {
      await reversePayrollRun(id, reason.trim());
      showToast(t('adminBooks.payroll.reversed'), 'success');
      await this._loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async _payRun(id, net) {
    const raw = window.prompt(t('adminBooks.payroll.payPrompt', { amount: isk(net) }), String(net));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount <= 0) {
      showToast(t('adminBooks.payroll.badAmount'), 'error');
      return;
    }
    try {
      await payPayrollRun(id, { amount, paid_on: isoToday() });
      showToast(t('adminBooks.payroll.paid'), 'success');
      await this._loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async _confirmYear(year) {
    const note = window.prompt(t('adminBooks.payroll.confirmPrompt', { year }));
    if (note === null) return;
    if (!note.trim()) { showToast(t('adminBooks.payroll.notePrompt'), 'error'); return; }
    try {
      await confirmPayrollYear(year, note.trim());
      showToast(t('adminBooks.payroll.yearConfirmed', { year }), 'success');
      await this._loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // ── Forms ──────────────────────────────────────────────────────────────────

  /**
   * The year's figures.
   *
   * Every field is a number read off a published table, so the form says WHERE to read
   * it from rather than assuming the operator knows. Rates are entered as percentages,
   * because asking for 0.0635 when the table says 6.35% is how a units error happens.
   */
  _openYearForm(year) {
    const y = this._year && this._year.year === year ? this._year : null;
    const bands = y ? y.bands : [{ income_from: 0, rate_bp: 0 }];

    const dialog = document.createElement('div');
    dialog.className = 'books-modal';
    dialog.innerHTML = `
      <div class="books-modal__panel" role="dialog" aria-modal="true">
        <h3>${escHtml(t('adminBooks.payroll.yearFormTitle', { year }))}</h3>
        <div class="books-banner books-banner--info">
          ${escHtml(t('adminBooks.payroll.yearFormHint'))}
        </div>
        <form id="year-form" class="books-form">
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.personalAllowance'))} (kr.)
              <input type="number" name="personal_allowance" min="0" step="1" required
                     value="${y ? y.personal_allowance : ''}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.socialSecurity'))} (%)
              <input type="number" name="social_security" min="0" step="0.01" required
                     value="${y ? rateToPct(y.social_security_bp / 10000) : ''}" />
            </label>
          </div>
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.pensionEmployee'))} (%)
              <input type="number" name="pension_employee" min="0" step="0.01" required
                     value="${y ? rateToPct(y.pension_employee_bp / 10000) : ''}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.pensionEmployer'))} (%)
              <input type="number" name="pension_employer" min="0" step="0.01" required
                     value="${y ? rateToPct(y.pension_employer_bp / 10000) : ''}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.municipalRate'))} (%)
              <input type="number" name="municipal_rate" min="0" step="0.01" required
                     value="${y ? rateToPct(y.municipal_rate_bp / 10000) : ''}" />
            </label>
          </div>
          <h4>${escHtml(t('adminBooks.payroll.bands'))}</h4>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.bandsFormHint'))}</p>
          <div id="year-bands">
            ${bands.map(b => this._bandRowHtml(b)).join('')}
          </div>
          <button type="button" class="btn btn--ghost btn--sm" id="year-add-band">
            ${escHtml(t('adminBooks.payroll.addBand'))}
          </button>
          <label>${escHtml(t('adminBooks.payroll.sourceNote'))}
            <input type="text" name="source_note" maxlength="500"
                   placeholder="${escHtml(t('adminBooks.payroll.sourcePlaceholder'))}"
                   value="${escHtml(y ? y.source_note || '' : '')}" />
          </label>
          <div class="books-form__row">
            <button type="submit" class="btn">${escHtml(t('form.save'))}</button>
            <button type="button" class="btn btn--ghost" data-close>${escHtml(t('form.cancel'))}</button>
          </div>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.saveUnconfirms'))}</p>
        </form>
      </div>`;

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) { dialog.remove(); return; }
      if (e.target.closest('#year-add-band')) {
        dialog.querySelector('#year-bands').insertAdjacentHTML('beforeend',
          this._bandRowHtml({ income_from: '', rate_bp: '' }));
        return;
      }
      const drop = e.target.closest('[data-drop-band]');
      if (drop) {
        const rows = dialog.querySelectorAll('.books-band__row');
        if (rows.length <= 1) { showToast(t('adminBooks.payroll.needOneBand'), 'error'); return; }
        drop.closest('.books-band__row').remove();
      }
    });

    dialog.querySelector('#year-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const bandRows = [...dialog.querySelectorAll('.books-band__row')];
      const payload = {
        personal_allowance: Number(form.elements.personal_allowance.value),
        municipal_rate: pctToRate(form.elements.municipal_rate.value),
        social_security: pctToRate(form.elements.social_security.value),
        pension_employee: pctToRate(form.elements.pension_employee.value),
        pension_employer: pctToRate(form.elements.pension_employer.value),
        source_note: form.elements.source_note.value.trim(),
        bands: bandRows.map(r => ({
          from: Number(r.querySelector('[name="band_from"]').value) || 0,
          rate: pctToRate(r.querySelector('[name="band_rate"]').value),
        })),
      };
      try {
        await savePayrollYear(year, payload);
        showToast(t('adminBooks.payroll.figuresSaved'), 'success');
        dialog.remove();
        await this._loadAll();
      } catch (err) { showToast(err.message, 'error'); }
    });

    document.body.appendChild(dialog);
  }

  _bandRowHtml(band) {
    const from = band.income_from === '' ? '' : band.income_from;
    const rate = band.rate_bp === '' ? '' : rateToPct(band.rate_bp / 10000);
    return `
      <div class="books-band__row">
        <label>${escHtml(t('adminBooks.payroll.bandFrom'))} (kr.)
          <input type="number" name="band_from" min="0" step="1" value="${escHtml(String(from))}" />
        </label>
        <label>${escHtml(t('adminBooks.payroll.bandRate'))} (%)
          <input type="number" name="band_rate" min="0" step="0.01" value="${escHtml(String(rate))}" />
        </label>
        <button type="button" class="btn btn--ghost btn--sm" data-drop-band
                aria-label="${escHtml(t('adminBooks.ledger.removeLine'))}">×</button>
      </div>`;
  }

  _openEmployeeForm(id) {
    const e = id ? this._employees.find(x => x.id === id) : null;
    const dialog = document.createElement('div');
    dialog.className = 'books-modal';
    dialog.innerHTML = `
      <div class="books-modal__panel" role="dialog" aria-modal="true">
        <h3>${escHtml(e ? t('adminBooks.payroll.editEmployee') : t('adminBooks.payroll.addEmployee'))}</h3>
        <form id="emp-form" class="books-form">
          <div class="books-form__row">
            <label class="grow">${escHtml(t('adminBooks.payroll.name'))}
              <input type="text" name="full_name" maxlength="200" required
                     value="${escHtml(e ? e.full_name : '')}" />
            </label>
            <label>${escHtml(t('adminBooks.detail.kennitala'))}
              <input type="text" name="kennitala" maxlength="20" required
                     value="${escHtml(e ? e.kennitala : '')}" />
            </label>
          </div>
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.type'))}
              <select name="employment_type">
                ${EMPLOYMENT_TYPES.map(x => `
                  <option value="${x}"${e && e.employment_type === x ? ' selected' : ''}>${
  escHtml(t(`adminBooks.payroll.type.${x}`))}</option>`).join('')}
              </select>
            </label>
            <label>${escHtml(t('adminBooks.payroll.salary'))} (kr.)
              <input type="number" name="monthly_salary" min="0" step="1"
                     value="${e ? e.monthly_salary : 0}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.allowanceFactor'))} (%)
              <input type="number" name="allowance_factor" min="0" max="200" step="1"
                     value="${e ? rateToPct(e.allowance_factor) : 100}" />
            </label>
          </div>
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.refCategory'))}
              <input type="text" name="reference_wage_category" maxlength="20"
                     placeholder="A-1"
                     value="${escHtml(e ? e.reference_wage_category || '' : '')}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.pensionFund'))}
              <input type="text" name="pension_fund" maxlength="120"
                     value="${escHtml(e ? e.pension_fund || '' : '')}" />
            </label>
          </div>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.ownerHint'))}</p>
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.unionName'))}
              <input type="text" name="union_name" maxlength="120"
                     value="${escHtml(e ? e.union_name || '' : '')}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.unionRate'))} (%)
              <input type="number" name="union_rate" min="0" max="20" step="0.01"
                     value="${e ? rateToPct(e.union_rate) : 0}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.extraPension'))} (%)
              <input type="number" name="extra_pension_employee" min="0" max="50" step="0.01"
                     value="${e ? rateToPct(e.extra_pension_employee) : 0}" />
            </label>
            <label>${escHtml(t('adminBooks.payroll.extraPensionEmployer'))} (%)
              <input type="number" name="extra_pension_employer" min="0" max="50" step="0.01"
                     value="${e ? rateToPct(e.extra_pension_employer) : 0}" />
            </label>
          </div>
          <div class="books-form__row">
            <label>${escHtml(t('adminBooks.payroll.pensionOverride'))} (%)
              <input type="number" name="pension_employee_rate" min="0" max="50" step="0.01"
                     placeholder="${escHtml(t('adminBooks.payroll.useStatutory'))}"
                     value="${e && e.pension_employee_rate !== null
    ? rateToPct(e.pension_employee_rate) : ''}" />
            </label>
            <label class="books-check">
              <input type="checkbox" name="is_active"${!e || e.is_active ? ' checked' : ''} />
              ${escHtml(t('adminBooks.payroll.activeLabel'))}
            </label>
          </div>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.payroll.overrideHint'))}</p>
          <div class="books-form__row">
            <button type="submit" class="btn">${escHtml(t('form.save'))}</button>
            <button type="button" class="btn btn--ghost" data-close>${escHtml(t('form.cancel'))}</button>
          </div>
        </form>
      </div>`;

    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog || ev.target.closest('[data-close]')) dialog.remove();
    });
    dialog.querySelector('#emp-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const num = name => f.elements[name].value;
      const body = {
        full_name: f.elements.full_name.value.trim(),
        kennitala: f.elements.kennitala.value.trim(),
        employment_type: f.elements.employment_type.value,
        monthly_salary: Number(num('monthly_salary')) || 0,
        allowance_factor: pctToRate(num('allowance_factor')),
        reference_wage_category: f.elements.reference_wage_category.value.trim() || null,
        pension_fund: f.elements.pension_fund.value.trim(),
        union_name: f.elements.union_name.value.trim(),
        union_rate: pctToRate(num('union_rate')),
        extra_pension_employee: pctToRate(num('extra_pension_employee')),
        extra_pension_employer: pctToRate(num('extra_pension_employer')),
        // Blank means "use the year's statutory rate", which is a different statement
        // from 0 — so it goes as null, not as a zero.
        pension_employee_rate: num('pension_employee_rate') === ''
          ? null : pctToRate(num('pension_employee_rate')),
        is_active: f.elements.is_active.checked,
      };
      try {
        if (id) await updateEmployee(id, body);
        else await createEmployee(body);
        showToast(t('adminBooks.payroll.employeeSaved'), 'success');
        dialog.remove();
        await this._loadAll();
      } catch (err) { showToast(err.message, 'error'); }
    });

    document.body.appendChild(dialog);
  }

  destroy() {
    this._generation++;
    this._el = null;
  }
}
