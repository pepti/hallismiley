// Floating theme switcher — a discreet FAB (bottom-left, opposite the
// change-request widget) opening a small popover with the six site themes
// (see themes.css) and, for admins only, a per-browser TEST-mode switch that
// overrides the server's app-env (see services/themePrefs.js).
//
// Mounted once from main.js, outside #app, so it survives SPA navigation.
// The popover is rebuilt on every open so labels always use the current
// locale and the TEST row tracks the current user's role.
import { t } from '../i18n/i18n.js';
import { isAdmin } from '../services/auth.js';
import {
  THEMES, getTheme, setTheme,
  getServerEnv, getTestOverride, setTestOverride,
} from '../services/themePrefs.js';

const PALETTE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 1 10-10c0 2.21-1.79 3-4 3h-2.5a2.5 2.5 0 0 0-1.9 4.13c.37.43.4 1.06.03 1.5-.4.47-1 .87-1.63.37Z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="16" cy="9.5" r="1"/></svg>';

// Swatch fills are hard-coded on purpose: each swatch advertises its own
// theme regardless of which theme is currently active. classic = this site's
// existing dark charcoal default; the colour themes show an accent→background
// gradient so the swatch previews their immersive look.
const SWATCH_COLORS = {
  classic: '#202020',
  glacier: 'linear-gradient(135deg, #5FB4E8 0%, #0B2138 100%)',
  moss: 'linear-gradient(135deg, #6FD08E 0%, #0F2418 100%)',
  lava: 'linear-gradient(135deg, #FF8347 0%, #221210 100%)',
  aurora: 'linear-gradient(135deg, #CDB8FB 0%, #123E39 100%)',
  'black-sand': '#1A1A1A',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class ThemeSwitcher {
  constructor() {
    this.root = null;
    this.fab = null;
    this.popover = null;
    this.open = false;
    this._onDocPointerDown = this._onDocPointerDown.bind(this);
    this._onDocKeydown = this._onDocKeydown.bind(this);
    this._onNav = this._onNav.bind(this);
    this._onAuthChange = this._onAuthChange.bind(this);
  }

  render() {
    this.root = document.createElement('div');
    this.root.className = 'theme-switcher';
    this.root.innerHTML = `
      <div class="theme-switcher__popover" role="dialog" hidden></div>
      <button type="button" class="theme-switcher__fab" aria-haspopup="dialog" aria-expanded="false">${PALETTE_ICON}</button>
    `;
    this.popover = this.root.querySelector('.theme-switcher__popover');
    this.fab = this.root.querySelector('.theme-switcher__fab');
    this.fab.addEventListener('click', () => (this.open ? this._close() : this._open()));
    this._refreshFabLabel();

    // Close on navigation (also sidesteps stale-locale labels) and rebuild the
    // open popover on login/logout so the admin-only TEST row tracks the user.
    window.addEventListener('spa:navigate', this._onNav);
    window.addEventListener('popstate', this._onNav);
    window.addEventListener('authchange', this._onAuthChange);
    return this.root;
  }

  _refreshFabLabel() {
    const label = t('themeSwitcher.open');
    this.fab.setAttribute('aria-label', label);
    this.fab.setAttribute('title', label);
  }

  _open() {
    this.open = true;
    this._refreshFabLabel(); // locale may have changed since render/mount
    this._renderPopover();
    this.popover.hidden = false;
    this.root.classList.add('theme-switcher--open');
    this.fab.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this._onDocPointerDown);
    document.addEventListener('keydown', this._onDocKeydown);
    this.popover.querySelector('[aria-pressed="true"]')?.focus();
  }

  _close() {
    if (!this.open) return;
    this.open = false;
    this.popover.hidden = true;
    this.root.classList.remove('theme-switcher--open');
    this.fab.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this._onDocPointerDown);
    document.removeEventListener('keydown', this._onDocKeydown);
  }

  _onDocPointerDown(e) {
    if (!this.root.contains(e.target)) this._close();
  }

  _onDocKeydown(e) {
    if (e.key === 'Escape') { this._close(); this.fab.focus(); }
  }

  _onNav() {
    this._close();
  }

  _onAuthChange() {
    if (this.open) this._renderPopover();
  }

  _renderPopover() {
    const active = getTheme();
    const swatches = THEMES.map((id) => {
      const name = t(`themeSwitcher.theme.${id}`);
      return `<button type="button" class="theme-switcher__swatch${id === 'black-sand' ? ' theme-switcher__swatch--dark' : ''}"
        data-theme-id="${id}" aria-pressed="${id === active}"
        aria-label="${esc(name)}" title="${esc(name)}"></button>`;
    }).join('');

    const testOn = (getTestOverride() ?? getServerEnv()) === 'test';
    const testRow = isAdmin() ? `
      <div class="theme-switcher__test">
        <span class="theme-switcher__test-text">
          <span class="theme-switcher__test-label">${esc(t('themeSwitcher.testMode'))}</span>
          <span class="theme-switcher__test-note">${esc(t('themeSwitcher.testModeNote'))}</span>
        </span>
        <button type="button" class="theme-switcher__toggle" role="switch"
          aria-checked="${testOn}" aria-label="${esc(t('themeSwitcher.testMode'))}">
          <span class="theme-switcher__toggle-knob"></span>
        </button>
      </div>` : '';

    this.popover.setAttribute('aria-label', t('themeSwitcher.title'));
    this.popover.innerHTML = `
      <div class="theme-switcher__title">${esc(t('themeSwitcher.title'))}</div>
      <div class="theme-switcher__swatches">${swatches}</div>
      ${testRow}
    `;

    this.popover.querySelectorAll('.theme-switcher__swatch').forEach((btn) => {
      btn.style.setProperty('--swatch', SWATCH_COLORS[btn.dataset.themeId]);
      btn.addEventListener('click', () => {
        setTheme(btn.dataset.themeId);
        this.popover.querySelectorAll('.theme-switcher__swatch')
          .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      });
    });

    const toggle = this.popover.querySelector('.theme-switcher__toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const on = toggle.getAttribute('aria-checked') !== 'true';
        toggle.setAttribute('aria-checked', String(on));
        this._setTestMode(on);
      });
    }
  }

  // Per-browser TEST-mode flip: persist the override (absent = follow server),
  // toggle the body class driving test-env.css, and mount/unmount the shared
  // change-request widget instance. The dynamic import keeps the widget +
  // html2canvas off the production bundle unless an admin toggles it on.
  async _setTestMode(on) {
    const want = on ? 'test' : 'production';
    setTestOverride(want === getServerEnv() ? null : want);
    document.body.classList.toggle('is-test-env', on);
    const m = await import('./ChangeRequestWidget.js').catch((err) => {
      console.error('[theme-switcher] change-request widget failed to load', err);
      return null;
    });
    if (!m) return;
    if (on) m.mountChangeRequestWidget();
    else m.unmountChangeRequestWidget();
  }
}
