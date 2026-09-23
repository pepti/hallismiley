// SellerAreaView (/solusvaedi) — the seller area on the PUBLIC instance (D-020).
//
// Read-only by construction: everything here is a published copy of ops data
// (/api/v1/seller, GET only). Three sections, each shown only when ops granted
// the matching view: Fyrirspurnir (every lead), Viðskiptavinir (the seller's
// own accounts) and Sölulaun (their issued commission statements). The
// statement body reuses the admin drawer markup (components/
// CommissionStatement.js) with the payout form switched off, so a seller and
// Halli read the same figures laid out the same way.
//
// Not in the admin shell: a seller on the public box holds no admin view.
// Tokens only (invariant 15) — every colour comes from the acct-*/leads-* chips
// and the seller-area.css tokens.
import { isAuthenticated } from '../services/auth.js';
import {
  fetchSellerMe, fetchSellerLeads, fetchSellerAccounts, fetchSellerStatements, fetchSellerStatement,
} from '../services/seller.js';
import { escHtml } from '../utils/escHtml.js';
import { formatDate, formatDateTime } from '../utils/format.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { isk, statusChip as accountChip, TIER_KEY } from './AdminAccountsView.js';
import { drawerHtml, statusChip as statementChip } from '../components/CommissionStatement.js';
import { renderMfaReminder } from '../components/mfaReminder.js';

const SECTIONS = [
  { id: 'leads', flag: 'can_leads', label: 'seller.tab.leads' },
  { id: 'accounts', flag: 'can_accounts', label: 'seller.tab.accounts' },
  { id: 'commission', flag: 'can_commission', label: 'seller.tab.commission' },
];

const leadChip = (status) =>
  `<span class="leads-chip leads-chip--${escHtml(status)}">${escHtml(t(`leads.status.${status}`))}</span>`;

export class SellerAreaView {
  constructor() {
    this._el = null;
    this._me = null;
    this._active = null;
    this._generation = 0;
  }

