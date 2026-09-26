// AdminAnnouncementView (/admin/announcement) — Tilkynning: a time-limited
// announcement every signed-out visitor sees, first as a dialog and then as a
// slim banner (components/CutoverNotice.js). Ported from icelandicstore #200
// (harvest2-lane7a-2026-09-26), made generic: ice's copy pointed imported
// Shopify customers at the password reset; here the title, message and an
// optional in-site link are the admin's.
//
// The window (start and end, date AND time, Reykjavík time, half-open) is
// decided on the SERVER (utils/announcementWindow.js); the "live now" chip is
// the same rule the public endpoint applies, recomputed on every save.
// Save model as AdminCheckoutSettingsView (flat draft, dirty keys only); the
// co-* classes are that page's (admin-checkout-settings.css).
import { isAuthenticated, canSeeView } from '../services/auth.js';
import { getAnnouncement, updateAnnouncement } from '../services/adminAnnouncement.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';

const SETTING_KEYS = [
  'enabled', 'starts_at', 'ends_at',
  'title.is', 'title.en', 'message.is', 'message.en',
  'link_path', 'link_label.is', 'link_label.en',
];

function flatten(settings) {
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), settings);
  const out = {};
  for (const k of SETTING_KEYS) out[k] = k === 'enabled' ? get(k) === true : (get(k) ?? '');
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [p, value] of Object.entries(flat)) {
    const parts = p.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) node = (node[parts[i]] ||= {});
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

export class AdminAnnouncementView {
  constructor() {
    this._baseline = null;
    this._draft = null;
    this._status = null;
  }

