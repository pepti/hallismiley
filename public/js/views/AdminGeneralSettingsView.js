// AdminGeneralSettingsView (/admin/general) — store identity (name, contact
// email, phone), store address, store defaults (currency read-only, time zone,
// unit system, weight unit), and the order-ID display format. All persist to
// app_settings via the Setting model.
//
// Ported from icelandicstore and adapted to this site's standalone admin pages
// (it returns its own root element rather than wrapping in an admin shell).
//
// NOTE (wiring): these settings persist and round-trip, but consuming them in
// live behaviour (footer, email sender, order-number display) is a deliberate
// follow-up — site name/footer copy is currently owned by the contentController
// (site_content), so wiring is left for a decision rather than silently
// duplicating that. See the feature-port hand-off notes.
//
// Save model: a sticky save bar with dirty-tracking. Editing a field updates a
// working draft; when the draft differs from the saved baseline the bar appears
// and Save sends one PATCH with only the changed keys. Inputs/selects update the
// draft WITHOUT a full re-render (that would drop focus); the order-ID preview
// updates in place. A full re-render happens only after save/discard.
import { isAuthenticated, isAdmin } from '../services/auth.js';
import { getGeneralSettings, updateGeneralSettings } from '../services/adminGeneralSettings.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const SETTING_KEYS = [
  'store_name', 'contact_email', 'phone',
  'address1', 'address2', 'city', 'zip', 'country',
  'unit_system', 'weight_unit', 'timezone',
  'order_prefix', 'order_suffix',
];

export class AdminGeneralSettingsView {
  constructor() {
    this._baseline = null; // last-saved settings (server truth)
    this._draft    = null; // working copy edited in the UI
    this._options  = null; // picker options (timezones, enums, currency)
  }

