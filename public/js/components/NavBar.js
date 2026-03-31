import { isAuthenticated, isAdmin, getUser, logout } from '../services/auth.js';
import { LoginModal } from './LoginModal.js';

const avatarPathByName = name => `/assets/avatars/${name || 'avatar-01.svg'}`;

export class NavBar {
  constructor() {
    this._loginModal = new LoginModal();
  }

  render() {
    const nav = document.createElement('nav');
    nav.className = 'lol-nav';
    nav.setAttribute('aria-label', 'Main navigation');
    nav.innerHTML = `
      <!-- Left: Brand -->
      <div class="lol-nav__brand">
        <a href="#/" class="lol-nav__logo" data-route="/" aria-label="Halli Smiley home">
          <div class="lol-nav__logo-icon" aria-hidden="true">H</div>
          <div class="lol-nav__logo-text">Halli<br>Smiley</div>
        </a>
      </div>

      <!-- Center: Navigation links -->
      <div class="lol-nav__center" id="nav-menu">
        <a href="#/" class="lol-nav__link" data-route="/">Home</a>
        <a href="#/projects" class="lol-nav__link" data-route="/projects">Projects</a>
        <a href="#/" class="lol-nav__link" data-scroll="news">News</a>
        <a href="#/about" class="lol-nav__link" data-route="/about">Skills</a>
        <a href="#/" class="lol-nav__link" data-scroll="contact">Contact</a>
      </div>

      <!-- Right: Hamburger + Auth -->
      <div class="lol-nav__right">
        <button class="lol-nav__hamburger" id="nav-hamburger"
                aria-label="Open navigation menu" aria-expanded="false" aria-controls="nav-menu">
          <span></span><span></span><span></span>
        </button>
        <div class="lol-nav__auth" id="nav-auth"></div>
      </div>
    `;

    this._nav = nav;
    this._renderAuth();
    this._bindScrollLinks(nav);
    this._bindHomeLinks(nav);
    this._bindHamburger(nav);

    window.addEventListener('authchange', () => this._renderAuth());

    return nav;
  }

  _renderAuth() {
    const container =
      document.getElementById('nav-auth') ||
      this._nav?.querySelector('#nav-auth');
    if (!container) return;
    container.innerHTML = '';

    if (isAuthenticated()) {
      const user = getUser();

      // Avatar + username dropdown trigger
      const userBtn = document.createElement('button');
      userBtn.className = 'lol-nav__user-btn';
      userBtn.setAttribute('aria-haspopup', 'true');
      userBtn.setAttribute('aria-expanded', 'false');
      userBtn.setAttribute('aria-label', 'User menu');
      userBtn.innerHTML = `
        <img class="lol-nav__user-avatar" src="${avatarPathByName(user?.avatar)}"
             alt="${user?.username || 'User'}" />
        <span class="lol-nav__user-name">${user?.displayName || user?.username || 'Account'}</span>
        <span class="lol-nav__user-caret" aria-hidden="true">▾</span>
      `;

      // Dropdown menu
      const dropdown = document.createElement('div');
      dropdown.className = 'lol-nav__dropdown';
      dropdown.setAttribute('role', 'menu');
      dropdown.innerHTML = `
        <a href="#/profile" class="lol-nav__dropdown-item" role="menuitem" data-route="/profile">
          Profile
        </a>
        ${isAdmin() ? `
        <a href="#/admin" class="lol-nav__dropdown-item" role="menuitem" data-route="/admin">
          Manage Projects
        </a>
        <a href="#/admin/users" class="lol-nav__dropdown-item" role="menuitem" data-route="/admin/users">
          Manage Users
        </a>` : ''}
        <hr class="lol-nav__dropdown-divider"/>
        <button class="lol-nav__dropdown-item lol-nav__dropdown-item--danger" role="menuitem" id="nav-signout-btn">
          Sign Out
        </button>
      `;

      const wrapper = document.createElement('div');
      wrapper.className = 'lol-nav__user-wrap';
      wrapper.appendChild(userBtn);
      wrapper.appendChild(dropdown);

      // Toggle dropdown
      userBtn.addEventListener('click', e => {
        e.stopPropagation();
        const open = dropdown.classList.toggle('open');
        userBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      // Close on outside click
      document.addEventListener('click', () => {
        dropdown.classList.remove('open');
        userBtn.setAttribute('aria-expanded', 'false');
      });

      // Sign out
      dropdown.querySelector('#nav-signout-btn').addEventListener('click', async () => {
        await logout();
        window.location.hash = '#/';
      });

      container.appendChild(wrapper);

    } else {
      // Sign In button
      const signIn = document.createElement('button');
      signIn.className = 'lol-nav__cta lol-nav__cta--ghost';
      signIn.textContent = 'Sign In';
      signIn.addEventListener('click', () => this._loginModal.open());

      // Sign Up button
      const signUp = document.createElement('a');
      signUp.className = 'lol-nav__cta lol-nav__cta--ghost';
      signUp.href = '#/signup';
      signUp.dataset.route = '/signup';
      signUp.textContent = 'Sign Up';

      container.appendChild(signIn);
      container.appendChild(signUp);
    }
  }

  _bindHomeLinks(nav) {
    nav.querySelectorAll('[data-route="/"]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        this._closeMenu();
        const onHome = window.location.hash === '#/' || window.location.hash === '';
        if (onHome) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          window.location.hash = '#/';
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
        const id = link.dataset.scroll;
        if (window.location.hash !== '#/' && !window.location.hash.startsWith('#/?')) {
          window.location.hash = '#/';
          setTimeout(() => {
            const target = document.getElementById(id);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
          }, 300);
        } else {
          const target = document.getElementById(id);
          if (target) target.scrollIntoView({ behavior: 'smooth' });
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
      hamburger.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
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
      hamburger.setAttribute('aria-label', 'Open navigation menu');
    }
  }

  setActive(route) {
    document.querySelectorAll('.lol-nav__link[data-route]').forEach(a => {
      a.classList.toggle('active', a.dataset.route === route);
    });
  }
}
