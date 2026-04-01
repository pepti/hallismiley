import { HomeView }           from './views/HomeView.js';
import { ProjectsView }       from './views/ProjectsView.js';
import { ProjectDetailView }  from './views/ProjectDetailView.js';
import { AboutView }          from './views/AboutView.js';
import { AdminView }          from './views/AdminView.js';
import { AdminUsersView }     from './views/AdminUsersView.js';
import { NotFoundView }       from './views/NotFoundView.js';
import { PrivacyView }        from './views/PrivacyView.js';
import { TermsView }          from './views/TermsView.js';
import { SignupView }         from './views/SignupView.js';
import { ProfileView }        from './views/ProfileView.js';
import { PublicProfileView }  from './views/PublicProfileView.js';
import { VerifyEmailView }    from './views/VerifyEmailView.js';
import { ForgotPasswordView } from './views/ForgotPasswordView.js';
import { ResetPasswordView }  from './views/ResetPasswordView.js';
import { isAuthenticated, isAdmin } from './services/auth.js';

// More specific patterns must come before generic ones
const ROUTES = [
  { pattern: '/',                factory: ()  => new HomeView() },
  { pattern: '/projects/:id',    factory: (p) => new ProjectDetailView(p.id) },
  { pattern: '/projects',        factory: ()  => new ProjectsView() },
  { pattern: '/about',           factory: ()  => new AboutView() },
  { pattern: '/admin/users',     factory: ()  => (isAuthenticated() && isAdmin()) ? new AdminUsersView() : new HomeView() },
  { pattern: '/admin',           factory: ()  => isAuthenticated() ? new AdminView() : new HomeView() },
  { pattern: '/signup',          factory: ()  => new SignupView() },
  { pattern: '/login',           factory: ()  => { /* handled by modal — redirect home */ window.location.hash = '#/'; return new HomeView(); } },
  { pattern: '/profile',         factory: (_, qs) => new ProfileView(qs) },
  { pattern: '/users/:username', factory: (p) => new PublicProfileView(p.username) },
  { pattern: '/verify-email',    factory: (_, qs) => new VerifyEmailView(qs) },
  { pattern: '/forgot-password', factory: ()  => new ForgotPasswordView() },
  { pattern: '/reset-password',  factory: (_, qs) => new ResetPasswordView(qs) },
  { pattern: '/privacy',         factory: ()  => new PrivacyView() },
  { pattern: '/terms',           factory: ()  => new TermsView() },
];

function parseHash(rawHash) {
  // rawHash may include query string: /path?key=val
  const [path, qs = ''] = rawHash.split('?');
  return { path, qs };
}

function matchRoute(path) {
  const pathParts = path.split('/');
  for (const route of ROUTES) {
    const patternParts = route.pattern.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { factory: route.factory, params, pattern: route.pattern };
  }
  return { factory: () => new NotFoundView(), params: {}, pattern: null };
}

export class Router {
  constructor(mountEl, navBar) {
    this.mountEl      = mountEl;
    this.navBar       = navBar;
    this._navigate    = this._navigate.bind(this);
    this._currentView = null;
    this._navSeq      = 0;
  }

  init() {
    window.addEventListener('hashchange', this._navigate);
    window.addEventListener('authchange', () => this._navigate());
    this._navigate();
  }

  async _navigate() {
    const seq  = ++this._navSeq;
    const raw  = window.location.hash.replace('#', '') || '/';
    const { path, qs } = parseHash(raw);

    // Guard admin routes
    if (path === '/admin' && !isAuthenticated()) {
      window.location.hash = '#/';
      return;
    }
    if (path === '/admin/users' && (!isAuthenticated() || !isAdmin())) {
      window.location.hash = '#/';
      return;
    }
    // Guard profile
    if (path === '/profile' && !isAuthenticated()) {
      window.location.hash = '#/login';
      return;
    }

    const { factory, params, pattern } = matchRoute(path);
    const view = factory(params, qs);
    const el   = await view.render();

    // Discard if a newer navigation started while we were awaiting render
    if (seq !== this._navSeq) {
      if (typeof view.destroy === 'function') view.destroy();
      return;
    }

    // Destroy the outgoing view before replacing it
    if (this._currentView && typeof this._currentView.destroy === 'function') {
      this._currentView.destroy();
    }
    this._currentView = view;

    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(el);
    this.navBar.setActive(pattern || '/');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
