// ContactView — dedicated /contact page
// Sections: Hero → Contact card → Inquiry form → Availability → Built with → Footer
//
// All six sections are editable by admin/moderator via a single page-level
// Edit button. Content lives in `site_content` JSONB rows keyed by:
//   contact_hero, contact_card, contact_form, contact_availability,
//   contact_built_with, contact_footer
// When a row is absent, the matching DEFAULT_* constant is rendered.

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { SceneStage } from '../scenes/SceneStage.js';
import { t, getLocale, href, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';

// Pick the locale-resolved slice of a `{ en, is }` default blob. Falls back
// to English if an unknown locale is active or the .is key is missing.
function pick(defaultsBlob) {
  return (defaultsBlob && (defaultsBlob[getLocale()] || defaultsBlob.en)) || {};
}

// ── Defaults ────────────────────────────────────────────────────────────────

// Each DEFAULT_* is shaped as { en, is } so the view falls back to
// locale-appropriate copy when no admin-edited site_content row exists.
// Resolve at _loadAllContent() time via s.defaults[getLocale()] || s.defaults.en.
// DRAFT (2026-09-01): company voice — "we", not "I". This is Orange Smiley's
// lead form, and the SSR description already promises a reply within one
// business day, so the page says the same thing.
const DEFAULT_HERO = {
  en: {
    eyebrow:     'Get in touch',
    title_line1: 'Tell us about your operation',
    title_accent: '— we take care of the systems.',
    subtitle:
      'Moving off Shopify, Wix or WordPress, starting something new, or just ' +
      'weighing it up — we read every message and reply within one business day.',
  },
  is: {
    eyebrow:     'Hafa samband',
    title_line1: 'Segðu okkur frá rekstrinum',
    title_accent: '— við sjáum um kerfin.',
    subtitle:
      'Á leið af Shopify, Wix eða WordPress, að byrja á einhverju nýju eða bara ' +
      'að skoða málin — við lesum öll skilaboð og svörum innan eins virks dags.',
  },
};

// Icons for card items are keyed by `type` and merged at render time — not editable.
const CARD_ICONS = {
  email: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <polyline points="2,4 12,13 22,4"/>
          </svg>`,
  github: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
             <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
           </svg>`,
  linkedin: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
               <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
             </svg>`,
  location: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
               <path d="M12 2a10 10 0 1 0 10 10"/>
               <circle cx="12" cy="12" r="3"/>
             </svg>`,
};

// The company's contact details, not the founder's. The personal GitHub and
// LinkedIn rows went with the portfolio — a prospect writing to a software
// company wants the company's inbox. (CARD_ICONS keeps its github/linkedin
// entries: the rows are admin-editable, so an instance may add them back.)
const DEFAULT_CARD = {
  en: {
    items: [
      { type: 'email',    label: 'Email',    value: 'info [at] orangesmiley [dot] is', href: 'info@orangesmiley.is' },
      { type: 'location', label: 'Based in', value: 'Hafnarfjörður · GMT',             meta:  'Reply within one business day' },
    ],
  },
  is: {
    items: [
      { type: 'email',    label: 'Netfang',     value: 'info [at] orangesmiley [dot] is', href: 'info@orangesmiley.is' },
      { type: 'location', label: 'Staðsetning', value: 'Hafnarfjörður · GMT',             meta:  'Svar innan eins virks dags' },
    ],
  },
};

const DEFAULT_FORM = {
  en: {
    eyebrow:         'Send a message',
    title:           'Tell us what you need',
    submit_label:    'Send Message',
    fallback_prefix: 'Prefer email?',
    fallback_link:   'Write to us directly.',
  },
  is: {
    eyebrow:         'Sendu skilaboð',
    title:           'Segðu okkur hvað þig vantar',
    submit_label:    'Senda skilaboð',
    fallback_prefix: 'Frekar netfang?',
    fallback_link:   'Sendu okkur tölvupóst beint.',
  },
};

// DRAFT (2026-09-01): what the company takes on, replacing the freelancer's
// availability list (carpentry commissions and speaking gigs).
const DEFAULT_AVAILABILITY = {
  en: {
    eyebrow: 'Right now',
    title: 'What we take on',
    cards: [
      { status: 'open',    label: 'Moving off Shopify, Wix or WordPress', body: 'We migrate the store, the products and the customers onto Rekstrarkerfið, and keep it running afterwards.' },
      { status: 'open',    label: 'A new site or online store',           body: 'From a company site to a full store with inventory and invoicing — one system, one monthly invoice.' },
      { status: 'limited', label: 'Custom systems & partnerships',        body: 'Work that does not fit a subscription. We take it on when it fits what we are building.' },
    ],
  },
  is: {
    eyebrow: 'Núna',
    title: 'Hvað við tökum að okkur',
    cards: [
      { status: 'open',    label: 'Flutningur af Shopify, Wix eða WordPress', body: 'Við flytjum verslunina, vörurnar og viðskiptavinina yfir á Rekstrarkerfið og rekum það áfram.' },
      { status: 'open',    label: 'Nýr vefur eða vefverslun',                 body: 'Allt frá fyrirtækjavef upp í verslun með lager og reikningagerð — eitt kerfi, einn mánaðarreikningur.' },
      { status: 'limited', label: 'Sérlausnir og samstarf',                   body: 'Verkefni sem passa ekki í áskrift. Við tökum þau að okkur þegar þau falla að því sem við erum að byggja.' },
    ],
  },
};

// DRAFT (2026-09-01): the same stack list, but it is evidence now rather than
// an offer to fork. The page used to invite visitors to clone the portfolio
// and link the founder's personal GitHub; a prospect reading a software
// company's contact page wants to know the thing is soberly built.
const DEFAULT_BUILT_WITH = {
  en: {
    eyebrow: 'Under the hood',
    title:   'How Rekstrarkerfið is built',
    body1:
      'This site runs on the same platform our customers do: Node.js and Express with a ' +
      'PostgreSQL database and a vanilla-JS single-page frontend — no framework, no build step. ' +
      'Auth uses Lucia with CSRF and Helmet hardening, email goes through Resend, uploads ' +
      'through Multer, observability through Pino and Sentry, deployed on Azure App Service.',
    body2:
      'One shared core carries every customer, and per-customer features ship as flagged ' +
      'modules on top of it rather than forks — which is what lets AI agents build and ' +
      'maintain the custom work, and what keeps every instance patchable on the same day.',
    pills: [
      'Node.js', 'Express', 'PostgreSQL', 'Lucia Auth',
      'Helmet', 'CSRF', 'Resend', 'Multer',
      'Pino', 'Sentry', 'Vanilla JS SPA', 'Azure',
    ],
    email_btn_label:  'Ask us about the platform',
  },
  is: {
    eyebrow: 'Undir húddinu',
    title:   'Hvernig Rekstrarkerfið er byggt',
    body1:
      'Þessi vefur keyrir á sama kerfi og viðskiptavinir okkar: Node.js og Express með ' +
      'PostgreSQL gagnagrunni og hreinum JavaScript framenda sem eitt-síðu vefforrit — enginn ' +
      'rammi, ekkert byggingarskref. Auðkenning notar Lucia með CSRF og Helmet hertingu, ' +
      'tölvupóstur fer gegnum Resend, skráarupphleðsla gegnum Multer, vöktun gegnum Pino og ' +
      'Sentry, allt keyrt á Azure App Service.',
    body2:
      'Einn sameiginlegur kjarni ber alla viðskiptavini og sérlausnir bætast ofan á hann sem ' +
      'einingar með rofa — ekki afrit af kerfinu. Þess vegna getur gervigreindin smíðað og ' +
      'viðhaldið sérsmíðinni, og þess vegna má uppfæra öll kerfin sama daginn.',
    pills: [
      'Node.js', 'Express', 'PostgreSQL', 'Lucia Auth',
      'Helmet', 'CSRF', 'Resend', 'Multer',
      'Pino', 'Sentry', 'Vanilla JS SPA', 'Azure',
    ],
    email_btn_label:  'Spurðu okkur um kerfið',
  },
};

// The page's own footer. It still signed off as "Halli Smiley — a portfolio of
// nothing and everything" and pointed its legal links at /privacy, the hidden
// alias, rather than the canonical /personuvernd the rest of the site uses.
const DEFAULT_FOOTER = {
  en: {
    brand_name:  'Orange Smiley',
    copy_suffix: 'An Icelandic software house driven by AI.',
    legal_links: [
      { label: 'Privacy Policy',   href: '/personuvernd' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
  is: {
    brand_name:  'Orange Smiley',
    copy_suffix: 'Íslenskt hugbúnaðarhús knúið gervigreind.',
    legal_links: [
      { label: 'Persónuverndarstefna', href: '/personuvernd' },
      { label: 'Notkunarskilmálar',    href: '/terms' },
    ],
  },
};

// Values stay the same in both locales (they're server-side enum keys) — only
// the human-readable labels switch. Resolved at render time via
// PLATFORMS[getLocale()] || PLATFORMS.en.
// The system a prospect is moving off — the single most useful qualifying
// answer, so it replaces the portfolio-era "topic" selector. Values must
// match KNOWN_PLATFORMS in server/controllers/contactController.js; anything
// unrecognised is recorded as 'other' rather than rejected.
const PLATFORMS = {
  en: [
    { value: '',            label: 'What are you using today?' },
    { value: 'shopify',     label: 'Shopify' },
    { value: 'wix',         label: 'Wix' },
    { value: 'wordpress',   label: 'WordPress' },
    { value: 'woocommerce', label: 'WooCommerce' },
    { value: 'squarespace', label: 'Squarespace' },
    { value: 'dk',          label: 'DK / Regla / Payday (accounting only)' },
    { value: 'none',        label: 'Nothing yet' },
    { value: 'other',       label: 'Something else' },
  ],
  is: [
    { value: '',            label: 'Hvað notar þú í dag?' },
    { value: 'shopify',     label: 'Shopify' },
    { value: 'wix',         label: 'Wix' },
    { value: 'wordpress',   label: 'WordPress' },
    { value: 'woocommerce', label: 'WooCommerce' },
    { value: 'squarespace', label: 'Squarespace' },
    { value: 'dk',          label: 'DK / Regla / Payday (bara bókhald)' },
    { value: 'none',        label: 'Ekkert ennþá' },
    { value: 'other',       label: 'Eitthvað annað' },
  ],
};

// Each editable section's config: state field on `this`, default, and DB key.
const SECTIONS = [
  { key: 'contact_hero',        field: '_hero',       defaults: DEFAULT_HERO },
  { key: 'contact_card',        field: '_card',       defaults: DEFAULT_CARD },
  { key: 'contact_form',        field: '_form',       defaults: DEFAULT_FORM },
  { key: 'contact_availability',field: '_availability', defaults: DEFAULT_AVAILABILITY },
  { key: 'contact_built_with',  field: '_builtWith',  defaults: DEFAULT_BUILT_WITH },
  { key: 'contact_footer',      field: '_footer',     defaults: DEFAULT_FOOTER },
];

export class ContactView {
  constructor() {
    this._hero         = null;
    this._card         = null;
    this._form         = null;
    this._availability = null;
    this._builtWith    = null;
    this._footer       = null;
    // Whether this user can see inline-edit-only DOM (mailto/href helper rows).
    // Captured at render time so anonymous viewers never see the raw email
    // in the static HTML — obfuscation is preserved for non-editors.
    this._canEdit      = false;
  }

  async render() {
    this._canEdit = isAdmin() || hasRole('moderator');
    await this._loadAllContent();

    const view = document.createElement('div');
    view.className = 'view contact-view';

    view.innerHTML = `
      ${this._heroHtml()}
      ${this._cardHtml()}
      ${this._formHtml()}
      ${this._availabilityHtml()}
      ${this._builtWithHtml()}
      ${this._footerHtml()}
    `;

    // Reynisfjara behind the hero — mounted INSIDE the existing decoration
    // node so the admin-editable data-section/data-field tree is untouched.
    const heroBg = view.querySelector('.contact-hero__bg');
    if (heroBg) {
      this._scene = new SceneStage('hafaSamband', { variant: 'hero' });
      heroBg.appendChild(this._scene.el());
      this._scene.mount();
      heroBg.closest('.contact-hero')?.classList.add('contact-hero--scene');
    }

    this._initEmailLinks(view);
    this._initForm(view);
    this._initBuiltWithButtons(view);
    this._initPageEdit(view);
    return view;
  }

  destroy() {
    this._scene?.destroy();
  }

  // ── Load all site_content rows in parallel; fall back to defaults on 404 ──
  async _loadAllContent() {
    await Promise.all(SECTIONS.map(async s => {
      // Resolve the locale-appropriate slice of the {en, is} defaults blob
      // once per section load. Any DB row then merges on top.
      const defaults = pick(s.defaults);
      try {
        const res = await fetch(`/api/v1/content/${s.key}?locale=${encodeURIComponent(window.__locale || 'en')}`);
        if (res.ok) {
          const data = await res.json();
          this[s.field] = this._mergeWithDefaults(defaults, data);
          return;
        }
      } catch { /* fall through */ }
      this[s.field] = JSON.parse(JSON.stringify(defaults));
    }));
  }

  // Deep merge so a partially-populated DB row still renders missing bits.
  _mergeWithDefaults(defaults, data) {
    const out = JSON.parse(JSON.stringify(defaults));
    if (!data || typeof data !== 'object') return out;
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length) out[k] = v;
      else if (v !== null && v !== undefined) out[k] = v;
    }
    return out;
  }

  // ── SECTION 1: Hero ────────────────────────────────────────────────────
  _heroHtml() {
    const h = this._hero;
    return `
    <section class="contact-hero" aria-label="Contact hero" data-section="hero">
      <div class="contact-hero__bg" aria-hidden="true"></div>
      <div class="contact-hero__inner">
        <p class="contact-hero__eyebrow" data-field="eyebrow">${escHtml(h.eyebrow)}</p>
        <h1 class="contact-hero__title">
          <span data-field="title_line1">${escHtml(h.title_line1)}</span><br>
          <span class="contact-hero__title-accent" data-field="title_accent">${escHtml(h.title_accent)}</span>
        </h1>
        <p class="contact-hero__subtitle" data-field="subtitle">${escHtml(h.subtitle)}</p>
      </div>
    </section>`;
  }

  // ── SECTION 2: Contact card ────────────────────────────────────────────
  _cardHtml() {
    const items = this._card.items.map((item, i) => this._cardItemHtml(item, i)).join('');
    return `
    <section class="contact-card-section" aria-label="Contact details" data-section="card">
      <div class="contact-card-section__inner">
        <div class="contact-card">
          ${items}
        </div>
      </div>
    </section>`;
  }

  _cardItemHtml(item, i) {
    const icon = CARD_ICONS[item.type] || '';
    const isLocation = item.type === 'location';
    const isEmail    = item.type === 'email';

    // Email: href filled lazily on interaction (obfuscation). Others: static href.
    const hrefAttr = isLocation ? ''
      : isEmail   ? `href="#" id="contact-email-link" aria-label="Send me an email"`
                  : `href="${escHtml(item.href || '#')}" target="_blank" rel="noopener noreferrer"`;

    const classes = isLocation
      ? 'contact-card__item contact-card__item--static'
      : 'contact-card__item';

    const tag = isLocation ? 'div' : 'a';

    const valueId = isEmail ? 'id="contact-email-text"' : '';
    const meta = isLocation && item.meta
      ? `<div class="contact-card__meta" data-field="meta">${escHtml(item.meta)}</div>`
      : '';

    // Edit-mode helper row: shows href (or mailto address for email) as an
    // editable line. Only rendered for editors so anonymous viewers don't
    // receive the raw email/URL in the static DOM.
    const hrefRow = (this._canEdit && !isLocation) ? `
      <div class="contact-card__href-row contact-view__edit-only">
        <span class="contact-card__href-label">${isEmail ? 'Mailto:' : 'Link:'}</span>
        <span class="contact-card__href-value" data-field="href">${escHtml(item.href || '')}</span>
      </div>` : '';

    return `
      <${tag} class="${classes}" ${hrefAttr} data-item-index="${i}" data-type="${escHtml(item.type)}">
        <div class="contact-card__icon" aria-hidden="true">${icon}</div>
        <div class="contact-card__body">
          <div class="contact-card__label" data-field="label">${escHtml(item.label)}</div>
          <div class="contact-card__value" ${valueId} data-field="value">${escHtml(item.value)}</div>
          ${meta}
          ${hrefRow}
        </div>
      </${tag}>`;
  }

  // ── SECTION 3: Inquiry form ────────────────────────────────────────────
  _formHtml() {
    const f = this._form;
    const platformOptions = (PLATFORMS[getLocale()] || PLATFORMS.en).map(p =>
      `<option value="${escHtml(p.value)}">${escHtml(p.label)}</option>`
    ).join('');

    return `
    <section class="contact-form-section" id="contact-form-section"
             aria-label="${t('contact.formAriaLabel')}" data-section="form">
      <div class="contact-form-section__inner">
        <p class="contact-form-section__eyebrow" data-field="eyebrow">${escHtml(f.eyebrow)}</p>
        <h2 class="contact-form-section__title" data-field="title">${escHtml(f.title)}</h2>

        <form class="contact-form contact-form--page" id="contact-page-form" novalidate
              aria-label="${t('contact.formAriaLabel')}">
          <!-- Honeypot — hidden from real users, bots fill it in -->
          <input type="text" name="website" id="contact-page-honeypot"
                 tabindex="-1" autocomplete="off" aria-hidden="true"
                 style="position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;" />

          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-page-name" class="contact-form__label">
                ${t('contact.name')} <span aria-hidden="true" class="required-mark">*</span>
              </label>
              <input type="text" id="contact-page-name" name="name" class="contact-form__input"
                     required autocomplete="name" placeholder="${t('contact.namePlaceholder')}" maxlength="100" />
            </div>
            <div class="contact-form__field">
              <label for="contact-page-company" class="contact-form__label">${t('contact.company')}</label>
              <input type="text" id="contact-page-company" name="company" class="contact-form__input"
                     autocomplete="organization" placeholder="${t('contact.companyPlaceholder')}" maxlength="150" />
            </div>
          </div>

          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-page-email" class="contact-form__label">
                ${t('contact.email')} <span aria-hidden="true" class="required-mark">*</span>
              </label>
              <input type="email" id="contact-page-email" name="email" class="contact-form__input"
                     required autocomplete="email" placeholder="${t('contact.emailPlaceholder')}" maxlength="200" />
            </div>
            <div class="contact-form__field">
              <label for="contact-page-phone" class="contact-form__label">${t('contact.phone')}</label>
              <input type="tel" id="contact-page-phone" name="phone" class="contact-form__input"
                     autocomplete="tel" placeholder="${t('contact.phonePlaceholder')}" maxlength="40" />
            </div>
          </div>

          <div class="contact-form__field">
            <label for="contact-page-platform" class="contact-form__label">${t('contact.currentPlatform')}</label>
            <select id="contact-page-platform" name="current_platform" class="contact-form__input contact-form__select">
              ${platformOptions}
            </select>
          </div>

          <div class="contact-form__field">
            <label for="contact-page-message" class="contact-form__label">
              ${t('contact.message')} <span aria-hidden="true" class="required-mark">*</span>
            </label>
            <textarea id="contact-page-message" name="message" class="contact-form__textarea"
                      required rows="6" placeholder="${t('contact.messagePlaceholder')}" maxlength="2000"></textarea>
          </div>

          <div aria-live="polite" id="contact-page-status" class="contact-form__status"></div>

          <button type="submit" class="lol-contact__btn contact-form__submit" id="contact-page-submit">
            <span data-field="submit_label">${escHtml(f.submit_label)}</span>
          </button>

          <p class="contact-form__fallback">
            <span data-field="fallback_prefix">${escHtml(f.fallback_prefix)}</span>
            <a id="contact-mailto-link" href="#" data-field="fallback_link">${escHtml(f.fallback_link)}</a>
          </p>
        </form>
      </div>
    </section>`;
  }

  // ── SECTION 4: Availability ────────────────────────────────────────────
  _availabilityHtml() {
    const c = this._availability;
    const cards = c.cards.map((card, i) => {
      const status = (card.status || 'open').toLowerCase();
      const statusLabel = status === 'open' ? 'Open' : status === 'limited' ? 'Limited' : 'Closed';
      return `
        <div class="availability-card availability-card--${escHtml(status)}" data-card-index="${i}" role="listitem">
          <div class="availability-card__status">
            <span class="availability-card__dot" aria-hidden="true"></span>
            <span class="availability-card__status-text" data-field="status">${escHtml(statusLabel)}</span>
          </div>
          <h3 class="availability-card__label" data-field="label">${escHtml(card.label)}</h3>
          <p class="availability-card__body" data-field="body">${escHtml(card.body)}</p>
        </div>`;
    }).join('');

    return `
    <section class="availability" aria-label="Current availability" data-section="availability">
      <div class="availability__inner">
        <p class="availability__eyebrow" data-field="eyebrow">${escHtml(c.eyebrow)}</p>
        <h2 class="availability__title" data-field="title">${escHtml(c.title)}</h2>
        <div class="availability__grid" role="list">
          ${cards}
        </div>
      </div>
    </section>`;
  }

  // ── SECTION 5: Built with ──────────────────────────────────────────────
  _builtWithHtml() {
    const b = this._builtWith;
    const pills = b.pills.map((t, i) =>
      `<span class="built-with__pill" data-pill-index="${i}" data-field="pill">${escHtml(t)}</span>`
    ).join('');

    return `
    <section class="built-with" aria-label="How this site is built" data-section="built_with">
      <div class="built-with__inner">
        <p class="built-with__eyebrow" data-field="eyebrow">${escHtml(b.eyebrow)}</p>
        <h2 class="built-with__title" data-field="title">${escHtml(b.title)}</h2>
        <p class="built-with__body" data-field="body1">${escHtml(b.body1)}</p>
        <p class="built-with__body" data-field="body2">${escHtml(b.body2)}</p>

        <div class="built-with__stack" role="list" aria-label="Technology stack">
          ${pills}
        </div>

        <!-- The "View on GitHub" button went with the clone-this-portfolio
             framing: it pointed at the founder's personal repository, which
             is not what this section is evidence of any more. -->
        <div class="built-with__actions">
          <button type="button" class="lol-btn--teal built-with__btn" id="built-with-email-btn">
            <span data-field="email_btn_label">${escHtml(b.email_btn_label)}</span>
          </button>
        </div>
      </div>
    </section>`;
  }

  // ── Footer (editable, per-page) ────────────────────────────────────────
  _footerHtml() {
    const f = this._footer;
    const hrefRow = (href) => this._canEdit
      ? `<span class="contact-view__edit-only lol-footer__href">
           <span class="contact-card__href-label">Link:</span>
           <span data-field="href">${escHtml(href)}</span>
         </span>`
      : '';

    const legal = f.legal_links.map((l, i) => `
      <a href="${escHtml(l.href)}" class="lol-footer__legal-link" data-legal-index="${i}">
        <span data-field="label">${escHtml(l.label)}</span>
        ${hrefRow(l.href)}
      </a>`).join('');

    return `
    <footer class="lol-footer" data-section="footer">
      <!-- The business routes, matching the home footer. Six of the seven
           links here used to be hidden surfaces (publicSurface.js) — /shop,
           /news, /halli, /party and the /projects and /contact aliases —
           which this footer was quietly publishing to every visitor. -->
      <nav class="lol-footer__top" aria-label="${t('nav.footerNav')}">
        <a href="${href('/')}"              class="lol-footer__nav-link">${t('nav.home')}</a>
        <a href="${href('/thjonusta')}"     class="lol-footer__nav-link">${t('nav.thjonusta')}</a>
        <a href="${href('/verkefni')}"      class="lol-footer__nav-link">${t('nav.projects')}</a>
        <a href="${href('/um-okkur')}"      class="lol-footer__nav-link">${t('nav.umOkkur')}</a>
        <a href="${href('/hafa-samband')}"  class="lol-footer__nav-link">${t('nav.hafaSamband')}</a>
      </nav>

      <div class="lol-footer__brand">
        <div class="lol-footer__logo" data-field="brand_name">${escHtml(f.brand_name)}</div>
        <p class="lol-footer__copy">
          &copy; ${new Date().getFullYear()} <span data-field="brand_name_copy">${escHtml(f.brand_name)}</span>.
          <span data-field="copy_suffix">${escHtml(f.copy_suffix)}</span>
        </p>
        <nav class="lol-footer__legal" aria-label="Legal navigation">
          ${legal}
        </nav>
      </div>
    </footer>`;
  }

  // ── Init: email obfuscation — assemble mailto only on user interaction ─
  // The displayed text stays as "halli [at] hallismiley [dot] is" so the raw
  // address never lives in the static HTML source; the mailto is built lazily
  // on click/focus/hover from the stored `href` on the email card item.
  _initEmailLinks(view) {
    const emailHref = () => {
      const it = this._card.items.find(x => x.type === 'email');
      return (it && it.href) || DEFAULT_CARD.en.items[0].href;
    };
    const reveal = (el) => {
      if (!el || el.dataset.revealed === '1') return;
      el.href = `mailto:${emailHref()}`;
      el.dataset.revealed = '1';
    };

    ['#contact-email-link', '#contact-mailto-link'].forEach(sel => {
      const el = view.querySelector(sel);
      if (!el) return;
      el.addEventListener('mouseenter', () => reveal(el), { once: true });
      el.addEventListener('focus',      () => reveal(el), { once: true });
      el.addEventListener('touchstart', () => reveal(el), { once: true, passive: true });
      el.addEventListener('click', (e) => {
        if (el.dataset.revealed !== '1') {
          e.preventDefault();
          window.location.href = `mailto:${emailHref()}`;
        }
      });
    });
  }

  // ── Init: "Email me for setup help" pre-fills the form + scrolls to it ──
  _initBuiltWithButtons(view) {
    const btn = view.querySelector('#built-with-email-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const message = view.querySelector('#contact-page-message');
      if (message && !message.value.trim()) {
        message.value = t('contact.builtWithPrefill');
      }
      view.querySelector('#contact-form-section')?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => view.querySelector('#contact-page-name')?.focus(), 500);
    });
  }

  // ── Init: form submission ──────────────────────────────────────────────
  _initForm(view) {
    const form   = view.querySelector('#contact-page-form');
    const status = view.querySelector('#contact-page-status');
    const submit = view.querySelector('#contact-page-submit');
    if (!form) return;

    const submitLabel = () => this._form.submit_label || pick(DEFAULT_FORM).submit_label;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const honeypot = form.querySelector('#contact-page-honeypot').value;
      const name     = form.querySelector('#contact-page-name').value.trim();
      const email    = form.querySelector('#contact-page-email').value.trim();
      const message  = form.querySelector('#contact-page-message').value.trim();
      const company  = form.querySelector('#contact-page-company').value.trim() || null;
      const phone    = form.querySelector('#contact-page-phone').value.trim() || null;
      const platform = form.querySelector('#contact-page-platform').value || null;

      if (!name || !email || !message) {
        status.className = 'contact-form__status contact-form__status--error';
        status.textContent = t('form.requiredFields');
        return;
      }

      submit.disabled = true;
      submit.textContent = t('form.sending');
      status.className = 'contact-form__status';
      status.textContent = '';

      try {
        const res = await fetch('/api/v1/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message, company, phone, current_platform: platform, website: honeypot }),
        });

        if (res.ok) {
          status.className = 'contact-form__status contact-form__status--success';
          status.textContent = t('contact.sent');
          form.reset();
        } else {
          const data = await res.json().catch(() => ({}));
          const msg = data.errors?.[0] || data.error || 'Something went wrong.';
          throw new Error(msg);
        }
      } catch (err) {
        status.className = 'contact-form__status contact-form__status--error';
        status.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel();
      }
    });
  }

  // ── Init: page-level inline edit (admin/moderator only) ────────────────
  _initPageEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'contact-view__edit-btn';
    editBtn.setAttribute('aria-label', 'Edit Contact page');
    editBtn.setAttribute('data-testid', 'edit-contact-page-btn');
    editBtn.textContent = t('admin.editPage');
    view.appendChild(editBtn);

    const controls = document.createElement('div');
    controls.className = 'contact-view__edit-controls contact-view__edit-controls--hidden';
    controls.innerHTML = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="contact-view__save-btn"
              data-testid="edit-contact-page-save">${t('form.saveChanges')}</button>
      <button type="button" class="contact-view__cancel-btn"
              data-testid="edit-contact-page-cancel">${t('admin.cancel')}</button>
      <span class="contact-view__edit-status" aria-live="polite"></span>`;
    view.appendChild(controls);

    let snapshot = null;

    editBtn.addEventListener('click', () => {
      snapshot = SECTIONS.reduce((acc, s) => {
        acc[s.field] = JSON.parse(JSON.stringify(this[s.field]));
        return acc;
      }, {});
      this._enterPageEdit(view, editBtn, controls);
    });

    controls.querySelector('.contact-view__save-btn').addEventListener('click', () =>
      this._saveAll(view, editBtn, controls)
    );

    controls.querySelector('.contact-view__cancel-btn').addEventListener('click', () => {
      if (snapshot) {
        for (const s of SECTIONS) this[s.field] = snapshot[s.field];
        this._repaintAll(view);
      }
      this._exitPageEdit(view, editBtn, controls);
    });
  }

  _enterPageEdit(view, editBtn, controls) {
    view.classList.add('contact-view--editing');
    editBtn.classList.add('contact-view__edit-btn--hidden');
    controls.classList.remove('contact-view__edit-controls--hidden');
    // contact_hero is the canonical anchor block — if it's untranslated the
    // rest of the page almost certainly is too.
    checkUntranslated('contact_hero', controls);
    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }

  _exitPageEdit(view, editBtn, controls) {
    view.classList.remove('contact-view--editing');
    editBtn.classList.remove('contact-view__edit-btn--hidden');
    controls.classList.add('contact-view__edit-controls--hidden');
    controls.querySelector('.contact-view__edit-status').textContent = '';
    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
  }

  // ── Collect DOM → payloads, PUT in parallel, report per-section results ──
  async _saveAll(view, editBtn, controls) {
    const status = controls.querySelector('.contact-view__edit-status');
    status.textContent = t('form.saving');

    const payloads = {
      _hero:         this._collectHero(view),
      _card:         this._collectCard(view),
      _form:         this._collectForm(view),
      _availability: this._collectAvailability(view),
      _builtWith:    this._collectBuiltWith(view),
      _footer:       this._collectFooter(view),
    };

    let token;
    try {
      token = await getCSRFToken();
    } catch {
      token = null;
    }

    const locale = encodeURIComponent(window.__locale || 'en');
    const puts = SECTIONS.map(async s => {
      const body = payloads[s.field];
      const res = await fetch(`/api/v1/content/${s.key}?locale=${locale}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`${s.key}: ${err.error || res.statusText}`);
      }
      const value = await res.json();
      this[s.field] = this._mergeWithDefaults(s.defaults, value);
      return s.key;
    });

    const results = await Promise.allSettled(puts);
    const failed = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message || 'unknown error');

    // Repaint from updated state (so server-side normalisation is reflected)
    this._repaintAll(view);

    if (failed.length) {
      status.textContent = `Saved with errors — ${failed.join('; ')}`;
      return;
    }

    status.textContent = t('form.saved');
    setTimeout(() => this._exitPageEdit(view, editBtn, controls), 1200);
  }

  // ── Collectors: read DOM → section payload ─────────────────────────────

  _collectHero(view) {
    const section = view.querySelector('[data-section="hero"]');
    return {
      eyebrow:      this._readField(section, 'eyebrow',      this._hero.eyebrow),
      title_line1:  this._readField(section, 'title_line1',  this._hero.title_line1),
      title_accent: this._readField(section, 'title_accent', this._hero.title_accent),
      subtitle:     this._readField(section, 'subtitle',     this._hero.subtitle),
    };
  }

  _collectCard(view) {
    const section = view.querySelector('[data-section="card"]');
    const items = [];
    section.querySelectorAll('[data-item-index]').forEach(el => {
      const type = el.dataset.type;
      const base = this._card.items[parseInt(el.dataset.itemIndex, 10)] || {};
      const entry = {
        type,
        label: this._readField(el, 'label', base.label),
        value: this._readField(el, 'value', base.value),
      };
      if (type === 'location') {
        entry.meta = this._readField(el, 'meta', base.meta || '');
      } else {
        entry.href = this._readField(el, 'href', base.href || '');
      }
      items.push(entry);
    });
    return { items };
  }

  _collectForm(view) {
    const section = view.querySelector('[data-section="form"]');
    return {
      eyebrow:         this._readField(section, 'eyebrow',         this._form.eyebrow),
      title:           this._readField(section, 'title',           this._form.title),
      submit_label:    this._readField(section, 'submit_label',    this._form.submit_label),
      fallback_prefix: this._readField(section, 'fallback_prefix', this._form.fallback_prefix),
      fallback_link:   this._readField(section, 'fallback_link',   this._form.fallback_link),
    };
  }

  _collectAvailability(view) {
    const section = view.querySelector('[data-section="availability"]');
    const eyebrow = this._readField(section, 'eyebrow', this._availability.eyebrow);
    const title   = this._readField(section, 'title',   this._availability.title);
    const cards = [];
    section.querySelectorAll('[data-card-index]').forEach(el => {
      const rawStatus = (el.querySelector('[data-field="status"]')?.innerText.trim() || 'open').toLowerCase();
      const status = ['open', 'limited', 'closed'].includes(rawStatus) ? rawStatus : 'open';
      cards.push({
        status,
        label: this._readField(el, 'label', ''),
        body:  this._readField(el, 'body',  ''),
      });
    });
    return { eyebrow, title, cards };
  }

  _collectBuiltWith(view) {
    const section = view.querySelector('[data-section="built_with"]');
    const pills = [];
    section.querySelectorAll('[data-pill-index]').forEach(el => {
      pills.push(el.innerText.trim());
    });
    return {
      eyebrow:          this._readField(section, 'eyebrow',          this._builtWith.eyebrow),
      title:            this._readField(section, 'title',            this._builtWith.title),
      body1:            this._readField(section, 'body1',            this._builtWith.body1),
      body2:            this._readField(section, 'body2',            this._builtWith.body2),
      pills,
      email_btn_label:  this._readField(section, 'email_btn_label',  this._builtWith.email_btn_label),
    };
  }

  _collectFooter(view) {
    const section = view.querySelector('[data-section="footer"]');
    const brand_name = this._readField(section, 'brand_name', this._footer.brand_name);
    const copy_suffix = this._readField(section, 'copy_suffix', this._footer.copy_suffix);

    const legal_links = [];
    section.querySelectorAll('[data-legal-index]').forEach(el => {
      legal_links.push({
        label: this._readField(el, 'label', ''),
        href:  this._readField(el, 'href',  ''),
      });
    });
    return { brand_name, copy_suffix, legal_links };
  }

  // Reads the first descendant [data-field="name"] innerText (trimmed), or fallback.
  _readField(root, name, fallback) {
    const el = root?.querySelector(`[data-field="${name}"]`);
    if (!el) return fallback;
    const txt = el.innerText.trim();
    return txt || fallback;
  }

  // ── Repaint: re-render each section after Save/Cancel so DOM mirrors state ─
  _repaintAll(view) {
    const parent = view;
    const sections = {
      hero:         this._heroHtml(),
      card:         this._cardHtml(),
      form:         this._formHtml(),
      availability: this._availabilityHtml(),
      built_with:   this._builtWithHtml(),
      footer:       this._footerHtml(),
    };
    for (const [name, html] of Object.entries(sections)) {
      const existing = parent.querySelector(`[data-section="${name}"]`);
      if (!existing) continue;
      const tmp = document.createElement('div');
      tmp.innerHTML = html.trim();
      const fresh = tmp.firstElementChild;
      existing.replaceWith(fresh);
    }
    // Re-wire handlers that targeted replaced subtrees
    this._initEmailLinks(parent);
    this._initForm(parent);
    this._initBuiltWithButtons(parent);
  }
}
