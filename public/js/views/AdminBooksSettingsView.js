// AdminBooksSettingsView (/admin/books/settings) — the setup the readiness banner
// keeps asking for. Ported from orangesmiley (2026-09-07) on 2026-09-12 and
// narrowed to what THIS base's Setting.updateBookkeepingSettings accepts: no
// Peppol party block, no IBAN/BIC, and the chart confirmation is a date only
// (orangesmiley's migration 095 added the note and the "who"; the base has
// neither column, so this screen does not pretend to record them).
//
// Three things gate the rest of the books, in the order they block:
//
//   1. Útgefandi       name, kennitala, VSK-númer — what makes an invoice legally
//                      valid. Nothing can be issued until this is complete.
//   2. Bókhaldslykill  the chart of accounts, confirmed by a person. The chart is
//                      rendered above the button so confirming is a reading act,
//                      not a clicking act: a code changed after entries exist
//                      means running two charts, so the cheap moment is now.
//   3. Gengi           exchange rates, per document date. There is deliberately
//                      no default feed URL (a stale rate that nobody chose is the
//                      worst kind), so rates are entered here or via `books:fx`.
//                      Freshness is shown per currency IN USE — USD as loudly as EUR.
//
// Not a sidebar item: reached from the overview, so it needs no admin view id.
// Reads ride the `books` view; writes are admin-only on the server, and the
// forms are disabled for a reader.
import { isAuthenticated, canSeeView, isAdmin } from '../services/auth.js';
import {
  fetchBooksSettings, updateBooksSettings, setFxRate, fetchAccounts,
} from '../services/adminBookkeeping.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { errorBanner, isoToday, pctToRate, rateToPct } from './booksShared.js';

const FX_CURRENCIES = ['EUR', 'USD', 'GBP', 'DKK'];

// The text fields of the seller block, in form order. Every name here is a key
// Setting.updateBookkeepingSettings accepts — do not add one the server does not.
const SELLER_TEXT_FIELDS = [
  'seller_name', 'seller_kennitala', 'seller_vat_number', 'seller_address',
  'invoice_note', 'municipality', 'accountant_name', 'accountant_email',
];

