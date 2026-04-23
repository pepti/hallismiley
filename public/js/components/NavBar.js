import { isAuthenticated, isAdmin, canEdit, getUser, logout, updateProfile } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { LoginModal } from './LoginModal.js';
import { CartIcon } from './CartIcon.js';
import { t, getLocale, switchLocale, href, SUPPORTED_LOCALES } from '../i18n/i18n.js';
import { navigate } from '../navigate.js';

const avatarPathByName = name => `/assets/avatars/${name || 'avatar-01.svg'}`;

// Build a locale-prefixed clean URL for a route (e.g. '/en/projects').
function navHref(route) {
  return href(route);
}

export class NavBar {
  constructor() {
    this._loginModal = new LoginModal();
    this._cartIcon   = new CartIcon();
    this._nav        = null;
  }

  render() {
    const nav = document.createElement('nav');
    nav.className = 'lol-nav';
    nav.setAttribute('aria-label', 'Main navigation');
    nav.innerHTML = this._navHtml();

    this._nav = nav;

    // Mount cart icon
    const cartSlot = nav.querySelector('#nav-cart-slot');
    if (cartSlot) cartSlot.appendChild(this._cartIcon.render());

    this._renderAuth();
    this._bindScrollLinks(nav);
    this._bindHomeLinks(nav);
    this._bindHamburger(nav);
    this._bindNavLinks(nav);

    window.addEventListener('authchange', () => this._renderAuth());

    return nav;
  }