  async render() {
    if (!isAuthenticated() || !canSeeView('announcement')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    const el = document.createElement('div');
    el.className = 'main admin-page co-page';
    el.innerHTML = `
      <div class="co-head">
        <h1 class="admin-title">${t('adminAnnouncement.title')}</h1>
        <p class="co-sub">${t('adminAnnouncement.subtitle')}</p>
      </div>
      <div id="an-body"><div class="admin-loading">${t('form.loading')}</div></div>
    `;
    this._el = el;
    await this._load();
    return renderAdminShell({ activePath: '/admin/announcement', content: el });
  }

  async _load() {
    const body = this._el.querySelector('#an-body');
    try {
      const data = await getAnnouncement();
      this._baseline = flatten(data.settings);
      this._draft = { ...this._baseline };
      this._status = data.status || {};
      this._renderBody();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${t('adminAnnouncement.loadError')}: ${escHtml(err.message)}</p>`;
    }
  }

  _renderBody() {
    const d = this._draft;
    const live = this._status && this._status.active === true;
    this._el.querySelector('#an-body').innerHTML = `
      <div class="co-banner" role="note">
        <p class="co-banner__text">${t('adminAnnouncement.banner')}</p>
      </div>

      ${this._card(t('adminAnnouncement.windowTitle'), `
        ${this._row({
          title: live ? t('adminAnnouncement.statusLive') : t('adminAnnouncement.statusOff'),
          help: live ? '' : t('adminAnnouncement.statusOffHelp'),
          control: `<span class="co-chip${live ? ' co-chip--on' : ''}" data-testid="announcement-status">${live ? t('adminAnnouncement.statusLive') : t('adminAnnouncement.statusOff')}</span>`,
        })}
        ${this._row({
          title: t('adminAnnouncement.enabled'), help: t('adminAnnouncement.enabledHelp'),
          control: `<button type="button" class="co-switch${d.enabled ? ' is-on' : ''}" data-toggle="enabled"
                      role="switch" aria-checked="${d.enabled ? 'true' : 'false'}"
                      aria-label="${escHtml(t('adminAnnouncement.enabled'))}"></button>`,
        })}
        ${this._row({ title: t('adminAnnouncement.startsAt'), help: t('adminAnnouncement.startsAtHelp'),
          control: this._datetime('starts_at', t('adminAnnouncement.startsAt')) })}
        ${this._row({ title: t('adminAnnouncement.endsAt'), help: t('adminAnnouncement.endsAtHelp'),
          control: this._datetime('ends_at', t('adminAnnouncement.endsAt')) })}
      `)}

      ${this._card(t('adminAnnouncement.copyTitle'), `
        ${this._row({ stacked: true, title: t('adminAnnouncement.headingIs'), help: t('adminAnnouncement.headingHelp'),
          control: this._text('title.is', 120, t('adminAnnouncement.headingIs')) })}
        ${this._row({ stacked: true, title: t('adminAnnouncement.headingEn'), help: '',
          control: this._text('title.en', 120, t('adminAnnouncement.headingEn')) })}
        ${this._row({ stacked: true, title: t('adminAnnouncement.messageIs'), help: t('adminAnnouncement.messageHelp'),
          control: this._textarea('message.is', 600, t('adminAnnouncement.messageIs')) })}
        ${this._row({ stacked: true, title: t('adminAnnouncement.messageEn'), help: '',
          control: this._textarea('message.en', 600, t('adminAnnouncement.messageEn')) })}
      `)}

      ${this._card(t('adminAnnouncement.linkTitle'), `
        ${this._row({ stacked: true, title: t('adminAnnouncement.linkPath'), help: t('adminAnnouncement.linkPathHelp'),
          control: this._text('link_path', 200, t('adminAnnouncement.linkPath'), '/hafa-samband') })}
        ${this._row({ stacked: true, title: t('adminAnnouncement.linkLabelIs'), help: '',
          control: this._text('link_label.is', 60, t('adminAnnouncement.linkLabelIs')) })}
        ${this._row({ stacked: true, title: t('adminAnnouncement.linkLabelEn'), help: '',
          control: this._text('link_label.en', 60, t('adminAnnouncement.linkLabelEn')) })}
      `)}

      <div class="co-savebar" id="an-savebar" hidden>
        <span class="co-savebar__msg">${t('adminAnnouncement.unsavedChanges')}</span>
        <div class="co-savebar__actions">
          <button type="button" class="btn btn--sm btn--ghost" data-discard>${t('adminAnnouncement.discard')}</button>
          <button type="button" class="btn btn--sm btn--primary" data-save>${t('adminAnnouncement.save')}</button>
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

  // A native date-time picker: its value is already the 'YYYY-MM-DDTHH:mm'
  // the model reads (as Reykjavík time); cleared = no bound on that side.
  _datetime(key, label) {
    return `<input type="datetime-local" class="co-input" data-input="${escHtml(key)}"
              value="${escHtml(this._draft[key] || '')}" aria-label="${escHtml(label)}">`;
  }

  _text(key, max, label, placeholder = '') {
    return `<input type="text" class="co-input co-input--wide" data-input="${escHtml(key)}" maxlength="${max}"
              value="${escHtml(this._draft[key] || '')}" aria-label="${escHtml(label)}"
              ${placeholder ? `placeholder="${escHtml(placeholder)}"` : ''}>`;
  }

  _textarea(key, max, label) {
    return `<textarea class="co-textarea" data-input="${escHtml(key)}" rows="3" maxlength="${max}"
              aria-label="${escHtml(label)}">${escHtml(this._draft[key] || '')}</textarea>`;
  }

  _bind() {
    const body = this._el.querySelector('#an-body');
    body.querySelectorAll('[data-input]').forEach((inp) => {
      inp.addEventListener('input', () => {
        this._draft[inp.dataset.input] = inp.value;
        this._recomputeDirty();
      });
    });
    body.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = this._draft.enabled !== true;
        this._draft.enabled = on;
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
    const bar = this._el.querySelector('#an-savebar');
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
      const { settings, status } = await updateAnnouncement(unflatten(flat));
      this._baseline = flatten(settings);
      this._draft = { ...this._baseline };
      this._status = status || {};
      this._renderBody();
      showToast(t('adminAnnouncement.saved'), 'success');
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`${t('adminAnnouncement.saveError')}: ${err.message}`, 'error', 6000);
    }
  }

  _discard() {
    this._draft = { ...this._baseline };
    this._renderBody();
  }
}
