// AdminCheckoutSettingsView (/admin/checkout) — Greiðsla: the ordering pause
// and its message, the minimum order value, the delivery price, the checkout
// field rules and the owner's paid-order alert list. Ported from
// icelandicstore #151 (harvest2-lane7a-2026-09-26), cut to the engine's B2C
// checkout: no invoice path, no sign-in rule, no address-line-2 rule; plus a
// note rule and a list of alert addresses.
//
// Every control is REAL and ENFORCED on the server (services/checkoutRules.js,
// config/shipping.js) — this page only edits app_settings. The storefront's
// banners are the UX in front; the order API is the gate.
//
// Save model (as AdminGeneralSettingsView): a sticky save bar over a FLAT
// draft (dotted paths for nested keys, "shipping.flat_rate_isk"); editing
// never re-renders (inputs keep focus); Save PATCHes only the changed keys,
// unflattened, so an untouched shipping price keeps following the env
// fallback. A full re-render after save/discard.
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { getCheckoutSettings, updateCheckoutSettings } from '../services/adminCheckoutSettings.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const SETTING_KEYS = [
  'ordering_paused',
  'ordering_paused_message.is',
  'ordering_paused_message.en',
  'min_order_value_isk',
  'shipping.flat_rate_isk',
  'shipping.free_over_isk',
  'fields.phone',
  'fields.company',
  'fields.kennitala',
  'fields.note',
  'order_notify_emails',
];
const AMOUNT_KEYS = new Set(['min_order_value_isk', 'shipping.flat_rate_isk', 'shipping.free_over_isk']);

// API settings → flat draft. Amounts become strings (what an input holds) and
// the alert list one comma-separated string, so dirty-checking is ===.
function flatten(settings) {
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), settings);
  const out = {};
  for (const k of SETTING_KEYS) {
    const v = get(k);
    if (AMOUNT_KEYS.has(k)) out[k] = String(v ?? 0);
    else if (k === 'order_notify_emails') out[k] = Array.isArray(v) ? v.join(', ') : '';
    else out[k] = v;
  }
  return out;
}

// Changed flat keys → nested PATCH body. Amount strings go as typed: the
// server takes a digits-only string and refuses anything else with a 400.
function unflatten(flat) {
  const out = {};
  for (const [p, value] of Object.entries(flat)) {
    const parts = p.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) node = (node[parts[i]] ||= {});
    node[parts[parts.length - 1]] = AMOUNT_KEYS.has(p) ? String(value).trim() : value;
  }
  return out;
}

