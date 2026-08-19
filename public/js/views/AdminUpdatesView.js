// AdminUpdatesView (/admin/updates) — what this instance is running, what it
// could be running, and who gets to decide.
//
// The screen is written around one idea: an update is a RESTART, and the person
// clicking has to know that before they click, not after. So the confirm dialog
// names the expected downtime, the status card says where updates come from,
// and a managed instance gets a plain sentence instead of a disabled button
// that invites clicking.
//
// Everything comes from GET /api/v1/system/updates in one round trip — the
// server also computes when the next maintenance window actually opens, so the
// browser's clock and time zone can never disagree with the scheduler.
import { isAuthenticated, canSeeView, isAdmin, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { resetBuildInfo } from '../services/buildInfo.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function fmtDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}
function fmtDay(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }); }
  catch { return String(value); }
}
const shortDigest = d => (d ? String(d).replace(/^sha256:/, '').slice(0, 12) : '—');

export class AdminUpdatesView {
  constructor() { this._el = null; this._data = null; this._busy = false; }

  async render() {
    if (!isAuthenticated() || !canSeeView('updates')) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }
    this._el = document.createElement('div');
    this._el.className = 'main admin-page updates-page';
    this._el.innerHTML = `
      <h1 class="admin-title">${t('admin.updates.title')}</h1>
      <p class="updates-sub">${t('admin.updates.subtitle')}</p>
      <div id="updates-body"><div class="admin-loading">${t('form.loading')}</div></div>`;