export class AdminBooksSettingsView {
  constructor() {
    this._el = null;
    this._generation = 0;
    this._busy = false;
    this._settings = null;
    this._fxRates = [];
    this._fxCurrency = 'EUR';
    this._fxFreshness = [];
    this._accounts = null;        // null = not loadable with this user's grants
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
          <h1 class="admin-title">${escHtml(t('adminBooks.settings.title'))}</h1>
          <p class="admin-shop__hint">${escHtml(t('adminBooks.settings.subtitle'))}</p>
        </div>
        <div class="books-actions">
          <a class="btn btn--ghost" href="${escHtml(href('/admin/books'))}">${escHtml(t('adminBooks.settings.back'))}</a>
        </div>
      </div>
      ${isAdmin() ? '' : `<div class="books-banner books-banner--info">${escHtml(t('adminBooks.settings.readOnly'))}</div>`}
      <div id="bs-seller"><div class="admin-loading">${escHtml(t('form.loading'))}</div></div>
      <div id="bs-coa"></div>
      <div id="bs-fx"></div>
    `;

    // Forms are re-rendered by _paint(), so listeners live on the root and delegate.
    this._el.addEventListener('submit', (e) => {
      if (e.target.id === 'bs-seller-form') { e.preventDefault(); this._saveSeller(e.target); }
      if (e.target.id === 'bs-fx-form') { e.preventDefault(); this._saveFxRate(e.target); }
    });
    this._el.addEventListener('click', (e) => {
      if (e.target.closest('[data-confirm-coa]')) { this._confirmCoa(); return; }
      if (e.target.closest('[data-revoke-coa]')) this._revokeCoa();
    });
    this._el.addEventListener('change', (e) => {
      if (e.target.id === 'bs-fx-view-currency') this._load(e.target.value);
    });

    await Promise.all([this._load(this._fxCurrency), this._loadAccounts()]);
    // Activates the Bókhald entry: this screen has no nav item of its own.
    return renderAdminShell({ activePath: '/admin/books', content: this._el });
  }

  async _load(currency) {
    const gen = ++this._generation;
    try {
      const data = await fetchBooksSettings({ currency });
      if (gen !== this._generation) return;
      this._settings = data.settings;
      this._fxRates = data.fx_rates || [];
      this._fxCurrency = data.fx_currency || currency;
      this._fxFreshness = data.fx_freshness || [];
      this._paint();
    } catch (err) {
      if (gen !== this._generation) return;
      this._el.querySelector('#bs-seller').innerHTML = errorBanner(err.message);
    }
  }

  // The chart is served under the `expenses` view. A `books`-only reader cannot
  // load it; the card then says so instead of pretending the chart is empty.
  async _loadAccounts() {
    try {
      const { accounts } = await fetchAccounts();
      this._accounts = accounts;
    } catch {
      this._accounts = null;
    }
    if (this._settings) this._paint();
  }

  _paint() {
    this._el.querySelector('#bs-seller').innerHTML = this._sellerHtml();
    this._el.querySelector('#bs-coa').innerHTML = this._coaHtml();
    this._el.querySelector('#bs-fx').innerHTML = this._fxHtml();
  }

  // ── 1. Útgefandi ──────────────────────────────────────────────────────────

  _sellerHtml() {
    const s = this._settings;
    const ro = isAdmin() ? '' : 'disabled';
    const field = (name, label, { type = 'text', maxLen = 200, hint = '', value = s[name] } = {}) => `
      <label>${escHtml(label)}
        <input type="${escHtml(type)}" name="${escHtml(name)}" maxlength="${maxLen}" ${ro}
               value="${escHtml(value == null ? '' : String(value))}" />
        ${hint ? `<small>${escHtml(hint)}</small>` : ''}
      </label>`;
    const banner = s.seller_complete
      ? `<div class="books-banner books-banner--ok">${escHtml(t('adminBooks.settings.sellerOk'))}</div>`
      : `<div class="books-banner books-banner--error">${escHtml(t('adminBooks.settings.sellerMissing'))}</div>`;

    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.settings.sellerTitle'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.settings.sellerHint'))}</p>
        ${banner}
        <form id="bs-seller-form" class="books-form books-form--wide">
          <div class="books-form__grid">
            ${field('seller_name', t('adminBooks.settings.sellerName'))}
            ${field('seller_kennitala', t('adminBooks.settings.sellerKennitala'), { maxLen: 12 })}
            ${field('seller_vat_number', t('adminBooks.settings.sellerVatNumber'), { maxLen: 8 })}
            <label>${escHtml(t('adminBooks.settings.paymentTermsDays'))}
              <input type="number" name="payment_terms_days" min="0" max="365" step="1" ${ro}
                     value="${escHtml(String(s.payment_terms_days))}" />
            </label>
            <label class="books-form__wide">${escHtml(t('adminBooks.settings.sellerAddress'))}
              <textarea name="seller_address" rows="2" maxlength="400" ${ro}>${escHtml(s.seller_address || '')}</textarea>
            </label>
            <label class="books-form__wide">${escHtml(t('adminBooks.settings.invoiceNote'))}
              <input type="text" name="invoice_note" maxlength="400" ${ro} value="${escHtml(s.invoice_note || '')}" />
              <small>${escHtml(t('adminBooks.settings.invoiceNoteHint'))}</small>
            </label>
            ${field('municipality', t('adminBooks.settings.municipality'), { maxLen: 120, hint: t('adminBooks.settings.municipalityHint') })}
            <label>${escHtml(t('adminBooks.settings.corporateTaxRate'))}
              <input type="number" name="corporate_tax_rate" min="0" max="99.99" step="0.01" ${ro}
                     value="${escHtml(rateToPct(s.corporate_tax_rate))}" />
            </label>
            ${field('accountant_name', t('adminBooks.settings.accountantName'))}
            ${field('accountant_email', t('adminBooks.settings.accountantEmail'), { type: 'email' })}
          </div>
          ${isAdmin() ? `<div class="books-form__row"><button type="submit" class="btn btn--primary">${escHtml(t('adminBooks.settings.save'))}</button></div>` : ''}
        </form>
      </section>`;
  }

