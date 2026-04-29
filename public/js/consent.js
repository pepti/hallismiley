/**
 * Cookie Consent — hallismiley.is
 *
 * Shows a consent banner on first visit.
 * Analytics are only loaded after the user explicitly accepts.
 * Consent choice is persisted in localStorage under 'cookie_consent'.
 *
 * To wire up a real GA4 Measurement ID, set:
 *   window.GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
 * in a script tag before this file loads, then deploy.
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'cookie_consent';
  var SUPPORTED_LOCALES = ['en', 'is'];
  var DEFAULT_LOCALE = 'en';

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
      var saved = localStorage.getItem('preferred_locale');
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
    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.style.cssText = [
      'position:fixed',
      'bottom:0',
      'left:0',
      'right:0',
      'z-index:9999',
      'background:#1a1a1a',
      'color:#e8e8e0',
      'padding:1rem 1.5rem',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:1rem',
      'flex-wrap:wrap',
      'border-top:1px solid #333',
      'font-family:sans-serif',
      'font-size:0.875rem',
      'line-height:1.5'
    ].join(';');

    var text = document.createElement('p');
    text.style.cssText = 'margin:0;flex:1 1 300px';
    // Build the privacy link as an element so we can compute the locale-
    // prefixed href at click time and route through the SPA — a static
    // '#/privacy' no longer works since the router moved to clean URLs.
    var privacyLink = document.createElement('a');
    privacyLink.textContent = 'Privacy Policy';
    privacyLink.style.cssText = 'color:#a0a090;text-decoration:underline';
    privacyLink.href = '/' + resolveLocale() + '/privacy';
    privacyLink.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var target = '/' + resolveLocale() + '/privacy';
      history.pushState(null, '', target);
      window.dispatchEvent(new Event('spa:navigate'));
    });

    text.appendChild(document.createTextNode('This site uses cookies for analytics. See our '));
    text.appendChild(privacyLink);
    text.appendChild(document.createTextNode('. Do you consent to analytics cookies?'));

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:0.5rem;flex-shrink:0';

    var acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.style.cssText = [
      'padding:0.4rem 1rem',
      'background:#c8b882',
      'color:#111',
      'border:none',
      'border-radius:3px',
      'cursor:pointer',
      'font-size:0.875rem',
      'font-weight:600'
    ].join(';');

    var declineBtn = document.createElement('button');
    declineBtn.textContent = 'Decline';
    declineBtn.style.cssText = [
      'padding:0.4rem 1rem',
      'background:transparent',
      'color:#a0a090',
      'border:1px solid #555',
      'border-radius:3px',
      'cursor:pointer',
      'font-size:0.875rem'
    ].join(';');

    acceptBtn.addEventListener('click', function () {
      setConsent('accepted');
      loadAnalytics();
      removeBanner(banner);
    });

    declineBtn.addEventListener('click', function () {
      setConsent('declined');
      removeBanner(banner);
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    banner.appendChild(text);
    banner.appendChild(actions);
    return banner;
  }

  function init() {
    var consent = getConsent();

    if (consent === 'accepted') {
      loadAnalytics();
      return;
    }

    if (consent === 'declined') {
      return;
    }

    // No stored choice — show banner once the DOM is ready.
    function showBanner() {
      document.body.appendChild(createBanner());
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }

  init();
})();