export class AdminCheckoutSettingsView {
  constructor() {
    this._baseline = null;
    this._draft = null;
    this._status = null;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('checkout')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'main admin-page co-page';
    el.innerHTML = `
      <div class="co-head">
        <h1 class="admin-title">${t('adminCheckout.title')}</h1>
        <p class="co-sub">${t('adminCheckout.subtitle')}</p>
      </div>
      <div id="co-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    await this._load();
    return renderAdminShell({ activePath: '/admin/checkout', content: el });
  }

  async _load() {
    const body = this._el.querySelector('#co-body');
    try {
      const data = await getCheckoutSettings();
      this._baseline = flatten(data.settings);
      this._draft = { ...this._baseline };
      this._status = data.status || {};
      this._renderBody();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${t('adminCheckout.loadError')}: ${escHtml(err.message)}</p>`;
    }
  }

  _renderBody() {
    const d = this._draft;
    const st = this._status || {};
    const rules = [
      { value: 'optional', label: t('adminCheckout.optOptional') },
      { value: 'required', label: t('adminCheckout.optRequired') },
      { value: 'hidden',   label: t('adminCheckout.optHidden') },
    ];

    this._el.querySelector('#co-body').innerHTML = `
      <div class="co-banner" role="note">
        <p class="co-banner__text">${t('adminCheckout.banner')}</p>
      </div>

      ${this._card(t('adminCheckout.orderingTitle'), `
        ${this._row({
          title: t('adminCheckout.orderingPaused'),
          help: t('adminCheckout.orderingPausedHelp'),
          control: this._toggle('ordering_paused', d.ordering_paused === true, t('adminCheckout.orderingPaused')),
        })}
        ${this._row({ stacked: true, title: t('adminCheckout.pausedMsgIs'), help: t('adminCheckout.pausedMsgHelp'),
          control: this._textarea('ordering_paused_message.is', 300, t('adminCheckout.pausedMsgIs')) })}
        ${this._row({ stacked: true, title: t('adminCheckout.pausedMsgEn'), help: '',
          control: this._textarea('ordering_paused_message.en', 300, t('adminCheckout.pausedMsgEn')) })}
        ${this._row({
          title: t('adminCheckout.cardPayments'),
          help: t('adminCheckout.cardPaymentsHelp'),
          control: st.stripe_configured
            ? `<span class="co-chip co-chip--on">${t('adminCheckout.chipLive')}</span>`
            : `<span class="co-chip">${t('adminCheckout.chipOff')}</span>`,
        })}
      `)}

      ${this._card(t('adminCheckout.orderRulesTitle'), `
        ${this._row({ title: t('adminCheckout.minOrder'), help: t('adminCheckout.minOrderHelp'),
          control: this._amount('min_order_value_isk', t('adminCheckout.minOrder')) })}
      `)}

      ${this._card(t('adminCheckout.deliveryTitle'), `
        ${this._row({ title: t('adminCheckout.flatRate'), help: t('adminCheckout.flatRateHelp'),
          control: this._amount('shipping.flat_rate_isk', t('adminCheckout.flatRate')) })}
        ${this._row({ title: t('adminCheckout.freeOver'), help: t('adminCheckout.freeOverHelp'),
          control: this._amount('shipping.free_over_isk', t('adminCheckout.freeOver')) })}
        ${this._row({ title: t('adminCheckout.localPickup'), help: t('adminCheckout.localPickupHelp'),
          control: `<span class="co-chip">${t('adminCheckout.freeLabel')}</span>` })}
      `)}

      ${this._card(t('adminCheckout.fieldsTitle'), `
        ${this._row({ title: t('adminCheckout.fieldPhone'), help: t('adminCheckout.fieldPhoneHelp'),
          control: this._select('fields.phone', rules, t('adminCheckout.fieldPhone')) })}
        ${this._row({ title: t('adminCheckout.fieldCompany'), help: t('adminCheckout.fieldCompanyHelp'),
          control: this._select('fields.company', rules, t('adminCheckout.fieldCompany')) })}
        ${this._row({ title: t('adminCheckout.fieldKennitala'), help: t('adminCheckout.fieldKennitalaHelp'),
          control: this._select('fields.kennitala', rules, t('adminCheckout.fieldKennitala')) })}
        ${this._row({ title: t('adminCheckout.fieldNote'), help: t('adminCheckout.fieldNoteHelp'),
          control: this._select('fields.note', rules, t('adminCheckout.fieldNote')) })}
      `)}

      ${this._card(t('adminCheckout.notifyTitle'), `
        ${this._row({ stacked: true, title: t('adminCheckout.notifyEmails'),
          help: st.env_notify_fallback ? t('adminCheckout.notifyEmailsHelpEnv') : t('adminCheckout.notifyEmailsHelp'),
          control: `<input type="text" class="co-input co-input--wide" data-input="order_notify_emails"
                      value="${escHtml(d.order_notify_emails || '')}" maxlength="1300" inputmode="email"
                      autocomplete="off" placeholder="${escHtml(t('adminCheckout.notifyEmailsPlaceholder'))}"
                      aria-label="${escHtml(t('adminCheckout.notifyEmails'))}">` })}
      `)}

      <div class="co-savebar" id="co-savebar" hidden>
        <span class="co-savebar__msg">${t('adminCheckout.unsavedChanges')}</span>
        <div class="co-savebar__actions">
          <button type="button" class="btn btn--sm btn--ghost" data-discard>${t('adminCheckout.discard')}</button>
          <button type="button" class="btn btn--sm btn--primary" data-save>${t('adminCheckout.save')}</button>
        </div>
      </div>
    `;
    this._bind();
    this._recomputeDirty();
  }

  _card(title, inner) {
    return `
      <section class="co-card">
        <div class="co-card__head"><h2 class="co-card__title">${escHtml(title)}</h2></div>
        <div class="co-card__body">${inner}</div>
      </section>`;
  }

  _row({ title, help, control, stacked = false }) {
    return `
      <div class="co-row${stacked ? ' co-row--stacked' : ''}">
        <div class="co-row__main">
          <p class="co-row__title">${escHtml(title)}</p>
          ${help ? `<p class="co-row__help">${escHtml(help)}</p>` : ''}
        </div>
        <div class="co-row__side">${control}</div>
      </div>`;
  }

  _toggle(key, on, label) {
    return `<button type="button" class="co-switch${on ? ' is-on' : ''}" data-toggle="${escHtml(key)}"
              role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escHtml(label)}"></button>`;
  }

  _textarea(key, max, label) {
    return `<textarea class="co-textarea" data-input="${escHtml(key)}" rows="2" maxlength="${max}"
              aria-label="${escHtml(label)}">${escHtml(this._draft[key] || '')}</textarea>`;
  }

  _amount(key, label) {
    return `<span class="co-amount">
        <input type="text" inputmode="numeric" pattern="[0-9]*" class="co-input co-input--num"
               data-input="${escHtml(key)}" value="${escHtml(this._draft[key])}" aria-label="${escHtml(label)}">
        <span class="co-amount__unit">kr.</span>
      </span>`;
  }

  _select(key, options, label) {
    const cur = this._draft[key];
    return `<select class="co-select" data-input="${escHtml(key)}" aria-label="${escHtml(label)}">
        ${options.map(o => `<option value="${escHtml(o.value)}"${o.value === cur ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
      </select>`;
  }

  _bind() {
    const body = this._el.querySelector('#co-body');
    body.querySelectorAll('[data-input]').forEach((inp) => {
      const evt = inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(evt, () => {
        this._draft[inp.dataset.input] = inp.value;
        this._recomputeDirty();
      });
    });
    body.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        const on = this._draft[key] !== true;
        this._draft[key] = on;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        this._recomputeDirty();
      });
    });
    body.querySelector('[data-save]')?.addEventListener('click', () => this._save());
    body.querySelector('[data-discard]')?.addEventListener('click', () => this._discard());
  }

  _dirtyKeys() {
    return SETTING_KEYS.filter(k => this._draft[k] !== this._baseline[k]);
  }

  _recomputeDirty() {
    const bar = this._el.querySelector('#co-savebar');
    if (bar) bar.hidden = this._dirtyKeys().length === 0;
  }

  async _save() {
    const keys = this._dirtyKeys();
    if (!keys.length) return;
    const flat = {};
    for (const k of keys) flat[k] = this._draft[k];
    const btn = this._el.querySelector('[data-save]');
    if (btn) btn.disabled = true;
    try {
      const { settings, status } = await updateCheckoutSettings(unflatten(flat));
      this._baseline = flatten(settings);
      this._draft = { ...this._baseline };
      this._status = status || this._status;
      this._renderBody();
      showToast(t('adminCheckout.saved'), 'success');
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`${t('adminCheckout.saveError')}: ${err.message}`, 'error', 6000);
    }
  }

  _discard() {
    this._draft = { ...this._baseline };
    this._renderBody();
  }
}