  async _saveSeller(form) {
    if (this._busy) return;
    const s = this._settings;
    const fd = new FormData(form);
    // Send only what changed: the endpoint is a PATCH, and an unchanged kennitala
    // re-sent is a needless trip through the check-digit validator.
    const patch = {};
    for (const name of SELLER_TEXT_FIELDS) {
      const v = String(fd.get(name) || '').trim();
      if (v !== String(s[name] || '')) patch[name] = v;
    }
    const terms = Number(fd.get('payment_terms_days'));
    if (terms !== s.payment_terms_days) patch.payment_terms_days = terms;
    const rate = pctToRate(fd.get('corporate_tax_rate'));
    if (Math.abs(rate - s.corporate_tax_rate) > 1e-9) patch.corporate_tax_rate = rate;

    if (!Object.keys(patch).length) { showToast(t('adminBooks.settings.nothingChanged'), 'info'); return; }

    this._busy = true;
    try {
      const { settings } = await updateBooksSettings(patch);
      this._settings = settings;
      showToast(t('adminBooks.settings.saved'), 'success');
      this._paint();
    } catch (err) {
      // The server's messages are already user-grade ("failed its check-digit
      // validation — check for a typo"); show them as they are.
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
    }
  }

  // ── 2. Bókhaldslykill ─────────────────────────────────────────────────────