  /** Called by Router when the locale changes — refreshes all translatable text. */
  updateLocale() {
    if (!this._nav) return;

    // Update nav link labels
    this._nav.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = t(key);
    });
    this._nav.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    // Rebuild hrefs with new locale prefix
    this._nav.querySelectorAll('[data-route]').forEach(link => {
      if (link.tagName === 'A') link.href = navHref(link.dataset.route);
    });
    // Re-render auth section (user name / sign-in buttons)
    this._renderAuth();
    // Sync the segmented language toggle — mark the active locale, update
    // aria-pressed, refresh the group aria-label to the active language.
    const group = this._nav.querySelector('.lol-nav__lang');
    if (group) group.setAttribute('aria-label', t('nav.languageSwitcher'));
    const active = getLocale();
    this._nav.querySelectorAll('.lol-nav__lang-opt').forEach(btn => {
      const isActive = btn.dataset.locale === active;
      btn.classList.toggle('lol-nav__lang-opt--active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
      const lc = btn.dataset.locale;
      btn.setAttribute('aria-label', t('nav.switchTo' + lc.charAt(0).toUpperCase() + lc.slice(1)));
    });
  }

  _navHtml() {
    return `
      <!-- Left: Brand -->
      <div class="lol-nav__brand">
        <a href="${navHref('/')}" class="lol-nav__logo" data-route="/" aria-label="${t('nav.brandAriaLabel')}">
          <div class="lol-nav__logo-icon" aria-hidden="true">H</div>
          <div class="lol-nav__logo-text">Halli<br>Smiley</div>
        </a>
      </div>

      <!-- Center: Navigation links + (on mobile) language toggle + auth CTAs -->
      <div class="lol-nav__center" id="nav-menu">
        <a href="${navHref('/')}"        class="lol-nav__link" data-route="/"        data-i18n="nav.home">${t('nav.home')}</a>
        <a href="${navHref('/projects')}" class="lol-nav__link" data-route="/projects" data-i18n="nav.projects">${t('nav.projects')}</a>
        <a href="${navHref('/shop')}"     class="lol-nav__link" data-route="/shop"     data-i18n="nav.shop">${t('nav.shop')}</a>
        <a href="${navHref('/news')}"     class="lol-nav__link" data-route="/news"     data-i18n="nav.news">${t('nav.news')}</a>
        <a href="${navHref('/halli')}"    class="lol-nav__link" data-route="/halli"    data-i18n="nav.halli">${t('nav.halli')}</a>
        <a href="${navHref('/contact')}"  class="lol-nav__link" data-route="/contact"  data-i18n="nav.contact">${t('nav.contact')}</a>
        <a href="${navHref('/party')}"    class="lol-nav__link lol-nav__party-link" data-route="/party"
           id="nav-party-link" aria-label="${t('nav.partyAriaLabel')}" data-i18n-aria="nav.partyAriaLabel"
           data-i18n="nav.party">${t('nav.party')}</a>
        <div class="lol-nav__mobile-extras">
          ${this._langSwitcherHtml()}
          <div class="lol-nav__auth" id="nav-auth-mobile"></div>
        </div>
      </div>

      <!-- Right: Cart + Language + Hamburger + Auth -->
      <div class="lol-nav__right">
        <div class="lol-nav__cart-slot" id="nav-cart-slot"></div>
        ${this._langSwitcherHtml()}
        <button class="lol-nav__hamburger" id="nav-hamburger"
                aria-label="${t('nav.openMenu')}" aria-expanded="false" aria-controls="nav-menu">
          <span></span><span></span><span></span>
        </button>
        <div class="lol-nav__auth" id="nav-auth"></div>
      </div>
    `;
  }

  _langSwitcherHtml() {
    // Segmented toggle — both languages always visible, one-click switch.
    // More discoverable + faster than a dropdown when there are only two
    // options, and scales fine to a third (just wider pill).
    const current = getLocale();
    const buttons = SUPPORTED_LOCALES
      .map(lc => `<button type="button"
                          class="lol-nav__lang-opt${lc === current ? ' lol-nav__lang-opt--active' : ''}"
                          data-locale="${lc}"
                          aria-pressed="${lc === current}"
                          aria-label="${t('nav.switchTo' + lc.charAt(0).toUpperCase() + lc.slice(1))}">${lc.toUpperCase()}</button>`)
      .join('');
    return `
      <div class="lol-nav__lang" role="group"
           aria-label="${t('nav.languageSwitcher')}">
        ${buttons}
      </div>`;
  }

  _bindLangSwitcher(nav) {
    nav.querySelectorAll('.lol-nav__lang-opt').forEach(optBtn => {
      optBtn.addEventListener('click', e => {
        e.stopPropagation();
        const newLocale = optBtn.dataset.locale;
        if (newLocale === getLocale()) return;   // already active, no-op
        // Persist to DB first so the session has the new locale when content re-fetches.
        if (isAuthenticated()) {
          updateProfile({ preferred_locale: newLocale })
            .catch(() => {})
            .finally(() => switchLocale(newLocale));
        } else {
          switchLocale(newLocale);
        }
      });
    });
  }

  _bindNavLinks(nav) {
    nav.querySelectorAll('.lol-nav__link[data-route]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        this._closeMenu();
        const route = link.dataset.route;
        navigate(navHref(route));
      });
    });
  }

  _renderAuth() {
    // Top bar: always populated (renders the user dropdown when logged-in,
    // or the Sign In / Sign Up CTAs when logged-out).  The top-bar CTAs are
    // hidden via CSS on mobile so the drawer copy takes over.  This slot
    // owns the canonical `data-testid` values so existing tests resolve to
    // exactly one element.
    const topBar = this._nav?.querySelector('#nav-auth');
    if (topBar) this._renderAuthInto(topBar, 'top');

    // Drawer: only populated with CTAs when logged-out.  When logged-in we
    // leave it empty — the user dropdown lives in the top bar on mobile
    // too (avatar is small enough to fit).  Drawer CTAs get `-drawer`
    // suffixed testids so Playwright's strict mode can still pick either
    // copy unambiguously.
    const drawer = this._nav?.querySelector('#nav-auth-mobile');
    if (drawer) {
      if (isAuthenticated()) {
        drawer.innerHTML = '';
      } else {
        this._renderAuthInto(drawer, 'drawer');
      }
    }

    // Re-bind the language switcher after each auth re-render
    // (lives outside the auth containers but we need to ensure it's wired)
    this._bindLangSwitcher(this._nav);
  }

  _renderAuthInto(container, slot = 'top') {
    container.innerHTML = '';
    const suffix = slot === 'drawer' ? '-drawer' : '';

    if (isAuthenticated()) {
      const user = getUser();

      const userBtn = document.createElement('button');
      userBtn.className = 'lol-nav__user-btn';
      userBtn.setAttribute('aria-haspopup', 'true');
      userBtn.setAttribute('aria-expanded', 'false');
      userBtn.setAttribute('aria-label', t('nav.userMenu'));
      userBtn.setAttribute('data-testid', `nav-user-btn${suffix}`);
      userBtn.innerHTML = `
        <img class="lol-nav__user-avatar" src="${avatarPathByName(user?.avatar)}"
             alt="${escHtml(user?.username || 'User')}" />
        <span class="lol-nav__user-name">${escHtml(user?.displayName || user?.username || t('nav.profile'))}</span>
        <span class="lol-nav__user-caret" aria-hidden="true">▾</span>
      `;

      const dropdown = document.createElement('div');
      dropdown.className = 'lol-nav__dropdown';
      dropdown.setAttribute('role', 'menu');
      dropdown.innerHTML = `
        <a href="${navHref('/profile')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/profile">
          ${t('nav.profile')}
        </a>
        ${isAdmin() ? `
        <a href="${navHref('/admin')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/admin">
          ${t('nav.manageProjects')}
        </a>
        <a href="${navHref('/admin/users')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/admin/users">
          ${t('nav.manageUsers')}
        </a>` : ''}
        ${canEdit() ? `
        <a href="${navHref('/party/admin')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/party/admin">
          ${t('nav.partyAdmin')}
        </a>` : ''}
        ${isAdmin() ? `
        <a href="${navHref('/admin/shop/products')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/admin/shop/products">
          ${t('nav.manageProducts')}
        </a>
        <a href="${navHref('/admin/shop/orders')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/admin/shop/orders">
          ${t('nav.manageOrders')}
        </a>` : ''}
        <a href="${navHref('/orders')}" class="lol-nav__dropdown-item" role="menuitem" data-route="/orders">
          ${t('nav.myOrders')}
        </a>
        <hr class="lol-nav__dropdown-divider"/>
        <button class="lol-nav__dropdown-item lol-nav__dropdown-item--danger" role="menuitem" data-signout data-testid="nav-signout${suffix}">
          ${t('nav.signOut')}
        </button>
      `;

      const wrapper = document.createElement('div');
      wrapper.className = 'lol-nav__user-wrap';
      wrapper.appendChild(userBtn);
      wrapper.appendChild(dropdown);

      userBtn.addEventListener('click', e => {
        e.stopPropagation();
        const open = dropdown.classList.toggle('open');
        userBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      document.addEventListener('click', () => {
        dropdown.classList.remove('open');
        userBtn.setAttribute('aria-expanded', 'false');
      });

      dropdown.querySelector('[data-signout]').addEventListener('click', async () => {
        await logout();
        navigate(navHref('/'));
      });

      // Intercept dropdown anchor clicks to add locale prefix
      dropdown.querySelectorAll('a[data-route]').forEach(link => {
        link.addEventListener('click', e => {
          e.preventDefault();
          dropdown.classList.remove('open');
          navigate(navHref(link.dataset.route));
        });
      });

      container.appendChild(wrapper);

    } else {
      const signIn = document.createElement('button');
      signIn.className = 'lol-nav__cta lol-nav__cta--ghost';
      signIn.setAttribute('data-testid', `nav-signin${suffix}`);
      signIn.textContent = t('nav.signIn');
      signIn.addEventListener('click', () => {
        this._closeMenu();
        this._loginModal.open();
      });

      const signUp = document.createElement('a');
      signUp.className = 'lol-nav__cta lol-nav__cta--ghost';
      signUp.setAttribute('data-testid', `nav-signup${suffix}`);
      signUp.href = navHref('/signup');
      signUp.dataset.route = '/signup';
      signUp.textContent = t('nav.signUp');
      signUp.addEventListener('click', e => {
        e.preventDefault();
        this._closeMenu();
        navigate(navHref('/signup'));
      });

      container.appendChild(signIn);
      container.appendChild(signUp);
    }
  }

  _bindHomeLinks(nav) {
    nav.querySelectorAll('[data-route="/"]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        this._closeMenu();
        const target = navHref('/');
        const onHome = window.location.pathname === target || window.location.pathname === '/';
        if (onHome) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          navigate(target);
          setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
        }
      });
    });
  }

  _bindScrollLinks(nav) {
    nav.querySelectorAll('[data-scroll]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        this._closeMenu();
        const id     = link.dataset.scroll;
        const home   = navHref('/');
        if (!window.location.pathname.startsWith(home)) {
          navigate(home);
          setTimeout(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
          }, 300);
        } else {
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  _bindHamburger(nav) {
    const hamburger = nav.querySelector('#nav-hamburger');
    const menu      = nav.querySelector('#nav-menu');
    if (!hamburger || !menu) return;

    hamburger.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      hamburger.setAttribute('aria-label', isOpen ? t('nav.closeMenu') : t('nav.openMenu'));
    });

    menu.querySelectorAll('.lol-nav__link').forEach(link => {
      link.addEventListener('click', () => this._closeMenu());
    });

    document.addEventListener('click', e => {
      if (!nav.contains(e.target)) this._closeMenu();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._closeMenu();
    });
  }

  _closeMenu() {
    const menu      = this._nav?.querySelector('#nav-menu');
    const hamburger = this._nav?.querySelector('#nav-hamburger');
    if (!menu) return;
    menu.classList.remove('open');
    if (hamburger) {
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('aria-label', t('nav.openMenu'));
    }
  }

  setActive(route) {
    document.querySelectorAll('.lol-nav__link[data-route]').forEach(a => {
      a.classList.toggle('active', a.dataset.route === route);
    });
  }
}
