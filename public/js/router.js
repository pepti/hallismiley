import { motionAllowed } from './utils/motion.js';
import { titleForRoute } from './utils/pageTitle.js';
import { HomeView } from './views/HomeView.js';
import { NotFoundView } from './views/NotFoundView.js';
import { isAuthenticated, isAdmin, canEdit, canSeeView, mfaEnrolmentRequired } from './services/auth.js';
import {
  SUPPORTED_LOCALES,
  loadLocale, getLocale, getPreferredLocale, forcedLocaleFor, t,
} from './i18n/i18n.js';
import { navigate, navigateReplace } from './navigate.js';
import { isDisabledRoute } from './utils/modules.js';
import { trackPageView } from './services/usage.js';
import { shouldReloadOnNavigate, recoverFromAssetFailure } from './services/buildGuard.js';
import { showToast } from './components/Toast.js';

// Views load when their route is first visited, not at boot (icelandicstore
// #426, harvest-ice-e-2026-09-24): the router used to import every view
// statically, so each full page load pulled the whole app's module graph
// before it could start. A module is fetched once and cached by the browser's
// module map; under a release-stamped prefix (server/middleware/versionedStatic.js)
// it is cached across loads too. HomeView and NotFoundView stay eager: the
// router itself builds them as fallbacks. tests/unit/routerLazyViews.test.js
// checks every entry names a file that exports it.
const VIEWS = {
  ProjectsView:             () => import('./views/ProjectsView.js').then((m) => m.ProjectsView),
  ProjectDetailView:        () => import('./views/ProjectDetailView.js').then((m) => m.ProjectDetailView),
  HalliView:                () => import('./views/HalliView.js').then((m) => m.HalliView),
  ContactView:              () => import('./views/ContactView.js').then((m) => m.ContactView),
  ThjonustaView:            () => import('./views/ThjonustaView.js').then((m) => m.ThjonustaView),
  UmOkkurView:              () => import('./views/UmOkkurView.js').then((m) => m.UmOkkurView),
  AdminView:                () => import('./views/AdminView.js').then((m) => m.AdminView),
  AdminProjectsView:        () => import('./views/AdminProjectsView.js').then((m) => m.AdminProjectsView),
  AdminUsersView:           () => import('./views/AdminUsersView.js').then((m) => m.AdminUsersView),
  AdminAnalyticsView:       () => import('./views/AdminAnalyticsView.js').then((m) => m.AdminAnalyticsView),
  AdminGeneralSettingsView: () => import('./views/AdminGeneralSettingsView.js').then((m) => m.AdminGeneralSettingsView),
  AdminUpdatesView:         () => import('./views/AdminUpdatesView.js').then((m) => m.AdminUpdatesView),
  AdminMonitoringView:      () => import('./views/AdminMonitoringView.js').then((m) => m.AdminMonitoringView),
  AdminMcpSettingsView:     () => import('./views/AdminMcpSettingsView.js').then((m) => m.AdminMcpSettingsView),
  AdminDiscountsView:       () => import('./views/AdminDiscountsView.js').then((m) => m.AdminDiscountsView),
  AdminSalesView:           () => import('./views/AdminSalesView.js').then((m) => m.AdminSalesView),
  AdminBackgroundView:      () => import('./views/AdminBackgroundView.js').then((m) => m.AdminBackgroundView),
  AdminChangeRequestsView:  () => import('./views/AdminChangeRequestsView.js').then((m) => m.AdminChangeRequestsView),
  AdminLeadsView:           () => import('./views/AdminLeadsView.js').then((m) => m.AdminLeadsView),
  AdminMarketView:          () => import('./views/AdminMarketView.js').then((m) => m.AdminMarketView),
  AdminAccountsView:        () => import('./views/AdminAccountsView.js').then((m) => m.AdminAccountsView),
  AdminAccountDetailView:   () => import('./views/AdminAccountDetailView.js').then((m) => m.AdminAccountDetailView),
  AdminCommissionView:      () => import('./views/AdminCommissionView.js').then((m) => m.AdminCommissionView),
  SellerAreaView:           () => import('./views/SellerAreaView.js').then((m) => m.SellerAreaView),
  NewsView:                 () => import('./views/NewsView.js').then((m) => m.NewsView),
  ArticleView:              () => import('./views/ArticleView.js').then((m) => m.ArticleView),
  PrivacyView:              () => import('./views/PrivacyView.js').then((m) => m.PrivacyView),
  TermsView:                () => import('./views/TermsView.js').then((m) => m.TermsView),
  SignupView:               () => import('./views/SignupView.js').then((m) => m.SignupView),
  ProfileView:              () => import('./views/ProfileView.js').then((m) => m.ProfileView),
  VerifyEmailView:          () => import('./views/VerifyEmailView.js').then((m) => m.VerifyEmailView),
  ForgotPasswordView:       () => import('./views/ForgotPasswordView.js').then((m) => m.ForgotPasswordView),
  ResetPasswordView:        () => import('./views/ResetPasswordView.js').then((m) => m.ResetPasswordView),
  PartyView:                () => import('./views/PartyView.js').then((m) => m.PartyView),
  PartyAdminView:           () => import('./views/PartyAdminView.js').then((m) => m.PartyAdminView),
  PartyMagicLoginView:      () => import('./views/PartyMagicLoginView.js').then((m) => m.PartyMagicLoginView),
  PartyApproveView:         () => import('./views/PartyApproveView.js').then((m) => m.PartyApproveView),
  ShopView:                 () => import('./views/ShopView.js').then((m) => m.ShopView),
  ProductView:              () => import('./views/ProductView.js').then((m) => m.ProductView),
  CartView:                 () => import('./views/CartView.js').then((m) => m.CartView),
  CheckoutView:             () => import('./views/CheckoutView.js').then((m) => m.CheckoutView),
  CheckoutSuccessView:      () => import('./views/CheckoutSuccessView.js').then((m) => m.CheckoutSuccessView),
  CheckoutCancelView:       () => import('./views/CheckoutCancelView.js').then((m) => m.CheckoutCancelView),
  OrderHistoryView:         () => import('./views/OrderHistoryView.js').then((m) => m.OrderHistoryView),
  AdminProductsView:        () => import('./views/AdminProductsView.js').then((m) => m.AdminProductsView),
  AdminOrdersView:          () => import('./views/AdminOrdersView.js').then((m) => m.AdminOrdersView),
  AdminOrderDetailView:     () => import('./views/AdminOrderDetailView.js').then((m) => m.AdminOrderDetailView),
  AdminCollectionsView:     () => import('./views/AdminCollectionsView.js').then((m) => m.AdminCollectionsView),
  AdminRolesView:           () => import('./views/AdminRolesView.js').then((m) => m.AdminRolesView),
  AdminBinsView:            () => import('./views/AdminBinsView.js').then((m) => m.AdminBinsView),
  AdminBooksView:           () => import('./views/AdminBooksView.js').then((m) => m.AdminBooksView),
  AdminBooksSettingsView:   () => import('./views/AdminBooksSettingsView.js').then((m) => m.AdminBooksSettingsView),
  AdminInvoicesView:        () => import('./views/AdminInvoicesView.js').then((m) => m.AdminInvoicesView),
  AdminInvoiceDetailView:   () => import('./views/AdminInvoiceDetailView.js').then((m) => m.AdminInvoiceDetailView),
  AdminExpensesView:        () => import('./views/AdminExpensesView.js').then((m) => m.AdminExpensesView),
  AdminARView:              () => import('./views/AdminARView.js').then((m) => m.AdminARView),
  AdminStatementView:       () => import('./views/AdminStatementView.js').then((m) => m.AdminStatementView),
  AdminVatView:             () => import('./views/AdminVatView.js').then((m) => m.AdminVatView),
  AdminBankView:            () => import('./views/AdminBankView.js').then((m) => m.AdminBankView),
  AdminLedgerView:          () => import('./views/AdminLedgerView.js').then((m) => m.AdminLedgerView),
  AdminPayrollView:         () => import('./views/AdminPayrollView.js').then((m) => m.AdminPayrollView),
  AdminPosView:             () => import('./views/AdminPosView.js').then((m) => m.AdminPosView),
  AdminCustomersView:       () => import('./views/AdminCustomersView.js').then((m) => m.AdminCustomersView),
  AdminHandbookView:        () => import('./views/AdminHandbookView.js').then((m) => m.AdminHandbookView),
  ConnectClaudeView:        () => import('./views/ConnectClaudeView.js').then((m) => m.ConnectClaudeView),
};