    await this._load();
    return renderAdminShell({ activePath: '/admin/updates', content: this._el });
  }

  async _load() {
    const body = this._el.querySelector('#updates-body');
    try {
      const res  = await fetch('/api/v1/system/updates', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('admin.updates.loadError'));
      this._data = data;
      this._paint();
    } catch (err) {
      body.innerHTML = `<p class="admin-error">${escHtml(err.message)}</p>`;
    }
  }

  _paint() {
    const { build, settings, available, history } = this._data;
    this._el.querySelector('#updates-body').innerHTML = [
      this._statusCard(build, settings),
      this._availableCard(available, settings),
      this._settingsCard(settings),
      this._historyCard(history),
    ].join('');
    this._wire();
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  _statusCard(build, settings) {
    const dev = build.version === 'dev';
    const rows = [
      [t('admin.updates.version'), dev ? t('admin.build.dev') : escHtml(build.version)],
      [t('admin.updates.gitSha'),  `<code>${escHtml(String(build.gitSha).slice(0, 12))}</code>`],
      [t('admin.updates.builtAt'), escHtml(fmtDate(build.builtAt))],
      [t('admin.updates.channel'), escHtml(settings.channel)],
      [t('admin.updates.mode'),    escHtml(t('admin.updates.mode_' + settings.mode))],
      [t('admin.updates.source'),  settings.manifestHost ? `<code>${escHtml(settings.manifestHost)}</code>` : '—'],
    ];
    return `
      <section class="updates-card updates-card--status" data-testid="updates-status">
        <h2 class="updates-card__title">${t('admin.updates.statusTitle')}</h2>
        <dl class="updates-facts">
          ${rows.map(([k, v]) => `<div class="updates-fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
        ${dev ? `<p class="updates-note">${t('admin.updates.devNote')}</p>` : ''}
      </section>`;
  }

  // ── Available update ───────────────────────────────────────────────────────
  _availableCard(update, settings) {
    if (!update) {
      return `
        <section class="updates-card updates-card--current" data-testid="updates-available">
          <h2 class="updates-card__title">${t('admin.updates.upToDateTitle')}</h2>
          <p>${t('admin.updates.upToDate')}</p>
        </section>`;
    }

    const badges = [
      update.critical ? `<span class="updates-badge updates-badge--critical">${t('admin.updates.critical')}</span>` : '',
      update.compatible ? '' : `<span class="updates-badge updates-badge--blocked">${t('admin.updates.incompatible')}</span>`,
      update.status === 'scheduled' ? `<span class="updates-badge">${t('admin.updates.status_scheduled')}</span>` : '',
    ].join('');

    return `
      <section class="updates-card updates-card--available" data-testid="updates-available">
        <h2 class="updates-card__title">
          ${t('admin.updates.availableTitle')} <strong class="updates-version">${escHtml(update.version)}</strong> ${badges}
        </h2>
        <p class="updates-meta">
          ${t('admin.updates.published')}: ${escHtml(fmtDate(update.publishedAt || update.discoveredAt))}
          · <code>${escHtml(shortDigest(update.imageDigest))}</code>
        </p>
        ${update.changelogHtml ? `<div class="updates-changelog">${update.changelogHtml}</div>` : ''}
        ${update.compatible ? '' : `<p class="updates-warn">${t('admin.updates.incompatibleNote').replace('{version}', escHtml(update.minCompatibleVersion || ''))}</p>`}
        ${this._actions(update, settings)}
      </section>`;
  }

  _actions(update, settings) {
    // A managed instance says so in words. A disabled button would invite a
    // click and explain nothing.
    if (settings.managed) {
      return `<p class="updates-managed" data-testid="updates-managed">${t('admin.updates.managedNote')}</p>`;
    }
    if (!isAdmin()) {
      return `<p class="updates-note">${t('admin.updates.readOnlyNote')}</p>`;
    }
    if (!update.compatible) return '';

    const scheduled = update.status === 'scheduled' && update.scheduledFor
      ? `<p class="updates-scheduled" data-testid="updates-scheduled">${t('admin.updates.scheduledFor').replace('{when}', escHtml(fmtDate(update.scheduledFor)))}</p>`
      : '';

    // No trigger configured means the platform never wired this instance up for
    // deployment. Saying so beats a button that 503s at the moment of truth.
    const blocked = !settings.triggerConfigured
      ? `<p class="updates-warn" data-testid="updates-no-trigger">${t('admin.updates.noTrigger')}</p>`
      : '';

    return `
      ${scheduled}
      ${blocked}
      <div class="updates-actions">
        <button type="button" class="btn btn-primary" data-apply="${update.id}" ${settings.triggerConfigured ? '' : 'disabled'}>
          ${settings.mode === 'auto' && update.status === 'scheduled' ? t('admin.updates.applyNowInstead') : t('admin.updates.applyNow')}
        </button>
      </div>`;
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  _settingsCard(settings) {
    // Managed instances have nothing to set — the contract is the setting.
    if (settings.managed || !isAdmin()) return '';
    const w = settings.maintenanceWindow;

    return `
      <section class="updates-card updates-card--settings" data-testid="updates-settings">
        <h2 class="updates-card__title">${t('admin.updates.settingsTitle')}</h2>

        <div class="updates-field">
          <span class="updates-field__label" id="updates-mode-label">${t('admin.updates.mode')}</span>
          <div class="updates-modes" role="radiogroup" aria-labelledby="updates-mode-label">
            ${['manual', 'auto'].map(m => `
              <label class="updates-mode">
                <input type="radio" name="updates-mode" value="${m}" ${settings.mode === m ? 'checked' : ''}>
                <span><strong>${t('admin.updates.mode_' + m)}</strong><small>${t('admin.updates.modeHelp_' + m)}</small></span>
              </label>`).join('')}
          </div>
        </div>

        <fieldset class="updates-field updates-window" ${settings.mode === 'auto' ? '' : 'disabled'}>
          <legend class="updates-field__label">${t('admin.updates.window')}</legend>
          <p class="updates-hint">${t('admin.updates.windowHelp')}</p>
          <div class="updates-days">
            ${DAYS.map(d => `
              <label class="updates-day">
                <input type="checkbox" name="updates-day" value="${d}" ${w.days.includes(d) ? 'checked' : ''}>
                <span>${t('admin.updates.day_' + d)}</span>
              </label>`).join('')}
          </div>
          <div class="updates-hours">
            <label>${t('admin.updates.fromHour')}
              <input type="number" id="updates-from" min="0" max="23" step="1" value="${w.fromHour}">
            </label>
            <label>${t('admin.updates.toHour')}
              <input type="number" id="updates-to" min="0" max="23" step="1" value="${w.toHour}">
            </label>
            <span class="updates-tz">${escHtml(w.tz)}</span>
          </div>
          <p class="updates-next" data-testid="updates-next-window">
            ${t('admin.updates.nextWindow')}: <strong>${escHtml(settings.nextWindowStart ? fmtDay(settings.nextWindowStart) + ' ' + fmtDate(settings.nextWindowStart).split(', ').pop() : t('admin.updates.never'))}</strong>
          </p>
        </fieldset>

        <details class="updates-advanced">
          <summary>${t('admin.updates.advanced')}</summary>
          <div class="updates-field">
            <label class="updates-field__label" for="updates-channel">${t('admin.updates.channel')}</label>
            <select id="updates-channel">
              ${['stable', 'canary'].map(c => `<option value="${c}" ${settings.channel === c ? 'selected' : ''}>${t('admin.updates.channel_' + c)}</option>`).join('')}
            </select>
            <p class="updates-hint">${t('admin.updates.channelHelp')}</p>
          </div>
        </details>

        <div class="updates-actions">
          <button type="button" class="btn btn-primary" data-testid="updates-save" id="updates-save">${t('admin.updates.save')}</button>
        </div>
      </section>`;
  }

  // ── History ────────────────────────────────────────────────────────────────
  _historyCard(history) {
    if (!history || !history.length) return '';
    const rows = history.map(u => `
      <tr>
        <td>${escHtml(u.version)}</td>
        <td><span class="updates-chip updates-chip--${escHtml(u.status)}">${t('admin.updates.status_' + u.status)}</span></td>
        <td>${escHtml(fmtDate(u.appliedAt || u.discoveredAt))}</td>
        <td><code>${escHtml(shortDigest(u.imageDigest))}</code></td>
        <td>
          ${u.failureReason ? `<span class="updates-fail">${escHtml(u.failureReason)}</span>` : ''}
          ${(u.status === 'failed' || u.status === 'applied') && isAdmin() && !this._data.settings.managed
            ? `<button type="button" class="admin-shop__link" data-rollback="${u.id}">${t('admin.updates.rollback')}</button>` : ''}
        </td>
      </tr>`).join('');

    return `
      <section class="updates-card updates-card--history" data-testid="updates-history">
        <h2 class="updates-card__title">${t('admin.updates.historyTitle')}</h2>
        <div class="updates-table-wrap">
          <table class="updates-table">
            <thead><tr>
              <th>${t('admin.updates.version')}</th>
              <th>${t('admin.updates.status')}</th>
              <th>${t('admin.updates.when')}</th>
              <th>${t('admin.updates.digest')}</th>
              <th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  _wire() {
    const el = this._el;

    el.querySelectorAll('[data-apply]').forEach(btn => btn.addEventListener('click', () => {
      const version = this._data.available ? this._data.available.version : '';
      // The confirmation names the consequence — a restart — because that is
      // the part someone clicking "update" at 14:00 on a Tuesday needs to know.
      if (!window.confirm(t('admin.updates.confirmApply').replace('{version}', version))) return;
      this._post(`/api/v1/system/updates/${btn.dataset.apply}/apply`, t('admin.updates.applyStarted'));
    }));

    el.querySelectorAll('[data-rollback]').forEach(btn => btn.addEventListener('click', () => {
      if (!window.confirm(t('admin.updates.confirmRollback'))) return;
      this._post(`/api/v1/system/updates/${btn.dataset.rollback}/rollback`, t('admin.updates.rollbackStarted'), (data) => {
        // When the platform cannot be driven from here, the operator gets the
        // exact command rather than a shrug.
        if (!data.triggered && data.command) window.prompt(t('admin.updates.rollbackManual'), data.command);
      });
    }));

    const modeRadios = el.querySelectorAll('input[name="updates-mode"]');
    modeRadios.forEach(r => r.addEventListener('change', () => {
      const win = el.querySelector('.updates-window');
      if (win) win.disabled = el.querySelector('input[name="updates-mode"]:checked').value !== 'auto';
    }));

    el.querySelector('#updates-save')?.addEventListener('click', () => this._saveSettings());
  }

  _readSettings() {
    const el = this._el;
    return {
      mode: el.querySelector('input[name="updates-mode"]:checked').value,
      channel: el.querySelector('#updates-channel').value,
      maintenanceWindow: {
        days: [...el.querySelectorAll('input[name="updates-day"]:checked')].map(c => c.value),
        fromHour: Number(el.querySelector('#updates-from').value),
        toHour:   Number(el.querySelector('#updates-to').value),
        tz:       this._data.settings.maintenanceWindow.tz,
      },
    };
  }

  async _saveSettings() {
    await this._send('PATCH', '/api/v1/system/settings', this._readSettings(), t('admin.updates.saved'));
  }

  _post(url, successMessage, after) {
    return this._send('POST', url, undefined, successMessage, after);
  }

  async _send(method, url, payload, successMessage, after) {
    if (this._busy) return;
    this._busy = true;
    try {
      const token = await getCSRFToken();
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('admin.updates.actionFailed'));
      showToast(successMessage, 'success');
      if (after) after(data);
      // The build stamp in the sidebar is now potentially stale.
      resetBuildInfo();
      await this._load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      this._busy = false;
    }
  }

  destroy() {}
}