  async render() {
    if (!isAuthenticated()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main seller-area';
    this._el.innerHTML = `<div class="seller-area__inner"><p class="seller-area__muted">${escHtml(t('form.loading'))}</p></div>`;
    this._load();
    return this._el;
  }

  destroy() {
    this._generation += 1;
  }

  _inner() { return this._el.querySelector('.seller-area__inner'); }

  async _load() {
    const generation = ++this._generation;
    try {
      const me = await fetchSellerMe();
      if (generation !== this._generation) return;
      this._me = me;
      this._renderFrame();
    } catch (err) {
      if (generation !== this._generation) return;
      // 404 = not a seller (or not the public instance): say so plainly rather
      // than show an error — nothing here is broken.
      this._inner().innerHTML = err.status === 404
        ? `<h1 class="seller-area__title">${escHtml(t('seller.title'))}</h1>
           <p class="seller-area__muted">${escHtml(t('seller.notSeller'))}</p>`
        : `<p class="seller-area__error" role="alert">${escHtml(err.message)}</p>`;
    }
  }

  _renderFrame() {
    const { seller, mfa_ready: mfaReady, published_at: publishedAt } = this._me;
    const sections = SECTIONS.filter(s => seller[s.flag]);
    const stamp = publishedAt
      ? t('seller.publishedAt', { date: formatDateTime(publishedAt) })
      : t('seller.neverPublished');

    // `mfa_ready` = the rest of the area answers this session: enrolled, or
    // the instance does not REQUIRE enrolment (sellerRoutes.js rule 4 follows
    // security.mfa.enrolment since mfa-reminder-2026-09-23). Under `optional`
    // an unenrolled seller reads with a password and gets the dismissible
    // reminder above the header instead of this block.
    let body;
    if (!mfaReady) {
      body = `<div class="seller-area__notice" role="status">
          <p>${escHtml(t('seller.mfaNeeded'))}</p>
          <a class="btn btn--primary btn--sm" href="${escHtml(href('/profile'))}?focus=2fa" data-testid="seller-mfa-link">${escHtml(t('seller.mfaCta'))}</a>
        </div>`;
    } else if (!sections.length) {
      body = `<p class="seller-area__muted">${escHtml(t('seller.noSections'))}</p>`;
    } else {
      if (!sections.some(s => s.id === this._active)) this._active = sections[0].id;
      body = `
        <div class="seller-area__tabs" role="tablist" aria-label="${escHtml(t('seller.title'))}">
          ${sections.map(s => `<button type="button" role="tab" class="seller-area__tab"
               id="seller-tab-${s.id}" data-tab="${s.id}" aria-controls="seller-panel"
               aria-selected="${s.id === this._active}" tabindex="${s.id === this._active ? 0 : -1}">${escHtml(t(s.label))}</button>`).join('')}
        </div>
        <section id="seller-panel" class="seller-area__panel" role="tabpanel"
                 aria-labelledby="seller-tab-${this._active}" tabindex="0"></section>`;
    }

    this._inner().innerHTML = `
      <header class="seller-area__head">
        <p class="seller-area__eyebrow">${escHtml(seller.display_name)}</p>
        <h1 class="seller-area__title">${escHtml(t('seller.title'))}</h1>
        <p class="seller-area__muted">${escHtml(t('seller.subtitle'))} ${escHtml(stamp)}</p>
      </header>
      ${body}`;

    const reminder = renderMfaReminder();
    if (reminder) this._inner().prepend(reminder);

    const tabs = [...this._el.querySelectorAll('.seller-area__tab')];
    tabs.forEach((btn, i) => {
      btn.addEventListener('click', () => this._select(btn.dataset.tab));
      btn.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        this._select(next.dataset.tab);
        next.focus();
      });
    });
    if (tabs.length) this._loadPanel();
  }

  _select(id) {
    if (id === this._active) return;
    this._active = id;
    this._el.querySelectorAll('.seller-area__tab').forEach(b => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this._el.querySelector('#seller-panel').setAttribute('aria-labelledby', `seller-tab-${id}`);
    this._loadPanel();
  }

  async _loadPanel() {
    const generation = ++this._generation;
    const panel = this._el.querySelector('#seller-panel');
    panel.innerHTML = `<p class="seller-area__muted">${escHtml(t('form.loading'))}</p>`;
    try {
      let html;
      if (this._active === 'leads') html = this._leadsHtml((await fetchSellerLeads()).leads);
      else if (this._active === 'accounts') html = this._accountsHtml((await fetchSellerAccounts()).accounts);
      else html = this._statementsHtml((await fetchSellerStatements()).statements);
      if (generation !== this._generation) return;
      panel.innerHTML = html;
      if (this._active === 'commission') this._bindStatements(panel);
    } catch (err) {
      if (generation !== this._generation) return;
      panel.innerHTML = `<p class="seller-area__error" role="alert">${escHtml(err.message)}</p>`;
    }
  }

  _leadsHtml(leads) {
    if (!leads.length) return `<p class="seller-area__muted">${escHtml(t('leads.empty'))}</p>`;
    const row = (label, value) => (value
      ? `<div><dt>${escHtml(label)}</dt><dd>${escHtml(value)}</dd></div>` : '');
    return `<ul class="seller-list">${leads.map(l => `
      <li><details class="seller-item">
        <summary>
          <span class="seller-item__date">${escHtml(formatDate(l.received_at))}</span>
          <span class="seller-item__name">${escHtml(l.name)}${l.company ? ` · ${escHtml(l.company)}` : ''}</span>
          ${leadChip(l.status)}
        </summary>
        <dl class="seller-item__facts">
          ${row(t('seller.field.email'), l.email)}
          ${row(t('seller.field.phone'), l.phone)}
          ${row(t('leads.col.platform'), l.current_platform)}
          ${row(t('leads.col.owner'), l.owner_name || t('leads.ownerNone'))}
          ${l.contacted_at ? row(t('seller.field.contacted'), formatDate(l.contacted_at)) : ''}
        </dl>
        <p class="seller-item__label">${escHtml(t('leads.message'))}</p>
        <p class="seller-item__text">${escHtml(l.message)}</p>
        ${l.note ? `<p class="seller-item__label">${escHtml(t('leads.note'))}</p>
        <p class="seller-item__text">${escHtml(l.note)}</p>` : ''}
      </details></li>`).join('')}</ul>`;
  }

  _accountsHtml(accounts) {
    if (!accounts.length) return `<p class="seller-area__muted">${escHtml(t('seller.accounts.empty'))}</p>`;
    return `<div class="seller-area__scroll"><table class="admin-table acct-table">
      <thead><tr>
        <th scope="col">${escHtml(t('accounts.col.name'))}</th>
        <th scope="col">${escHtml(t('accounts.col.tier'))}</th>
        <th scope="col">${escHtml(t('accounts.col.status'))}</th>
        <th scope="col" class="num">${escHtml(t('accounts.col.monthlyFee'))}</th>
        <th scope="col">${escHtml(t('accounts.field.contractStart'))}</th>
        <th scope="col">${escHtml(t('accounts.field.contactName'))}</th>
      </tr></thead>
      <tbody>${accounts.map(a => `<tr>
        <td>${escHtml(a.name)}</td>
        <td>${escHtml(TIER_KEY[a.tier] ? t(TIER_KEY[a.tier]) : a.tier)}</td>
        <td>${accountChip(a.status)}</td>
        <td class="num">${escHtml(isk(a.monthly_fee_isk))}</td>
        <td>${a.contract_start ? escHtml(formatDate(a.contract_start)) : '—'}</td>
        <td>${escHtml(a.contact_name || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  _statementsHtml(statements) {
    if (!statements.length) return `<p class="seller-area__muted">${escHtml(t('commission.statement.none'))}</p>`;
    return `<ul class="seller-list">${statements.map(s => `
      <li><details class="seller-item" data-statement="${escHtml(String(s.ops_id))}">
        <summary>
          <span class="seller-item__date">${escHtml(String(s.period).slice(0, 7))}</span>
          <span class="seller-item__name">${escHtml(t('commission.statement.payable'))}: ${escHtml(isk(s.payable_isk))}</span>
          ${statementChip(s.status)}
        </summary>
        <div class="seller-item__body"><p class="seller-area__muted">${escHtml(t('form.loading'))}</p></div>
      </details></li>`).join('')}</ul>`;
  }

  _bindStatements(panel) {
    const name = this._me.seller.display_name;
    panel.querySelectorAll('details[data-statement]').forEach(d => {
      d.addEventListener('toggle', async () => {
        if (!d.open || d.dataset.loaded) return;
        d.dataset.loaded = '1';
        const body = d.querySelector('.seller-item__body');
        try {
          const { statement, lines, payouts } = await fetchSellerStatement(d.dataset.statement);
          // The drawer heading carries a fixed id (one drawer at a time in the
          // admin); several statements can be open here, so drop it.
          body.innerHTML = drawerHtml({
            statement: { ...statement, seller_name: name },
            lines, payouts, status: statement.status, canPay: false,
          }).replace(' id="commission-drawer-title"', '');
        } catch (err) {
          delete d.dataset.loaded;
          body.innerHTML = `<p class="seller-area__error" role="alert">${escHtml(err.message)}</p>`;
        }
      });
    });
  }
}