  async render() {
    if (!isAuthenticated() || !isAdmin()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main admin-page gs-page';
    el.innerHTML = `
      <div class="gs-head">
        <h1 class="admin-title">${t('adminGeneral.title')}</h1>
        <p class="gs-sub">${t('adminGeneral.subtitle')}</p>
      </div>
      <div id="gs-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    await this._load();
    return renderAdminShell({ activePath: '/admin/general', content: el });
  }

  async _load() {
    const body = this._el.querySelector('#gs-body');
    try {
      const data = await getGeneralSettings();
      this._baseline = { ...data.settings };
      this._draft    = { ...data.settings };
      this._options  = data.options || {};
      this._renderBody();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${t('adminGeneral.loadError')}: ${escHtml(err.message)}</p>`;
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _renderBody() {
    const o = this._options || {};
    const tzOptions = (o.timezones || []).map(z => ({ value: z.id, label: z.label }));
    const unitOptions = [
      { value: 'metric',   label: t('adminGeneral.unitMetric') },
      { value: 'imperial', label: t('adminGeneral.unitImperial') },
    ];
    const weightOptions = [
      { value: 'kg', label: t('adminGeneral.weightKg') },
      { value: 'g',  label: t('adminGeneral.weightG') },
      { value: 'lb', label: t('adminGeneral.weightLb') },
      { value: 'oz', label: t('adminGeneral.weightOz') },
    ];

    this._el.querySelector('#gs-body').innerHTML = `
      ${this._card(t('adminGeneral.storeDetails'), '', `
        ${this._row({ title: t('adminGeneral.storeName'),    help: t('adminGeneral.storeNameHelp'),    control: this._input({ key: 'store_name',    maxlength: 100, placeholder: t('adminGeneral.storeNamePlaceholder') }) })}
        ${this._row({ title: t('adminGeneral.contactEmail'), help: t('adminGeneral.contactEmailHelp'), control: this._input({ key: 'contact_email', type: 'email', maxlength: 254, placeholder: 'shop@example.com' }) })}
        ${this._row({ title: t('adminGeneral.phone'),        help: t('adminGeneral.phoneHelp'),        control: this._input({ key: 'phone',         maxlength: 32, placeholder: '+354 000 0000' }) })}
      `)}

      ${this._card(t('adminGeneral.storeAddress'), '', `
        ${this._row({ title: t('adminGeneral.address1'), help: '', control: this._input({ key: 'address1', maxlength: 120 }) })}
        ${this._row({ title: t('adminGeneral.address2'), help: '', control: this._input({ key: 'address2', maxlength: 120 }) })}
        ${this._row({ title: t('adminGeneral.city'),     help: '', control: this._input({ key: 'city',     maxlength: 120 }) })}
        ${this._row({ title: t('adminGeneral.zip'),      help: '', control: this._input({ key: 'zip',      maxlength: 16 }) })}
        ${this._row({ title: t('adminGeneral.country'),  help: '', control: this._input({ key: 'country',  maxlength: 120 }) })}
      `)}

      ${this._card(t('adminGeneral.storeDefaults'), '', `
        ${this._row({
          title: t('adminGeneral.currency'),
          help:  t('adminGeneral.currencyHelp'),
          control: `<span class="gs-readonly">${escHtml(t('adminGeneral.currencyIsk'))}</span>`,
        })}
        ${this._row({ title: t('adminGeneral.timezone'),   help: t('adminGeneral.timezoneHelp'),   control: this._select({ key: 'timezone',    value: this._draft.timezone,    options: tzOptions }) })}
        ${this._row({ title: t('adminGeneral.unitSystem'), help: '', control: this._select({ key: 'unit_system', value: this._draft.unit_system, options: unitOptions }) })}
        ${this._row({ title: t('adminGeneral.weightUnit'), help: '', control: this._select({ key: 'weight_unit', value: this._draft.weight_unit, options: weightOptions }) })}
      `)}

      ${this._card(t('adminGeneral.orderId'), '', `
        ${this._row({ title: t('adminGeneral.orderPrefix'), help: t('adminGeneral.orderIdHelp'), control: this._input({ key: 'order_prefix', maxlength: 10, placeholder: '#' }) })}
        ${this._row({ title: t('adminGeneral.orderSuffix'), help: '', control: this._input({ key: 'order_suffix', maxlength: 10 }) })}
        <p class="gs-preview" id="gs-order-preview">${escHtml(this._orderPreview())}</p>
      `)}

      <div class="gs-savebar" id="gs-savebar" hidden>
        <span class="gs-savebar__msg">${t('adminGeneral.unsavedChanges')}</span>
        <div class="gs-savebar__actions">
          <button type="button" class="btn btn--sm btn--ghost" data-discard>${t('adminGeneral.discard')}</button>
          <button type="button" class="btn btn--sm btn--primary" data-save>${t('adminGeneral.save')}</button>
        </div>
      </div>
    `;

    this._bind();
    this._recomputeDirty();
  }

  // A section card.
  _card(title, badge, inner) {
    return `
      <section class="gs-card">
        <div class="gs-card__head">
          <h2 class="gs-card__title">${escHtml(title)}</h2>
          ${badge ? `<span class="gs-badge">${escHtml(badge)}</span>` : ''}
        </div>
        <div class="gs-card__body">${inner}</div>
      </section>`;
  }

  _row({ title, help, control }) {
    return `
      <div class="gs-row">
        <div class="gs-row__main">
          <p class="gs-row__title">${escHtml(title)}</p>
          ${help ? `<p class="gs-row__help">${escHtml(help)}</p>` : ''}
        </div>
        <div class="gs-row__side">${control}</div>
      </div>`;
  }

  // Text/email input bound to a draft key (updates draft on input, no re-render).
  _input({ key, type = 'text', placeholder = '', maxlength = 120 }) {
    const val = this._draft[key] ?? '';
    return `<input type="${type}" class="gs-input" data-input="${escHtml(key)}"
              value="${escHtml(val)}" placeholder="${escHtml(placeholder)}"
              maxlength="${maxlength}" autocomplete="off" spellcheck="false"/>`;
  }

  // Enum dropdown bound to a draft key (updates draft on change, no re-render).
  _select({ key, value, options }) {
    const opts = options.map(opt =>
      `<option value="${escHtml(opt.value)}"${opt.value === value ? ' selected' : ''}>${escHtml(opt.label)}</option>`
    ).join('');
    return `<select class="gs-select" data-select="${escHtml(key)}">${opts}</select>`;
  }

  // Example line for the order-ID format ("#1001, #1002, …").
  _orderPreview() {
    const p = this._draft.order_prefix ?? '';
    const s = this._draft.order_suffix ?? '';
    const example = [1001, 1002, 1003].map(n => `${p}${n}${s}`).join(', ');
    return t('adminGeneral.orderIdPreview', { example });
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  _bind() {
    const body = this._el.querySelector('#gs-body');

    // Text inputs update the draft only (no full re-render → input keeps focus).
    body.querySelectorAll('[data-input]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.input;
        this._draft[key] = input.value;
        if (key === 'order_prefix' || key === 'order_suffix') {
          const preview = this._el.querySelector('#gs-order-preview');
          if (preview) preview.textContent = this._orderPreview();
        }
        this._recomputeDirty();
      });
    });

    // Dropdowns update the draft only.
    body.querySelectorAll('[data-select]').forEach(sel => {
      sel.addEventListener('change', () => {
        this._draft[sel.dataset.select] = sel.value;
        this._recomputeDirty();
      });
    });

    body.querySelector('[data-save]')?.addEventListener('click', () => this._save());
    body.querySelector('[data-discard]')?.addEventListener('click', () => this._discard());
  }

  // Compare trimmed (the server trims string fields before persisting).
  _normalize(val) {
    return String(val ?? '').trim();
  }

  _dirtyKeys() {
    return SETTING_KEYS.filter(k => this._normalize(this._draft[k]) !== this._normalize(this._baseline[k]));
  }

  _recomputeDirty() {
    const bar = this._el.querySelector('#gs-savebar');
    if (!bar) return;
    bar.hidden = this._dirtyKeys().length === 0;
  }

  async _save() {
    const keys = this._dirtyKeys();
    if (keys.length === 0) return;
    const patch = {};
    keys.forEach(k => { patch[k] = this._normalize(this._draft[k]); });

    const saveBtn = this._el.querySelector('[data-save]');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const { settings } = await updateGeneralSettings(patch);
      this._baseline = { ...settings };
      this._draft    = { ...settings };
      this._renderBody();
      showToast(t('adminGeneral.saved'), 'success');
    } catch (err) {
      if (saveBtn) saveBtn.disabled = false;
      showToast(t('adminGeneral.saveError') + ': ' + err.message, 'error', 6000);
    }
  }

  _discard() {
    this._draft = { ...this._baseline };
    this._renderBody();
  }
}