// Instantiate a lazily loaded view. A module that cannot be fetched rejects
// with `assetLoad` set — _navigate() turns that into a reload onto the current
// release. A bug in the view's own constructor is NOT marked: it stays the
// error it is instead of passing for a network problem.
class AssetLoadError extends Error {}
async function make(name, ...args) {
  let View;
  try {
    View = await VIEWS[name]();
  } catch (err) {
    throw Object.assign(new AssetLoadError(`${name}: ${(err && err.message) || err}`), { assetLoad: true, cause: err });
  }
  return new View(...args);
}

// More specific patterns must come before generic ones.
// Every pattern here is ALSO listed in ./routePatterns.json, which the server
// reads to answer 404 for a path no route matches (server/utils/spaRoutes.js).
// Add or remove a route in both places — tests/unit/routePatterns.test.js fails
// when they differ. (Not imported here: a JSON module import needs import
// attributes, which older browsers reject as a syntax error for the whole app.)
// A product's own routes (identity.routes) are known to the server through
// ROUTE_META instead.
const ROUTES = [
  { pattern: '/',                factory: ()  => new HomeView() },
  // ── Business IA (canonical Icelandic slugs). The legacy portfolio routes
  // below stay functional — hidden from nav/SSR/sitemap, never deleted. ──
  { pattern: '/thjonusta',       factory: async ()  => make('ThjonustaView') },
  { pattern: '/verkefni/:id',    factory: async (p) => make('ProjectDetailView', p.id) },
  { pattern: '/verkefni',        factory: async ()  => make('ProjectsView') },
  { pattern: '/um-okkur',        factory: async ()  => make('UmOkkurView') },
  { pattern: '/hafa-samband',    factory: async ()  => make('ContactView') },
  { pattern: '/personuvernd',    factory: async ()  => make('PrivacyView') },
  { pattern: '/projects/:id',    factory: async (p) => make('ProjectDetailView', p.id) },
  { pattern: '/projects',        factory: async ()  => make('ProjectsView') },
  { pattern: '/news/:slug',      factory: async (p) => make('ArticleView', p.slug) },
  { pattern: '/news',            factory: async ()  => make('NewsView') },
  { pattern: '/halli',           factory: async ()  => make('HalliView') },
  { pattern: '/about',           factory: async ()  => make('HalliView') },
  { pattern: '/contact',         factory: async ()  => make('ContactView') },
  { pattern: '/admin/users',     factory: async ()  => (isAuthenticated() && canSeeView('users')) ? make('AdminUsersView') : new HomeView() },
  { pattern: '/admin/analytics', factory: async ()  => (isAuthenticated() && canSeeView('analytics')) ? make('AdminAnalyticsView') : new HomeView() },
  { pattern: '/admin/general',   factory: async ()  => (isAuthenticated() && canSeeView('general')) ? make('AdminGeneralSettingsView') : new HomeView() },
  { pattern: '/admin/updates',   factory: async ()  => (isAuthenticated() && canSeeView('updates')) ? make('AdminUpdatesView') : new HomeView() },
  { pattern: '/admin/monitoring', factory: async () => (isAuthenticated() && isAdmin()) ? make('AdminMonitoringView') : new HomeView() },
  { pattern: '/admin/mcp', factory: async () => (isAuthenticated() && isAdmin()) ? make('AdminMcpSettingsView') : new HomeView() },
  { pattern: '/admin/discounts', factory: async ()  => (isAuthenticated() && canSeeView('discounts')) ? make('AdminDiscountsView') : new HomeView() },
  { pattern: '/admin/sales',     factory: async ()  => (isAuthenticated() && canSeeView('sales')) ? make('AdminSalesView') : new HomeView() },
  { pattern: '/admin/background', factory: async () => (isAuthenticated() && canSeeView('background')) ? make('AdminBackgroundView') : new HomeView() },
  { pattern: '/admin/feedback',  factory: async ()  => (isAuthenticated() && canSeeView('feedback')) ? make('AdminChangeRequestsView') : new HomeView() },
  { pattern: '/admin/bins',      factory: async ()  => (isAuthenticated() && canSeeView('bins')) ? make('AdminBinsView') : new HomeView() },
  { pattern: '/admin/handbok/:slug', factory: async (p) => (isAuthenticated() && canSeeView('handbok')) ? make('AdminHandbookView', p.slug) : new HomeView() },
  { pattern: '/admin/handbok',   factory: async ()  => (isAuthenticated() && canSeeView('handbok')) ? make('AdminHandbookView') : new HomeView() },
  { pattern: '/admin/leads',     factory: async ()  => (isAuthenticated() && canSeeView('leads')) ? make('AdminLeadsView') : new HomeView() },
  { pattern: '/admin/markadur',  factory: async ()  => (isAuthenticated() && canSeeView('markadur')) ? make('AdminMarketView') : new HomeView() },
  // Not a sidebar item: rides the `books` view id rather than adding one (a new id
  // means a new RBAC grant and a parity-test entry for a screen visited four times a year).
  { pattern: '/admin/books/settings', factory: async () => (isAuthenticated() && canSeeView('books')) ? make('AdminBooksSettingsView') : new HomeView() },
  { pattern: '/admin/accounts/:id', factory: async (p) => (isAuthenticated() && canSeeView('accounts')) ? make('AdminAccountDetailView', p.id) : new HomeView() },
  { pattern: '/admin/accounts',  factory: async ()  => (isAuthenticated() && canSeeView('accounts')) ? make('AdminAccountsView') : new HomeView() },
  // Seller area (D-020) — public-instance only; the view itself handles a
  // non-seller (the API answers 404) so no view id is needed here.
  { pattern: '/solusvaedi',      factory: async ()  => isAuthenticated() ? make('SellerAreaView') : new HomeView() },
  { pattern: '/admin/commission', factory: async () => (isAuthenticated() && canSeeView('commission')) ? make('AdminCommissionView') : new HomeView() },
  { pattern: '/admin/books/invoices/:id', factory: async (p) => (isAuthenticated() && canSeeView('invoices')) ? make('AdminInvoiceDetailView', p.id) : new HomeView() },
  { pattern: '/admin/books/invoices', factory: async () => (isAuthenticated() && canSeeView('invoices')) ? make('AdminInvoicesView') : new HomeView() },
  { pattern: '/admin/books/expenses', factory: async () => (isAuthenticated() && canSeeView('expenses')) ? make('AdminExpensesView') : new HomeView() },
  { pattern: '/admin/books/ar/:customerKey', factory: async (p) => (isAuthenticated() && canSeeView('ar')) ? make('AdminStatementView', p.customerKey) : new HomeView() },
  { pattern: '/admin/books/bank', factory: async () => (isAuthenticated() && canSeeView('bank')) ? make('AdminBankView') : new HomeView() },
  { pattern: '/admin/books/ledger', factory: async () => (isAuthenticated() && canSeeView('ledger')) ? make('AdminLedgerView') : new HomeView() },
  { pattern: '/admin/books/payroll', factory: async () => (isAuthenticated() && canSeeView('payroll')) ? make('AdminPayrollView') : new HomeView() },
  { pattern: '/admin/books/pos', factory: async () => (isAuthenticated() && canSeeView('pos')) ? make('AdminPosView') : new HomeView() },
  { pattern: '/admin/books/vat', factory: async () => (isAuthenticated() && canSeeView('vat')) ? make('AdminVatView') : new HomeView() },
  { pattern: '/admin/books/ar', factory: async () => (isAuthenticated() && canSeeView('ar')) ? make('AdminARView') : new HomeView() },
  { pattern: '/admin/books',     factory: async ()  => (isAuthenticated() && canSeeView('books')) ? make('AdminBooksView') : new HomeView() },
  { pattern: '/admin/roles',     factory: async ()  => (isAuthenticated() && isAdmin()) ? make('AdminRolesView') : new HomeView() },
  // The portfolio projects board — unlisted, same gate the old dashboard had.
  { pattern: '/admin/projects',  factory: async ()  => (isAuthenticated() && (canSeeView('dashboard') || canEdit())) ? make('AdminProjectsView') : new HomeView() },
  { pattern: '/admin',           factory: async ()  => isAuthenticated() ? make('AdminView') : new HomeView() },
  // OAuth consent for the MCP connector (R5a): /oauth/authorize lands here.
  // The view handles signed-out and non-admin visitors itself; the server
  // gates the API behind it.
  { pattern: '/tengja/:id',      factory: async (p) => make('ConnectClaudeView', p.id) },
  { pattern: '/signup',          factory: async ()  => make('SignupView') },
  // /login lands on home and opens the login modal — the sign-in door for a
  // product that hides the nav's "Innskrá" (identity.surface.navSignIn), and
  // where /profile and /orders send a signed-out visitor.
  { pattern: '/login',           factory: ()  => { navigateReplace('/' + getLocale() + '/'); setTimeout(() => window.dispatchEvent(new CustomEvent('login:open')), 0); return new HomeView(); } },
  { pattern: '/profile',         factory: async (_, qs) => make('ProfileView', qs) },
  { pattern: '/verify-email',    factory: async (_, qs) => make('VerifyEmailView', qs) },
  { pattern: '/forgot-password', factory: async ()  => make('ForgotPasswordView') },
  { pattern: '/reset-password',  factory: async (_, qs) => make('ResetPasswordView', qs) },
  { pattern: '/privacy',         factory: async ()  => make('PrivacyView') },
  { pattern: '/terms',           factory: async ()  => make('TermsView') },
  { pattern: '/party/admin',     factory: async ()  => (isAuthenticated() && canEdit()) ? make('PartyAdminView') : make('PartyView') },
  { pattern: '/party/login',     factory: async (_, qs) => make('PartyMagicLoginView', qs) },
  { pattern: '/party/approve',   factory: async (_, qs) => make('PartyApproveView', qs) },
  { pattern: '/party',           factory: async ()  => make('PartyView') },
  // Shop + checkout. Section sub-routes (shop-redesign step 2) must precede
  // the generic /shop/:slug pattern so they're not matched as product slugs.
  { pattern: '/shop/products',   factory: async (_, qs) => make('ShopView', { section: 'products' },  qs) },
  { pattern: '/shop/tech',       factory: async (_, qs) => make('ShopView', { section: 'tech' },      qs) },
  { pattern: '/shop/carpentry',  factory: async (_, qs) => make('ShopView', { section: 'carpentry' }, qs) },
  { pattern: '/shop/:slug',      factory: async (p) => make('ProductView', p.slug) },
  { pattern: '/shop',            factory: async (_, qs) => make('ShopView', null, qs) },
  { pattern: '/cart',            factory: async ()  => make('CartView') },
  { pattern: '/checkout/success', factory: async (_, qs) => make('CheckoutSuccessView', qs) },
  { pattern: '/checkout/cancel',  factory: async ()  => make('CheckoutCancelView') },
  { pattern: '/checkout',        factory: async ()  => make('CheckoutView') },
  { pattern: '/orders',          factory: async ()  => isAuthenticated() ? make('OrderHistoryView') : new HomeView() },
  { pattern: '/admin/shop/products', factory: async () => (isAuthenticated() && canSeeView('products')) ? make('AdminProductsView') : new HomeView() },
  { pattern: '/admin/shop/orders',   factory: async () => (isAuthenticated() && canSeeView('orders')) ? make('AdminOrdersView') : new HomeView() },
  { pattern: '/admin/shop/orders/:id', factory: async (p) => (isAuthenticated() && canSeeView('orders')) ? make('AdminOrderDetailView', p.id) : new HomeView() },
  { pattern: '/admin/shop/collections', factory: async () => (isAuthenticated() && canSeeView('collections')) ? make('AdminCollectionsView') : new HomeView() },
  { pattern: '/admin/customers',     factory: async () => (isAuthenticated() && canSeeView('customers')) ? make('AdminCustomersView') : new HomeView() },
];

