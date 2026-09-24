/**
 * Cookie Consent — orangesmiley.is
 *
 * Shows a consent banner on first visit.
 * Analytics are only loaded after the user explicitly accepts.
 * Consent choice is persisted in localStorage under 'cookie_consent' and, for a
 * signed-in user, on the account too (users.cookie_consent, migration 111;
 * harvested from icelandicstore #411) — see services/cookieConsent.js, which
 * talks to this script through window.__cookieConsent. The banner waits for the
 * SPA's session check ('consent:ready') so a signed-in user who already answered
 * never sees it. Its colours are the theme tokens (invariant 15), so it follows
 * Bjart / Glóð / Miðnætti like the rest of the page.
 *
 * To wire up a real GA4 Measurement ID, set:
 *   window.GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
 * in a script tag before this file loads, then deploy.
 *
 * This is a classic script that runs before the ES-module i18n layer, so it
 * carries its own copy of the handful of strings it needs rather than
 * importing t(). Keep both locales in step with public/js/i18n/*.json.
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'cookie_consent';
  var SUPPORTED_LOCALES = ['en', 'is'];
  // Visitor-facing default for the banner when no signal resolves a locale —
  // the product's identity.locale.publicDefault, read off the same
  // <script id="identity"> hand-off utils/identity.js parses (this is a
  // classic script, so it reads the tag itself). 'is' is the engine default.
  var DEFAULT_LOCALE = 'is';
  try {
    var identityEl = document.getElementById('identity');
    var identity = identityEl ? JSON.parse(identityEl.textContent) : null;
    var publicDefault = identity && identity.locale && identity.locale.publicDefault;
    if (SUPPORTED_LOCALES.indexOf(publicDefault) !== -1) DEFAULT_LOCALE = publicDefault;
  } catch (_e) { /* a malformed tag reads as "no tag" */ }

  var STRINGS = {
    is: {
      aria:    'Samþykki fyrir vafrakökum',
      before:  'Þessi vefur notar vafrakökur fyrir vefmælingar. Sjá ',
      link:    'persónuverndarstefnu',
      after:   '. Samþykkir þú mælingavafrakökur?',
      accept:  'Samþykkja',
      decline: 'Hafna',
      privacyPath: '/personuvernd'
    },
    en: {
      aria:    'Cookie consent',
      before:  'This site uses cookies for analytics. See our ',
      link:    'Privacy Policy',
      after:   '. Do you consent to analytics cookies?',
      accept:  'Accept',
      decline: 'Decline',
      privacyPath: '/personuvernd'
    }
  };

  function strings() {
    return STRINGS[resolveLocale()] || STRINGS.is;
  }

  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  // Resolve current locale without importing the ES-module i18n helper —
  // consent.js is a classic script. Order mirrors i18n.getPreferredLocale():
  // window.__locale (set by loadLocale) → URL path prefix → localStorage.
  function resolveLocale() {
    if (window.__locale && SUPPORTED_LOCALES.indexOf(window.__locale) !== -1) {
      return window.__locale;
    }
    var first = (window.location.pathname || '/').split('/').filter(Boolean)[0];
    if (first && SUPPORTED_LOCALES.indexOf(first) !== -1) return first;
    try {
      var saved = localStorage.getItem('locale_choice');
      if (saved && SUPPORTED_LOCALES.indexOf(saved) !== -1) return saved;
    } catch (_) { /* ignore storage errors */ }
    return DEFAULT_LOCALE;
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) { /* ignore storage errors */ }
  }

  function loadAnalytics() {
    var id = window.GA_MEASUREMENT_ID;
    if (!id || id === 'G-XXXXXXXXXX') {
      // No real Measurement ID configured — skip loading.
      return;
    }

    if (document.getElementById('ga4-script')) return; // already loaded

    var s = document.createElement('script');
    s.id = 'ga4-script';
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', id);
  }

  function removeBanner(banner) {
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  }

  function createBanner() {
    var s = strings();
    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-label', s.aria);
    // Compact card pinned to the bottom-right corner (was a full-width bottom
    // bar). Stacks the message above the Accept/Decline buttons. Shown on every
    // page until the visitor chooses.
    banner.style.cssText = [
      'position:fixed',
      'bottom:1.25rem',
      'right:1.25rem',
      'left:auto',
      'z-index:9999',
      'width:320px',
      'max-width:calc(100vw - 2rem)',
      'box-sizing:border-box',
      'background:var(--bg-elevated)',
      'color:var(--text-primary)',
      'padding:1rem 1.15rem',
      'display:flex',
      'flex-direction:column',
      'align-items:stretch',
      'gap:0.85rem',
      'border:1px solid var(--border)',
      'border-radius:10px',
      'box-shadow:var(--shadow-modal)',
      'font-family:sans-serif',
      'font-size:0.82rem',
      'line-height:1.5'
    ].join(';');

    var text = document.createElement('p');
    text.style.cssText = 'margin:0';
    // Build the privacy link as an element so we can compute the locale-
    // prefixed href at click time and route through the SPA — a static
    // '#/privacy' no longer works since the router moved to clean URLs.
    var privacyLink = document.createElement('a');
    privacyLink.textContent = s.link;
    privacyLink.style.cssText = 'color:var(--text-secondary);text-decoration:underline';
    privacyLink.href = '/' + resolveLocale() + s.privacyPath;
    privacyLink.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var target = '/' + resolveLocale() + strings().privacyPath;
      history.pushState(null, '', target);
      window.dispatchEvent(new Event('spa:navigate'));
    });

    text.appendChild(document.createTextNode(s.before));
    text.appendChild(privacyLink);
    text.appendChild(document.createTextNode(s.after));

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end';

    var acceptBtn = document.createElement('button');
    acceptBtn.textContent = s.accept;
    acceptBtn.style.cssText = [
      'padding:0.4rem 1rem',
      'background:var(--text-primary)',
      'color:var(--bg-base)',
      'border:1px solid var(--text-primary)',
      'border-radius:3px',
      'cursor:pointer',
      'font-size:0.875rem',
      'font-weight:600'
    ].join(';');

    var declineBtn = document.createElement('button');
    declineBtn.textContent = s.decline;
    declineBtn.style.cssText = [
      'padding:0.4rem 1rem',
      'background:transparent',
      'color:var(--text-secondary)',
      'border:1px solid var(--border)',
      'border-radius:3px',
      'cursor:pointer',
      'font-size:0.875rem'
    ].join(';');

    acceptBtn.addEventListener('click', function () { choose('accepted'); });
    declineBtn.addEventListener('click', function () { choose('declined'); });

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    banner.appendChild(text);
    banner.appendChild(actions);
    return banner;
  }

  // A choice made on the banner: stored here, and handed to the SPA (if it has
  // registered onChoice) so a signed-in user's answer lands on the account.
  function choose(value) {
    setConsent(value);
    if (value === 'accepted') loadAnalytics();
    removeBanner(document.getElementById('cookie-consent-banner'));
    var api = window.__cookieConsent;
    if (api && typeof api.onChoice === 'function') {
      try { api.onChoice(value); } catch (_) { /* never break the banner */ }
    }
  }

  function showBanner() {
    if (getConsent() === 'accepted' || getConsent() === 'declined') return;
    if (document.getElementById('cookie-consent-banner')) return;
    if (!document.body) return;
    document.body.appendChild(createBanner());
  }

  // The SPA's handle on this script (services/cookieConsent.js).
  window.__cookieConsent = {
    get: getConsent,
    // The account already holds an answer: adopt it here and drop the banner.
    apply: function (value) {
      if (value !== 'accepted' && value !== 'declined') return;
      setConsent(value);
      if (value === 'accepted') loadAnalytics();
      removeBanner(document.getElementById('cookie-consent-banner'));
    },
    // "Change cookie choice" (the privacy page): ask again.
    reopen: function () {
      removeBanner(document.getElementById('cookie-consent-banner'));
      document.body.appendChild(createBanner());
    },
    onChoice: null,
  };

  function init() {
    if (getConsent() === 'declined') return;

    // Accepted here, or no choice at all: wait for the SPA's session check first
    // (it fires 'consent:ready' after adopting the account's answer). A signed-in
    // user who answered elsewhere is then never shown the banner, and one who
    // DECLINED elsewhere never gets analytics loaded here first. The timer is the
    // backstop for a page where the SPA never boots.
    var done = false;
    function ready() {
      if (done) return;
      done = true;
      var consent = getConsent();
      if (consent === 'accepted') loadAnalytics();
      else if (consent !== 'declined') showBanner();
    }
    window.addEventListener('consent:ready', ready);
    setTimeout(ready, 4000);
  }

  init();
})();
