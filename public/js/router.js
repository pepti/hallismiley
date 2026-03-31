import { HomeView }          from './views/HomeView.js';
import { ProjectsView }      from './views/ProjectsView.js';
import { ProjectDetailView } from './views/ProjectDetailView.js';
import { AboutView }         from './views/AboutView.js';
import { AdminView }         from './views/AdminView.js';
import { NotFoundView }      from './views/NotFoundView.js';
import { PrivacyView }       from './views/PrivacyView.js';
import { TermsView }         from './views/TermsView.js';
import { isAuthenticated }   from './services/auth.js';

// More specific patterns must come before generic ones
const ROUTES = [
  { pattern: '/',             factory: ()  => new HomeView() },
  { pattern: '/projects/:id', factory: (p) => new ProjectDetailView(p.id) },
  { pattern: '/projects',     factory: ()  => new ProjectsView() },
  { pattern: '/about',        factory: ()  => new AboutView() },
  { pattern: '/admin',        factory: ()  => isAuthenticated() ? new AdminView() : new HomeView() },
  { pattern: '/privacy',      factory: ()  => new PrivacyView() },
  { pattern: '/terms',        factory: ()  => new TermsView() },
];

function matchRoute(hash) {
  const hashParts = hash.split('/');
  for (const route of ROUTES) {
    const patternParts = route.pattern.split('/');
    if (patternParts.length !== hashParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = hashParts[i];
      } else if (patternParts[i] !== hashParts[i]) {
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
    this.mountEl = mountEl;
    this.navBar  = navBar;
    this._navigate = this._navigate.bind(this);
  }

  init() {
    window.addEventListener('hashchange', this._navigate);
    window.addEventListener('authchange', () => this._navigate());
    this._navigate();
  }

  async _navigate() {
    const hash = window.location.hash.replace('#', '') || '/';

    if (hash === '/admin' && !isAuthenticated()) {
      window.location.hash = '#/';
      return;
    }

    const { factory, params, pattern } = matchRoute(hash);
    const view = factory(params);
    const el   = await view.render();

    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(el);
    this.navBar.setActive(pattern || '/');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