// ── Path parsing (locale-aware) ───────────────────────────────────────────────

function parsePath(rawPath, rawSearch) {
  // rawPath: '/en/projects' | '/'  —  rawSearch: '?foo=bar' | ''
  const pathAndLocale = rawPath || '/';
  const parts = pathAndLocale.split('/').filter(Boolean);

  let locale = null;
  let path;

  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) {
    locale = parts[0];
    path   = parts.length > 1 ? '/' + parts.slice(1).join('/') : '/';
  } else {
    path = pathAndLocale || '/';
  }

  // Strip leading '?' from search so downstream consumers can split on '&'.
  const qs = (rawSearch || '').replace(/^\?/, '');
  return { path, qs, locale };
}

// Hash routes are legacy. Migrate any '#/...' on first load to a clean URL
// so existing bookmarks + shared links keep working. Runs exactly once per
// pageview (the replaceState doesn't trigger popstate).
function migrateLegacyHash() {
  if (!window.location.hash.startsWith('#/')) return;
  const legacy = window.location.hash.slice(1); // drop leading '#'
  // Preserve any existing ?query on the hash (e.g. #/en/verify-email?token=X)
  history.replaceState(null, '', legacy);
}

function matchRoute(path) {
  // A page of a module this instance does not have (R4, utils/modules.js):
  // not found, like a URL that never existed. The server already answered
  // this path 404 on a cold load; this covers in-SPA navigation.
  if (isDisabledRoute(path)) return { factory: () => new NotFoundView(), params: {}, pattern: null };
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
    // A navigation cut short by the page unloading (a reload, a link to the
    // server) is not a failed view load — never report it as one.
    window.addEventListener('pagehide', () => { this._unloading = true; });
    migrateLegacyHash();
    window.addEventListener('popstate',      this._navigate);
    window.addEventListener('spa:navigate',  this._navigate);
    window.addEventListener('authchange', () => this._navigate());
    // Global click interceptor — rewrite same-origin <a> clicks into
    // pushState navigations so clean URLs behave like a SPA while still
    // letting middle-click / ⌘-click / target="_blank" open new tabs.
    document.addEventListener('click', this._onDocumentClick.bind(this));
    this._navigate();
  }

  _onDocumentClick(e) {
    // Respect modifier keys / non-primary button / default-prevented.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return;
    // Only intercept same-origin absolute paths — leave http(s)://, mailto:, tel: to the browser.
    if (!href.startsWith('/')) return;
    // Leave server endpoints to the browser — they need a full-page navigation.
    if (href.startsWith('/auth/') || href.startsWith('/api/')) return;
    e.preventDefault();
    navigate(href);
  }

  // A view module could not be fetched. Under release-stamped URLs the usual
  // cause is a deploy: this page's /js/_<tag>/ tree answers 404 once the next
  // release serves. The build guard asks the server; a stale page reloads onto
  // the new release. When this page IS the current release it was the network:
  // a failed dynamic import stays failed for the page (the module map memoises
  // it), so reload once (a minute's guard), and only then say so.
  async _viewLoadFailed(err, seq) {
    const outcome = await recoverFromAssetFailure(err);
    if (outcome !== 'current' || seq !== this._navSeq || this._unloading) return;
    const KEY = 'view_reload_at';
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* private mode */ }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
      window.location.reload();
      return;
    }
    showToast(t('errors.pageLoadFailed'), 'error');
  }

  async _navigate() {
    const seq = ++this._navSeq;
    // A deploy happened since this page loaded: reload onto the new release
    // instead of switching views on old code. The URL has already moved, so the
    // reload lands where the user was going. Awaited: after a quiet minute the
    // guard asks the server which release it is before this view renders
    // (services/buildGuard.js; icelandicstore #332/#333).
    if (await shouldReloadOnNavigate()) return;
    // A newer navigation started while the guard was asking — let that one run.
    if (seq !== this._navSeq) return;
    const raw = window.location.pathname || '/';

    // If the path has no locale prefix, redirect to the preferred locale root.
    const { locale: pathLocale } = parsePath(raw, window.location.search);
    if (!pathLocale) {
      const preferred = getPreferredLocale();
      const target = '/' + preferred + (raw === '/' ? '/' : raw);
      navigateReplace(target + window.location.search);
      return;
    }

    // Locale-locked routes (the Icelandic-only party pages) reject any other
    // locale prefix. The server 301s these on a cold load, so this only fires
    // for in-SPA navigation and Back/Forward — but without it, history entries
    // from before the lock (or a hand-edited URL) would render the party page
    // with English chrome.
    const lockedLocale = forcedLocaleFor(raw);
    if (lockedLocale && pathLocale !== lockedLocale) {
      const { path: unprefixed } = parsePath(raw, window.location.search);
      navigateReplace('/' + lockedLocale + unprefixed + window.location.search);
      return;
    }

    // Load locale if it changed (triggers re-render with new strings).
    if (pathLocale !== getLocale()) {
      await loadLocale(pathLocale);
      this.navBar.updateLocale();
    }

    const { path, qs } = parsePath(raw, window.location.search);

    // Show/hide the language switcher for this route (locked routes offer no
    // choice). Runs before render so the control never flashes in and out.
    this.navBar.syncLocaleLock(raw);

    // An admin who still owes two-step set-up holds no admin rights yet (the
    // server withholds the role — auth/mfaPolicy.js), so an /admin URL — a
    // bookmark, a reload — would land on the public fallback with no
    // explanation. Send them to the panel that fixes it instead.
    if ((path === '/admin' || path.startsWith('/admin/')) && mfaEnrolmentRequired()) {
      navigateReplace('/' + getLocale() + '/profile');
      return;
    }
    // Guard admin routes
    if (path === '/admin' && !isAuthenticated()) {
      navigateReplace('/' + getLocale() + '/');
      return;
    }
    // Per-view admin guards (the server enforces these too; this is just the
    // early client-side redirect). Each admin view maps to a role view-id.
    const VIEW_BY_PATH = {
      '/admin/users':      'users',
      '/admin/analytics':  'analytics',
      '/admin/general':    'general',
      '/admin/updates':    'updates',
      '/admin/discounts':  'discounts',
      '/admin/sales':      'sales',
      '/admin/background': 'background',
      '/admin/feedback':   'feedback',
      '/admin/bins':       'bins',
      '/admin/handbok':    'handbok',
      '/admin/leads':      'leads',
      '/admin/markadur':   'markadur',
      '/admin/accounts':   'accounts',
      '/admin/commission': 'commission',
      '/admin/customers':  'customers',
      '/admin/books':      'books',
      '/admin/books/settings': 'books',
      '/admin/books/invoices': 'invoices',
      '/admin/books/expenses': 'expenses',
      '/admin/books/ar':       'ar',
      '/admin/books/vat':      'vat',
      '/admin/books/bank':     'bank',
      '/admin/books/ledger':   'ledger',
      '/admin/books/payroll':  'payroll',
      '/admin/books/pos':      'pos',
    };
    if (VIEW_BY_PATH[path] && (!isAuthenticated() || !canSeeView(VIEW_BY_PATH[path]))) {
      navigateReplace('/' + getLocale() + '/');
      return;
    }
    if (path === '/admin/roles' && (!isAuthenticated() || !isAdmin())) {
      navigateReplace('/' + getLocale() + '/');
      return;
    }
    if (path === '/profile' && !isAuthenticated()) {
      navigateReplace('/' + getLocale() + '/login');
      return;
    }
    if (path === '/orders' && !isAuthenticated()) {
      navigateReplace('/' + getLocale() + '/login');
      return;
    }
    if (path.startsWith('/admin/shop')) {
      const v = path.startsWith('/admin/shop/products')    ? 'products'
              : path.startsWith('/admin/shop/collections') ? 'collections'
              : path.startsWith('/admin/shop/orders')      ? 'orders'
              : null;
      if (!isAuthenticated() || (v && !canSeeView(v))) {
        navigateReplace('/' + getLocale() + '/');
        return;
      }
    }

    const { factory, params, pattern } = matchRoute(path);
    let view;
    try {
      // A lazily loaded view (see VIEWS): its module may still be on the way.
      view = await factory(params, qs);
    } catch (err) {
      if (!err || !err.assetLoad) throw err;   // a view's own bug, not a missing file
      if (seq !== this._navSeq || this._unloading) return;
      await this._viewLoadFailed(err, seq);
      return;
    }
    // A newer navigation started while the module loaded — let that one run,
    // and release whatever this view's constructor set up.
    if (seq !== this._navSeq) {
      if (typeof view.destroy === 'function') view.destroy();
      return;
    }
    const el   = await view.render();

    if (seq !== this._navSeq) {
      if (typeof view.destroy === 'function') view.destroy();
      return;
    }

    // The synchronous swap — wrapped in a View Transition where the browser
    // supports it, so navigating between pages cross-fades between landscapes.
    // Only the swap goes inside the callback: view.render() already ran above
    // (async work inside startViewTransition would hold the page frozen), and
    // the stale-nav guard already passed. The .vt-active class suppresses the
    // legacy .view fadeIn for the duration (main.css) so the two animations
    // don't stack.
    const swap = () => {
      if (this._currentView && typeof this._currentView.destroy === 'function') {
        this._currentView.destroy();
      }
      this._currentView = view;

      this.mountEl.innerHTML = '';
      this.mountEl.appendChild(el);
      this.navBar.setActive(pattern || '/');
    };

    if (document.startViewTransition && motionAllowed()) {
      document.documentElement.classList.add('vt-active');
      const vt = document.startViewTransition(swap);
      vt.finished.finally(() => document.documentElement.classList.remove('vt-active'));
      // Instant scroll during a transition — a smooth scroll mid-crossfade
      // smears the captured frames.
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      swap();
      window.scrollTo({ top: 0, behavior: motionAllowed() ? 'smooth' : 'auto' });
    }

    // Tab title. SSR sets it on a full load; client navigation never did, so
    // the tab kept the landing page's title for the whole session. A view that
    // knows its own subject (an article, an invoice) wins by setting
    // `documentTitle`; everything else is routed by pattern.
    document.title = (typeof view.documentTitle === 'string' && view.documentTitle)
      ? view.documentTitle
      // A disabled module's route titles like any unknown path (R4) — the
      // brand, not the switched-off page's own name.
      : titleForRoute(pattern || (isDisabledRoute(path) ? '' : path), getLocale());

    // Anonymous page-view beacon. Placed after the commit point (past the
    // stale-nav guard and the locale/admin redirects) so it fires exactly once
    // per rendered view — covering pushState, replaceState, popstate, and the
    // initial load (init() calls _navigate once).
    trackPageView();
  }
}