  _coaHtml() {
    const s = this._settings;
    const confirmed = Boolean(s.coa_confirmed_at);
    const banner = confirmed
      ? `<div class="books-banner books-banner--ok">
           <strong>${escHtml(t('adminBooks.settings.coaConfirmedAt', { date: s.coa_confirmed_at }))}</strong>
           ${isAdmin() ? `<div><button type="button" class="btn btn--ghost" data-revoke-coa>${escHtml(t('adminBooks.settings.coaRevoke'))}</button></div>` : ''}
         </div>`
      : `<div class="books-banner books-banner--error">
           <strong>${escHtml(t('adminBooks.settings.coaUnconfirmed'))}</strong>
           ${isAdmin() ? `<div><button type="button" class="btn btn--primary" data-confirm-coa>${escHtml(t('adminBooks.settings.coaConfirm'))}</button></div>` : ''}
         </div>`;

    const table = this._accounts === null
      ? `<p class="admin-shop__hint">${escHtml(t('adminBooks.settings.coaTableUnavailable'))}</p>`
      : `<table class="admin-table books-table books-table--tight">
           <thead><tr>
             <th>${escHtml(t('adminBooks.settings.colCode'))}</th>
             <th>${escHtml(t('adminBooks.settings.colName'))}</th>
             <th>${escHtml(t('adminBooks.settings.colType'))}</th>
             <th>${escHtml(t('adminBooks.settings.colVatCode'))}</th>
             <th>${escHtml(t('adminBooks.settings.colBlocked'))}</th>
           </tr></thead>
           <tbody>${this._accounts.map(a => `
             <tr>
               <td>${escHtml(a.code)}</td>
               <td>${escHtml(a.name)}</td>
               <td>${escHtml(a.type)}</td>
               <td>${escHtml(a.vat_code || '')}</td>
               <td>${a.input_vat_blocked
    ? `<span class="books-pill books-pill--warn">${escHtml(t('adminBooks.settings.blocked'))}</span>`
    : `<span class="books-pill books-pill--muted">${escHtml(t('adminBooks.settings.allowed'))}</span>`}</td>
             </tr>`).join('')}
           </tbody>
         </table>`;

    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.settings.coaTitle'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.settings.coaHint'))}</p>
        ${banner}
        ${table}
      </section>`;
  }

  // The base records the confirmation DATE only (no note, no "who" — those are
  // orangesmiley's 095 columns), so the prompt is a plain confirm and the audit
  // trail is the securityLogger line the endpoint writes.
  async _confirmCoa() {
    if (!window.confirm(t('adminBooks.settings.coaConfirmPrompt'))) return;
    try {
      const { settings } = await updateBooksSettings({ coa_confirmed_at: isoToday() });
      this._settings = settings;
      showToast(t('adminBooks.settings.coaConfirmed'), 'success');
      this._paint();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async _revokeCoa() {
    if (!window.confirm(t('adminBooks.settings.coaRevokeConfirm'))) return;
    try {
      const { settings } = await updateBooksSettings({ coa_confirmed_at: null });
      this._settings = settings;
      showToast(t('adminBooks.settings.coaRevoked'), 'success');
      this._paint();
    } catch (err) { showToast(err.message, 'error'); }
  }

  // ── 3. Gengi ──────────────────────────────────────────────────────────────

  _fxHtml() {
    const cur = this._fxCurrency;
    const ro = isAdmin() ? '' : 'disabled';

    // One chip per currency the books use: fresh, stale, or in use with no rate at
    // all. The last one is the case an EUR-only check could not see.
    const chips = this._fxFreshness.length
      ? `<div class="books-form__row">${this._fxFreshness.map(f => {
        const tone = f.ok ? 'ok' : 'warn';
        const label = !f.has_rate
          ? t('adminBooks.settings.fxMissingChip', { currency: f.currency })
          : (f.ok
            ? t('adminBooks.settings.fxFresh', { currency: f.currency, date: f.latest_rate_date, days: f.stale_days })
            : t('adminBooks.settings.fxStaleChip', { currency: f.currency, date: f.latest_rate_date, days: f.stale_days }));
        return `<span class="books-pill books-pill--${tone}">${escHtml(label)}</span>`;
      }).join(' ')}</div>`
      : '';

    const form = isAdmin() ? `
      <form id="bs-fx-form" class="books-form">
        <div class="books-form__row">
          <label>${escHtml(t('adminBooks.settings.fxCurrency'))}
            <select name="currency" ${ro}>
              ${FX_CURRENCIES.map(c => `<option value="${escHtml(c)}" ${c === cur ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
            </select>
          </label>
          <label>${escHtml(t('adminBooks.settings.fxDate'))}
            <input type="date" name="rate_date" value="${escHtml(isoToday())}" required ${ro} />
          </label>
          <label>${escHtml(t('adminBooks.settings.fxRate'))}
            <input type="number" name="rate" min="0.0001" step="0.0001" inputmode="decimal" required ${ro} />
          </label>
          <button type="submit" class="btn btn--primary">${escHtml(t('adminBooks.settings.fxSave'))}</button>
        </div>
      </form>` : '';

    const rows = this._fxRates.length
      ? `<table class="admin-table books-table books-table--tight">
           <thead><tr>
             <th>${escHtml(t('adminBooks.col.date'))}</th>
             <th class="num">${escHtml(t('adminBooks.settings.colRate'))}</th>
             <th>${escHtml(t('adminBooks.settings.colSource'))}</th>
           </tr></thead>
           <tbody>${this._fxRates.map(r => `
             <tr>
               <td>${escHtml(r.rate_date)}</td>
               <td class="num">${escHtml(String(r.rate))}</td>
               <td>${escHtml(r.source || '')}</td>
             </tr>`).join('')}
           </tbody>
         </table>`
      : `<p class="admin-shop__hint">${escHtml(t('adminBooks.settings.fxNone', { currency: cur }))}</p>`;

    return `
      <section class="books-section">
        <h2 class="books-section__title">${escHtml(t('adminBooks.settings.fxTitle'))}</h2>
        <p class="admin-shop__hint">${escHtml(t('adminBooks.settings.fxHint'))}</p>
        ${chips}
        ${form}
        <div class="books-filters">
          <label class="books-range">
            <span>${escHtml(t('adminBooks.settings.fxHistory'))}</span>
            <select id="bs-fx-view-currency">
              ${FX_CURRENCIES.map(c => `<option value="${escHtml(c)}" ${c === cur ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
            </select>
          </label>
        </div>
        ${rows}
      </section>`;
  }

  async _saveFxRate(form) {
    if (this._busy) return;
    const fd = new FormData(form);
    const currency = String(fd.get('currency') || 'EUR');
    this._busy = true;
    try {
      const { fx_rate: saved } = await setFxRate({
        currency,
        rate_date: fd.get('rate_date'),
        rate: Number(fd.get('rate')),
      });
      showToast(t('adminBooks.settings.fxSaved', { currency: saved.currency, rate: saved.rate, date: saved.rate_date }), 'success');
      await this._load(currency);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
    }
  }

  destroy() {
    this._generation += 1;
  }
}
