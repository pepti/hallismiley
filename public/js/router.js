import { HomeView }           from './views/HomeView.js';
import { ProjectsView }       from './views/ProjectsView.js';
import { ProjectDetailView }  from './views/ProjectDetailView.js';
import { HalliView }          from './views/HalliView.js';
import { ContactView }        from './views/ContactView.js';
import { AdminView }          from './views/AdminView.js';
import { AdminUsersView }     from './views/AdminUsersView.js';
import { NotFoundView }       from './views/NotFoundView.js';
import { NewsView }           from './views/NewsView.js';
import { ArticleView }        from './views/ArticleView.js';
import { PrivacyView }        from './views/PrivacyView.js';
import { TermsView }          from './views/TermsView.js';
import { SignupView }         from './views/SignupView.js';
import { ProfileView }        from './views/ProfileView.js';
import { VerifyEmailView }    from './views/VerifyEmailView.js';
import { ForgotPasswordView } from './views/ForgotPasswordView.js';
import { ResetPasswordView }  from './views/ResetPasswordView.js';
import { isAuthenticated, isAdmin, canEdit } from './services/auth.js';
import { PartyView }      from './views/PartyView.js';
import { PartyAdminView } from './views/PartyAdminView.js';
import { ShopView }              from './views/ShopView.js';
import { ProductView }           from './views/ProductView.js';
import { CartView }              from './views/CartView.js';
import { CheckoutView }          from './views/CheckoutView.js';
import { CheckoutSuccessView }   from './views/CheckoutSuccessView.js';
import { CheckoutCancelView }    from './views/CheckoutCancelView.js';
import { OrderHistoryView }      from './views/OrderHistoryView.js';
import { AdminProductsView }     from './views/AdminProductsView.js';
import { AdminOrdersView }       from './views/AdminOrdersView.js';
import {
  SUPPORTED_LOCALES, DEFAULT_LOCALE,
  loadLocale, getLocale, getPreferredLocale,
} from './i18n/i18n.js';

// More specific patterns must come before generic ones
const ROUTES = [
  { pattern: '/',                factory: ()  => new HomeView() },
  { pattern: '/projects/:id',    factory: (p) => new ProjectDetailView(p.id) },
  { pattern: '/projects',        factory: ()  => new ProjectsView() },
  { pattern: '/news/:slug',      factory: (p) => new ArticleView(p.slug) },
  { pattern: '/news',            factory: ()  => new NewsView() },
  { pattern: '/halli',           factory: ()  => new HalliView() },
  { pattern: '/about',           factory: ()  => new HalliView() },
  { pattern: '/contact',         factory: ()  => new ContactView() },
  { pattern: '/admin/users',     factory: ()  => (isAuthenticated() && isAdmin()) ? new AdminUsersView() : new HomeView() },
  { pattern: '/admin',           factory: ()  => isAuthenticated() ? new AdminView() : new HomeView() },
  { pattern: '/signup',          factory: ()  => new SignupView() },
  { pattern: '/login',           factory: ()  => { window.location.hash = '#/' + getLocale() + '/'; return new HomeView(); } },
  { pattern: '/profile',         factory: (_, qs) => new ProfileView(qs) },
  { pattern: '/verify-email',    factory: (_, qs) => new VerifyEmailView(qs) },
  { pattern: '/forgot-password', factory: ()  => new ForgotPasswordView() },
  { pattern: '/reset-password',  factory: (_, qs) => new ResetPasswordView(qs) },
  { pattern: '/privacy',         factory: ()  => new PrivacyView() },
  { pattern: '/terms',           factory: ()  => new TermsView() },
  { pattern: '/party/admin',     factory: ()  => (isAuthenticated() && canEdit()) ? new PartyAdminView() : new PartyView() },
  { pattern: '/party',           factory: ()  => new PartyView() },
  // Shop + checkout
  { pattern: '/shop/:slug',      factory: (p) => new ProductView(p.slug) },
  { pattern: '/shop',            factory: (_, qs) => new ShopView(null, qs) },
  { pattern: '/cart',            factory: ()  => new CartView() },
  { pattern: '/checkout/success', factory: (_, qs) => new CheckoutSuccessView(qs) },
  { pattern: '/checkout/cancel',  factory: ()  => new CheckoutCancelView() },
  { pattern: '/checkout',        factory: ()  => new CheckoutView() },
  { pattern: '/orders',          factory: ()  => isAuthenticated() ? new OrderHistoryView() : new HomeView() },
  { pattern: '/admin/shop/products', factory: () => (isAuthenticated() && isAdmin()) ? new AdminProductsView() : new HomeView() },
  { pattern: '/admin/shop/orders',   factory: () => (isAuthenticated() && isAdmin()) ? new AdminOrdersView() : new HomeView() },
];

// ── Hash parsing (locale-aware) ───────────────────────────────────────────────

function parseHash(rawHash) {
  const [pathAndLocale, qs = ''] = rawHash.split('?');
  const parts = pathAndLocale.split('/').filter(Boolean);

  let locale = null;
  let path;

  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) {
    locale = parts[0];
    path   = parts.length > 1 ? '/' + parts.slice(1).join('/') : '/';
  } else {
    path = pathAndLocale || '/';
  }

  return { path, qs, locale };
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

// ── Router ────────────────────────────────────────────────────────────────────

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
    const seq = ++this._navSeq;
    const raw = window.location.hash.replace('#', '') || '/';

    // If the hash has no locale prefix, redirect to the preferred locale root.
    const { locale: hashLocale } = parseHash(raw);
    if (!hashLocale) {
      const preferred = getPreferredLocale();
      const target = '/' + preferred + (raw === '/' ? '/' : (raw.startsWith('/') ? raw : '/' + raw));
      window.location.hash = '#' + target;
      return;
    }

    // Load locale if it changed (triggers re-render with new strings).
    if (hashLocale !== getLocale()) {
      await loadLocale(hashLocale);
      this.navBar.updateLocale();
    }

    const { path, qs } = parseHash(raw);

    // Guard admin routes
    if (path === '/admin' && !isAuthenticated()) {
      window.location.hash = '#/' + getLocale() + '/';
      return;
    }
    if (path === '/admin/users' && (!isAuthenticated() || !isAdmin())) {
      window.location.hash = '#/' + getLocale() + '/';
      return;
    }
    if (path === '/profile' && !isAuthenticated()) {
      window.location.hash = '#/' + getLocale() + '/login';
      return;
    }
    if (path === '/orders' && !isAuthenticated()) {
      window.location.hash = '#/' + getLocale() + '/login';
      return;
    }
    if (path.startsWith('/admin/shop') && (!isAuthenticated() || !isAdmin())) {
      window.location.hash = '#/' + getLocale() + '/';
      return;
    }

    const { factory, params, pattern } = matchRoute(path);
    const view = factory(params, qs);
    const el   = await view.render();

    if (seq !== this._navSeq) {
      if (typeof view.destroy === 'function') view.destroy();
      return;
    }

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
