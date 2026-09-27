// HomeView — League of Legends inspired layout
// Sections: Hero → Splash → News → Projects → Skills → Stats → Contact → Footer

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, getLocale, href, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';
import { SceneStage } from '../scenes/SceneStage.js';
import { productSiteUrl } from '../utils/productSite.js';
import { motionAllowed, onMotionChange } from '../utils/motion.js';
import { getIdentity, publicNav, isHiddenRoute } from '../utils/identity.js';
import { moduleEnabled } from '../utils/modules.js';
import { formatDate } from '../utils/format.js';

// The home hero clip and its still — the PRODUCT's, from identity.hero in
// config/client.json (utils/identity.js; the engine default is Orange
// Smiley's hero-dc7df-v2). The poster is the loop's first frame, so the switch
// between the still (reduced motion, Save-Data, before the first frame
// decodes) and playback never jumps. A new clip gets a new filename: the
// generic public/ static mount caches for an hour.
const HERO_VIDEO_SRC    = getIdentity().hero.clip;
const HERO_VIDEO_POSTER = getIdentity().hero.poster;


// ── Project categories (champion-selector style) ──────────────────────────
// Icons are NOT editable — keyed by category id and merged at render time.
// One icon per discipline id. The ids are the company's lines of work
// (2026-09-01) — they replaced the portfolio's tech/carpentry/remodelling/
// tools set, which put timber joinery and workshop tools on the front page of
// a software company. Decorative only: these tiles swap a preview image, they
// are not the /verkefni category filter and are not the projects.category enum.
const CATEGORY_ICONS = {
  web: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="M2 9h20"/><circle cx="5.5" cy="6.5" r="0.6" fill="currentColor"/>
        </svg>`,
  store: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M3 7h18l-1.5 12.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5z"/>
            <path d="M8.5 10V6a3.5 3.5 0 0 1 7 0v4"/>
          </svg>`,
  operations: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                 <path d="M4 3h12l4 4v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
                 <path d="M8 12h8M8 16h8M8 8h4"/>
               </svg>`,
  ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
         <rect x="6" y="6" width="12" height="12" rx="2"/>
         <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8"/>
       </svg>`,
};

// Default discipline content — fallback if API row is unavailable. Shaped
// as { en, is } for locale-aware fallback (picked via pick() at load time).
//
// DRAFT (2026-09-01): the four lines of work the company sells, replacing the
// portfolio's disciplines. Since 2026-09-03 (Halli: show examples of our own
// work) each tile is a screenshot of the product itself — two from the product
// site rekstrarkerfi.is (sibling repo, for variety: Halli 2026-09-03) and two
// from a running instance seeded with the books demo
// (server/scripts/seed-books-demo.js):
//   vefur       — rekstrarkerfi.is landing page: a web page the company built.
//   verslun     — rekstrarkerfi.is "Verslun & pantanir" feature card.
//   rekstur     — the invoice list: amounts, VSK, what is outstanding.
//   gervigreind — a change request being written: pick an element on the
//                 page, describe the change, the AI builds it.
// 800×800 JPEGs in public/assets/disciplines/, content-hashed in the filename:
// /assets/ is served with max-age=3600, so a tile overwritten under the same
// name kept showing the old picture for an hour (2026-09-03). Halli can replace
// any of them from the inline editor (image upload per category).
const DEFAULT_DISCIPLINE_CONTENT = {
  en: {
    eyebrow:     'Browse by',
    heading:     'What we build',
    description: 'One system with four faces. Every customer runs the same core; what differs is how much of it they switch on, and the modules we fit to their business.',
    categories: [
      { id: 'web',        label: 'Web',        type: 'Sites & content',            img: '/assets/disciplines/vefur.7f8d247c.jpg' },
      { id: 'store',      label: 'Store',      type: 'Catalogue & checkout',       img: '/assets/disciplines/verslun.21ab6017.jpg' },
      { id: 'operations', label: 'Operations', type: 'Inventory, invoicing & VAT', img: '/assets/disciplines/rekstur.40399c5b.jpg' },
      { id: 'ai',         label: 'AI',         type: 'Agents that build & operate', img: '/assets/disciplines/gervigreind.fde5f2fa.jpg' },
    ],
  },
  is: {
    eyebrow:     'Skoða eftir',
    heading:     'Því sem við smíðum',
    description: 'Eitt kerfi með fjórum hliðum. Allir viðskiptavinir keyra sama kjarnann; það sem er ólíkt er hversu mikið af honum er kveikt á og hvaða einingar við sníðum að rekstrinum.',
    categories: [
      { id: 'web',        label: 'Vefur',      type: 'Vefir og efnisstjórnun',      img: '/assets/disciplines/vefur.7f8d247c.jpg' },
      { id: 'store',      label: 'Verslun',    type: 'Vörulisti og greiðslur',      img: '/assets/disciplines/verslun.21ab6017.jpg' },
      { id: 'operations', label: 'Rekstur',    type: 'Lager, reikningar og VSK',    img: '/assets/disciplines/rekstur.40399c5b.jpg' },
      { id: 'ai',         label: 'Gervigreind', type: 'Umboð sem smíða og reka',    img: '/assets/disciplines/gervigreind.fde5f2fa.jpg' },
    ],
  },
};

// ── Default skills content — used as fallback if API is unavailable.
// DRAFT (2026-09-01): company copy — what Orange Smiley does. Shaped as
// { en, is } like the hero and discipline defaults; _loadContent() picks the
// locale slice, so what reaches the inline editor is always the flat row
// shape the API stores. ──
const DEFAULT_SKILLS_CONTENT = {
  en: {
    eyebrow:     'What we do',
    title:       'We build it\n& we run it',
    description: 'Orange Smiley is an Icelandic software house driven by AI. We build business systems and then operate them — hosting, monitoring, security and the changes you ask for. AI agents do the custom work, which is why bespoke costs subscription money instead of consultancy money.',
    items: [
      { label: 'Web',        value: 'Sites · stores · checkout' },
      { label: 'Operations', value: 'Inventory · invoicing · VAT' },
      { label: 'AI',         value: 'Agents build and maintain' },
      { label: 'Platform',   value: 'Node · PostgreSQL · Azure' },
      { label: 'Running it', value: 'Hosting · updates · 24/7 watch' },
      { label: 'Security',   value: 'OWASP · 2FA · audit logging' },
    ],
    image_url: 'https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format',
  },
  is: {
    eyebrow:     'Það sem við gerum',
    title:       'Við smíðum\n& við rekum',
    description: 'Orange Smiley er íslenskt hugbúnaðarhús knúið gervigreind. Við smíðum rekstrarkerfi og rekum þau svo áfram — hýsingu, vöktun, öryggi og breytingarnar sem þú biður um. Gervigreindin vinnur sérsmíðina, þess vegna kostar hún áskrift en ekki ráðgjafartíma.',
    items: [
      { label: 'Vefur',    value: 'Vefir · verslanir · greiðslur' },
      { label: 'Rekstur',  value: 'Lager · reikningar · VSK' },
      { label: 'Gervigreind', value: 'Umboð smíða og viðhalda' },
      { label: 'Undirstaða', value: 'Node · PostgreSQL · Azure' },
      { label: 'Umsjón',   value: 'Hýsing · uppfærslur · vöktun' },
      { label: 'Öryggi',   value: 'OWASP · 2FA · aðgerðaskrár' },
    ],
    image_url: 'https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format',
  },
};

// ── Default stats content — used as fallback if API is unavailable.
// DRAFT (2026-09-01): company numbers, { en, is } like the rest. ──
const DEFAULT_STATS_CONTENT = {
  en: [
    { num: '2026', label: 'Founded in Iceland' },
    { num: '1',    label: 'Product — Rekstrarkerfið' },
    { num: '20+',  label: 'Years building software' },
    { num: '24/7', label: 'Monitored and operated' },
  ],
  is: [
    { num: '2026', label: 'Stofnað á Íslandi' },
    { num: '1',    label: 'Vara — Rekstrarkerfið' },
    { num: '20+',  label: 'Ára reynsla af hugbúnaðarsmíði' },
    { num: '24/7', label: 'Vöktun og rekstur' },
  ],
};

// ── Default hero content — fallback if API row is unavailable. Shaped as
// { en, is } for locale-aware fallback (picked via getLocale() at load time).
// DRAFT (2026-09-01): the hero introduces the COMPANY. The product pitch it
// used to carry ("Allt kerfið þitt á einum stað") is now Rekstrarkerfið's
// own tagline, in the products section below and on /thjonusta. ──
const DEFAULT_HERO_CONTENT = {
  en: {
    title_first:  'We build software',
    title_second: 'that runs businesses',
    subtitle:     'Orange Smiley is an Icelandic software house driven by AI — we build the systems your company runs on, and we keep them running.',
    cta_label:    'Get in touch',
  },
  is: {
    title_first:  'Við smíðum hugbúnað',
    title_second: 'sem rekur fyrirtæki',
    subtitle:     'Orange Smiley er íslenskt hugbúnaðarhús knúið gervigreind — við smíðum kerfin sem fyrirtækið þitt keyrir á og höldum þeim gangandi.',
    cta_label:    'Hafa samband',
  },
};

// The stats fallback for the active locale, deep-copied so callers can hand
// it straight to the inline editor without writing through to the constant.
function _defaultStats() {
  const rows = DEFAULT_STATS_CONTENT[getLocale()] || DEFAULT_STATS_CONTENT.en;
  return JSON.parse(JSON.stringify(rows));
}

// Historical rows in site_content were sometimes saved as an object with
// numeric string keys (`{"0": {...}, "1": {...}}`) instead of a JSON array.
// Both shapes carry the same data; normalise to an array so .map works.
function _coerceStatsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const vals = Object.values(data).filter(v => v && typeof v === 'object' && 'num' in v && 'label' in v);
    if (vals.length) return vals;
  }
  return _defaultStats();
}

// ─────────────────────────────────────────────────────────────────────────
export class HomeView {
  constructor() {
    this._content = null;       // skills — loaded from API in render()
    this._statsContent = null;  // stats — loaded from API in render()
    this._discipline = null;    // discipline (projects categories) — loaded from API
    this._heroContent = null;   // hero — loaded from API in render()
    this._landingBg = null;     // landing background config — video (default) | scene | gradient | photo | plain
    this._newsArticles = [];
    this._scenes = [];          // SceneStage instances (destroyed with the view)
  }

  async render() {
    await Promise.all([
      this._loadContent(),
      this._loadStats(),
      this._loadDiscipline(),
      this._loadHero(),
      this._loadLandingBg(),
      this._loadNews(),
    ]);

    const view = document.createElement('div');
    view.className = 'view';

    // The original hallismiley composition, restored 2026-08-22 (Halli's
    // call: the scene-band cutovers between photographs didn't work — back
    // to the one-canvas homepage and iterate from there). The business
    // tier/step sections are the dormant ones now (_tiers/_steps below);
    // the Iceland scene engine stays on the inner pages and remains an
    // admin-selectable hero background mode.
    view.innerHTML = `
      ${this._hero()}
      ${this._products()}
      ${this._news()}
      ${this._projects()}
      ${this._skills()}
      ${this._stats()}
      ${this._contact()}
      ${this._footer()}
    `;

    this._initProjects(view);
    this._initContactForm(view);
    this._initHeroVideo(view);
    this._initHeroScene(view); // scene mode is still admin-selectable
    this._initHeroEdit(view);
    this._initSkillsEdit(view);
    this._initDisciplineEdit(view);
    this._initFooterLinks(view);
    return view;
  }

  // ── Load skills content from API ───────────────────────────────────────
  async _loadContent() {
    try {
      const res = await fetch(`/api/v1/content/home_skills?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        this._content = await res.json();
        return;
      }
    } catch { /* network error — fall through to default */ }
    const defaults = DEFAULT_SKILLS_CONTENT[getLocale()] || DEFAULT_SKILLS_CONTENT.en;
    this._content = JSON.parse(JSON.stringify(defaults));
  }

  // ── Load stats content from API ────────────────────────────────────────
  async _loadStats() {
    try {
      const res = await fetch(`/api/v1/content/home_stats?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        const data = await res.json();
        this._statsContent = _coerceStatsArray(data);
        return;
      }
    } catch { /* network error — fall through to default */ }
    this._statsContent = _defaultStats();
  }

  // ── Load discipline (projects categories) content from API ─────────────
  async _loadDiscipline() {
    try {
      const res = await fetch(`/api/v1/content/home_discipline?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        const data = await res.json();
        // Defensive: ensure required shape
        if (data && Array.isArray(data.categories) && data.categories.length > 0) {
          this._discipline = data;
          return;
        }
      }
    } catch { /* network error — fall through to default */ }
    const defaults = DEFAULT_DISCIPLINE_CONTENT[getLocale()] || DEFAULT_DISCIPLINE_CONTENT.en;
    this._discipline = JSON.parse(JSON.stringify(defaults));
  }

  // ── Load hero content from API ─────────────────────────────────────────
  async _loadHero() {
    try {
      const res = await fetch(`/api/v1/content/home_hero?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          this._heroContent = data;
          return;
        }
      }
    } catch { /* network error — fall through to default */ }
    const defaults = DEFAULT_HERO_CONTENT[getLocale()] || DEFAULT_HERO_CONTENT.en;
    this._heroContent = JSON.parse(JSON.stringify(defaults));
  }

  // ── Load landing background config (admin-configurable; the HERO VIDEO
  // is the default again — Halli's call (2026-08-22), reverting the
  // one-day scene default. Scene/gradient/photo/plain all remain available
  // through the admin background settings, so nothing admins could pick was
  // lost. ──
  async _loadLandingBg() {
    try {
      const res = await fetch('/api/v1/content/landing_background?locale=en');
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') { this._landingBg = data; return; }
      }
    } catch { /* network error — fall through to the video default */ }
    this._landingBg = { mode: 'video', photo_url: null, veil_percent: 100 };
  }

  // ── SECTION 1: Hero ────────────────────────────────────────────────────
  _hero() {
    const h  = this._heroContent || DEFAULT_HERO_CONTENT.en;
    const bg = this._landingBg || { mode: 'video', photo_url: null, veil_percent: 100 };
    const veil = Math.max(0, Math.min(100, Number.isFinite(bg.veil_percent) ? bg.veil_percent : 100));
    // Background: video (default) | scene (the Iceland scene engine, mounted
    // after render into the section) | gradient | photo (a library image) |
    // plain. gradient and plain add no media layer at all. The photo layer
    // uses its own class so _initHeroVideo's `.lol-hero__bg` lookup only
    // matches the real <video>.
    let bgEl = '';
    if (bg.mode === 'photo' && bg.photo_url) {
      bgEl = `<div class="lol-hero__photobg" style="position:absolute;inset:0;background-size:cover;background-position:center;background-image:url('${escHtml(bg.photo_url)}')" aria-hidden="true"></div>`;
    } else if (bg.mode === 'video') {
      // Reduced motion or Save-Data: no autoplay and no download — the
      // poster stands in as a still. _initHeroVideo follows a live change of
      // the OS setting in either direction.
      const moving = motionAllowed();
      bgEl = `<video class="lol-hero__bg"${moving ? ' autoplay' : ''} muted loop playsinline preload="${moving ? 'auto' : 'none'}" poster="${HERO_VIDEO_POSTER}" aria-hidden="true">
        <!-- TODO (production): move this video to a CDN to avoid serving large assets through Node.js -->
        <source src="${HERO_VIDEO_SRC}" type="video/mp4">
      </video>`;
    }
    // The veil exists to hold text legible over MEDIA. Over the gradient it
    // would only mute a background that was designed for this copy already —
    // and it is built from --bg-nav-rgb, so on a light theme it would wash the
    // hero out rather than darken it.
    const overlay = bgEl ? `<div class="lol-hero__overlay" aria-hidden="true" style="opacity:${veil / 100}"></div>` : '';
    // Media modes still carry light-on-dark hero text; scene mode does too
    // (white over the scrim), so both wear --media. The scene slot itself is
    // filled in _initHeroScene after render.
    const isScene = bg.mode === 'scene';
    const mediaCls = (bgEl || isScene) ? ' lol-hero--media' : '';
    const sceneCls = isScene ? ' lol-hero--scene' : '';
    const sceneStrength = isScene ? ` style="--scene-scrim-strength:${(veil / 100).toFixed(2)}"` : '';
    return `
    <section class="lol-hero${mediaCls}${sceneCls}" id="main-content" aria-label="${t('home.heroAriaLabel')}"${sceneStrength}>
      ${bgEl}
      ${overlay}

      <div class="lol-hero__content">
        <h1 class="lol-hero__title">
          <span data-hero-field="title_first">${escHtml(h.title_first)}</span>
          <span class="lol-hero__title-second" data-hero-field="title_second">${escHtml(h.title_second)}</span>
        </h1>
        <p class="lol-hero__subtitle" data-hero-field="subtitle">${escHtml(h.subtitle)}</p>
        <a href="${href('/hafa-samband')}" class="lol-hero__cta" data-hero-field="cta_label">${escHtml(h.cta_label)}</a>
      </div>

      <div class="lol-hero__scroll" aria-hidden="true">
        <span>${t('home.scrollHint')}</span>
        <div class="lol-hero__scroll-line"></div>
      </div>
    </section>`;
  }

  // ── DORMANT since 2026-08-22 (hallismiley-layout revert): service-tier
  // teaser — three cards → /thjonusta. Kept, with its i18n, for the coming
  // content pass — Halli decides where the tiers return. ──────────────────
  // ── SECTION: Products ──────────────────────────────────────────────────
  // The company site names its products here (Halli, 2026-09-01). One entry
  // today; the grid takes a second card without restructuring, which is the
  // whole point of listing products rather than pitching the one we have.
  // Deep product marketing lives on the product's own site — this card's job
  // is to say what Rekstrarkerfið is and hand the visitor to rekstrarkerfi.is
  // in a new tab (Halli, 2026-09-13; /thjonusta no longer presents the product).
  // It is the COMPANY's section: it renders only while the services page is
  // part of this product's public IA — a downstream that hides /thjonusta
  // (identity.surface.hiddenRoutes) has no products to list here.
  _products() {
    if (isHiddenRoute('/thjonusta')) return '';
    return `
    <section class="home-products" aria-labelledby="home-products-title">
      <div class="home-products__header">
        <span class="home-products__eyebrow">${t('home.productsEyebrow')}</span>
        <h2 class="home-products__title" id="home-products-title">${t('home.productsTitle')}</h2>
      </div>
      <div class="home-products__grid">
        <article class="home-products__card">
          <span class="home-products__badge">${t('home.productRekstrarBadge')}</span>
          <h3 class="home-products__name">${t('home.productRekstrarName')}</h3>
          <p class="home-products__tagline">${t('home.productRekstrarTagline')}</p>
          <p class="home-products__desc">${t('home.productRekstrarDesc')}</p>
          <a href="${productSiteUrl(getLocale())}" target="_blank" rel="noopener" class="btn btn--primary home-products__cta">
            ${t('home.productRekstrarCta')}<span class="sr-only"> ${t('common.opensNewTab')}</span>
            <span class="home-products__cta-icon" aria-hidden="true">↗</span>
          </a>
        </article>
      </div>
    </section>`;
  }

  _tiers() {
    const tiers = [
      { name: t('home.tierVefurName'),   desc: t('home.tierVefurDesc') },
      { name: t('home.tierVerslunName'), desc: t('home.tierVerslunDesc') },
      { name: t('home.tierReksturName'), desc: t('home.tierReksturDesc') },
    ];
    return `
    <section class="home-tiers" aria-labelledby="home-tiers-title">
      <div class="section__header">
        <h2 class="section__title" id="home-tiers-title">${t('home.tiersTitle')}</h2>
      </div>
      <div class="home-tiers__grid">
        ${tiers.map((tier, i) => `
        <a href="${href('/thjonusta')}" class="home-tiers__card${i === 1 ? ' home-tiers__card--featured' : ''}">
          <span class="home-tiers__numeral" aria-hidden="true">${['I', 'II', 'III'][i]}</span>
          <h3 class="home-tiers__name">${tier.name}</h3>
          <p class="home-tiers__desc">${tier.desc}</p>
        </a>`).join('')}
      </div>
      <div class="home-tiers__cta-row">
        <a href="${href('/thjonusta')}" class="btn btn--primary">${t('home.tiersCta')}</a>
      </div>
    </section>`;
  }

  // ── DORMANT since 2026-08-22 (see _tiers above): how it works — 3 steps ──
  _steps() {
    const steps = [
      { title: t('home.step1Title'), desc: t('home.step1Desc') },
      { title: t('home.step2Title'), desc: t('home.step2Desc') },
      { title: t('home.step3Title'), desc: t('home.step3Desc') },
    ];
    return `
    <section class="home-steps" aria-labelledby="home-steps-title">
      <div class="section__header">
        <h2 class="section__title" id="home-steps-title">${t('home.stepsTitle')}</h2>
      </div>
      <ol class="home-steps__list">
        ${steps.map((step, i) => `
        <li class="home-steps__item">
          <span class="home-steps__num" aria-hidden="true">${i + 1}</span>
          <h3 class="home-steps__title">${step.title}</h3>
          <p class="home-steps__desc">${step.desc}</p>
        </li>`).join('')}
      </ol>
    </section>`;
  }

  // ── Hero section — inline edit for admin/moderator ─────────────────────
  _initHeroEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const section = view.querySelector('.lol-hero');
    if (!section) return;

    const editBtn = document.createElement('button');
    editBtn.className = 'lol-hero__edit-btn';
    editBtn.id        = 'hero-edit-btn';
    editBtn.type      = 'button';
    editBtn.setAttribute('aria-label', 'Edit hero section');
    editBtn.setAttribute('data-testid', 'edit-hero-btn');
    editBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit Section`;
    section.style.position = 'relative';
    section.appendChild(editBtn);

    const controls = document.createElement('div');
    controls.className  = 'lol-hero__edit-controls lol-hero__edit-controls--hidden';
    controls.id         = 'hero-edit-bar';
    controls.setAttribute('data-testid', 'edit-hero-controls');
    controls.innerHTML  = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="lol-hero__save-btn" data-testid="edit-hero-save">Save Changes</button>
      <button type="button" class="lol-hero__cancel-btn" data-testid="edit-hero-cancel">Cancel</button>
      <span   class="lol-hero__edit-status" aria-live="polite"></span>`;
    section.appendChild(controls);

    // CTA is an <a> — block navigation while editing so clicks land in the editable region.
    const cta = section.querySelector('.lol-hero__cta');
    if (cta) cta.addEventListener('click', e => {
      if (section.classList.contains('lol-hero--editing')) e.preventDefault();
    });

    let _snapshot = null;

    editBtn.addEventListener('click', () => {
      _snapshot = JSON.parse(JSON.stringify(this._heroContent));
      this._enterHeroEdit(section, editBtn, controls);
    });

    controls.querySelector('.lol-hero__save-btn').addEventListener('click', () =>
      this._saveHeroEdit(section, controls)
    );

    controls.querySelector('.lol-hero__cancel-btn').addEventListener('click', () => {
      this._exitHeroEdit(section, editBtn, controls);
      if (_snapshot) this._restoreHeroEdit(section, _snapshot);
    });
  }

  _enterHeroEdit(section, editBtn, controls) {
    section.classList.add('lol-hero--editing');
    editBtn.classList.add('lol-hero__edit-btn--hidden');
    controls.classList.remove('lol-hero__edit-controls--hidden');
    checkUntranslated('home_hero', controls);

    section.querySelectorAll('[data-hero-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });
  }

  _exitHeroEdit(section, editBtn, controls) {
    section.classList.remove('lol-hero--editing');
    editBtn.classList.remove('lol-hero__edit-btn--hidden');
    controls.classList.add('lol-hero__edit-controls--hidden');
    controls.querySelector('.lol-hero__edit-status').textContent = '';

    section.querySelectorAll('[data-hero-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
  }

  _restoreHeroEdit(section, snapshot) {
    section.querySelector('[data-hero-field="title_first"]').innerHTML  = escHtml(snapshot.title_first);
    section.querySelector('[data-hero-field="title_second"]').innerHTML = escHtml(snapshot.title_second);
    section.querySelector('[data-hero-field="subtitle"]').innerHTML     = escHtml(snapshot.subtitle);
    section.querySelector('[data-hero-field="cta_label"]').innerHTML    = escHtml(snapshot.cta_label);
    this._heroContent = snapshot;
  }

  async _saveHeroEdit(section, controls) {
    const status = controls.querySelector('.lol-hero__edit-status');
    status.textContent = 'Saving…';

    // textContent (not innerText) so CSS text-transform: uppercase on
    // .lol-hero__title / __subtitle / __cta doesn't get baked into stored values.
    const title_first  = section.querySelector('[data-hero-field="title_first"]')?.textContent.trim()  ?? this._heroContent.title_first;
    const title_second = section.querySelector('[data-hero-field="title_second"]')?.textContent.trim() ?? this._heroContent.title_second;
    const subtitle     = section.querySelector('[data-hero-field="subtitle"]')?.textContent.trim()     ?? this._heroContent.subtitle;
    const cta_label    = section.querySelector('[data-hero-field="cta_label"]')?.textContent.trim()    ?? this._heroContent.cta_label;

    const updated = { title_first, title_second, subtitle, cta_label };

    try {
      const token = await getCSRFToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
      };

      const res = await fetch(`/api/v1/content/home_hero?locale=${encodeURIComponent(window.__locale || 'en')}`, {
        method: 'PUT', credentials: 'include', headers,
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

      this._heroContent = await res.json();
      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }

  // ── Load news articles from API ─────────────────────────────────────────
  async _loadNews() {
    // No news module on this instance (R4): nothing to fetch, the API 404s.
    if (!moduleEnabled('news')) return;
    try {
      const res = await fetch('/api/v1/news?limit=3');
      if (res.ok) {
        const data = await res.json();
        this._newsArticles = data.articles || [];
      }
    } catch { /* network error — show empty */ }
  }

  // ── SECTION 2: News ───────────────────────────────────────────────────
  _news() {
    if (this._newsArticles.length === 0) return '';

    const catClass = cat => ['carpentry', 'tech', 'announcement'].includes(cat) ? cat : 'news';
    const fmtDate = iso => {
      if (!iso) return '';
      // App-locale date (was toLocaleDateString('en-GB'); ice #324).
      return formatDate(iso, {
        day: '2-digit', month: 'short', year: 'numeric',
      });
    };

    const cards = this._newsArticles.map(a => {
      const imgHtml = a.cover_image
        ? `<img class="lol-news__card-img" src="${escHtml(a.cover_image)}" alt="${escHtml(a.title)}" loading="lazy" width="800" height="450">`
        : `<div class="lol-news__card-img lol-news__card-img--placeholder" aria-hidden="true"></div>`;

      return `
      <a href="${href('/news/' + a.slug)}" class="lol-news__card lol-news__card--link">
        ${imgHtml}
        <div class="lol-news__card-body">
          <div class="lol-news__card-meta">
            <span class="lol-news__card-tag lol-news__card-tag--${catClass(a.category)}">${escHtml((a.category || 'news').toUpperCase())}</span>
            <time class="lol-news__card-date" datetime="${escHtml(a.published_at || a.created_at)}">${fmtDate(a.published_at || a.created_at)}</time>
          </div>
          <h3 class="lol-news__card-title">${escHtml(a.title)}</h3>
          <p class="lol-news__card-desc">${escHtml(a.summary)}</p>
        </div>
      </a>`;
    }).join('');

    return `
    <section class="lol-news" id="news" aria-label="Latest news">
      <div class="lol-news__inner">
        <!-- The /news list is a hidden surface (publicSurface.js): unlinked,
             noindex, still functional. The heading and the view-all link used
             to point straight at it from the public homepage — the individual
             article links stay, since those are what get shared. -->
        <div class="lol-news__header">
          <h2 class="lol-news__heading">${t('nav.news')}</h2>
        </div>
        <div class="lol-news__grid">${cards}</div>
      </div>
    </section>`;
  }

  // ── SECTION 4: Projects — champion-selector style ──────────────────────
  _projects() {
    const d     = this._discipline;
    const first = d.categories[0];

    const catIcons = d.categories.map((c, i) => `
      <div class="lol-projects__cat${i === 0 ? ' active' : ''}"
           data-cat="${escHtml(c.id)}" data-cat-index="${i}"
           role="tab" tabindex="${i === 0 ? '0' : '-1'}"
           aria-selected="${i === 0 ? 'true' : 'false'}" aria-label="${escHtml(c.label)}">
        <div class="lol-projects__cat-icon">${CATEGORY_ICONS[c.id] || ''}</div>
        <span class="lol-projects__cat-label" data-cat-field="label">${escHtml(c.label)}</span>
      </div>
    `).join('');

    return `
    <section class="lol-projects" aria-label="Project categories">
      <div class="lol-projects__inner">

        <div class="lol-projects__left">
          <p class="lol-projects__eyebrow" data-disc-field="eyebrow">${escHtml(d.eyebrow)}</p>
          <h2 class="lol-projects__heading" data-disc-field="heading">${escHtml(d.heading)}</h2>
          <p class="lol-projects__desc" data-disc-field="description">${escHtml(d.description)}</p>
          <div class="lol-projects__btns">
            <a href="${href('/')}" class="lol-btn--teal" id="contact-btn">${t('home.getInTouch')}</a>
          </div>
          <div class="lol-projects__categories" role="tablist" aria-label="Project disciplines">
            ${catIcons}
          </div>
        </div>

        <div class="lol-projects__right">
          <div class="lol-projects__circle">
            <img id="projects-preview-img"
                 class="lol-projects__preview-img"
                 src="${escHtml(first.img)}" alt="${escHtml(first.label)} projects preview"
                 width="800" height="800" loading="lazy">
          </div>
          <div class="lol-projects__preview-name">
            <p id="projects-preview-title" class="lol-projects__preview-title" data-cat-field="label">${escHtml(first.label)}</p>
            <p id="projects-preview-type"  class="lol-projects__preview-type"  data-cat-field="type">${escHtml(first.type)}</p>
          </div>
        </div>

      </div>
    </section>`;
  }

  // ── SECTION 5: Skills ──────────────────────────────────────────────────
  _skills() {
    const c         = this._content;
    const titleHtml = escHtml(c.title).replace(/\n/g, '<br>');
    const items     = c.items.map((s, i) => `
      <div class="lol-skills__item" data-item-index="${i}" role="listitem">
        <div class="lol-skills__item-label" data-item="label">${escHtml(s.label)}</div>
        <div class="lol-skills__item-value" data-item="value">${escHtml(s.value)}</div>
      </div>
    `).join('');

    return `
    <section class="lol-skills" aria-label="Skills and expertise">
      <div class="lol-skills__bg" aria-hidden="true"></div>
      <div class="lol-skills__inner">

        <div>
          <p class="lol-skills__tag" data-field="eyebrow">${escHtml(c.eyebrow)}</p>
          <h2 class="lol-skills__title" data-field="title">${titleHtml}</h2>
          <p class="lol-skills__desc" data-field="desc">${escHtml(c.description)}</p>
          <div class="lol-skills__grid" role="list" aria-label="Skill areas">
            ${items}
          </div>
        </div>

        <div class="lol-skills__img-wrap">
          <img class="lol-skills__img"
               src="${escHtml(c.image_url)}"
               alt="Skills section image" loading="lazy"
               width="700" height="900">
        </div>

      </div>
    </section>`;
  }

  // ── SECTION 6: Stats ──────────────────────────────────────────────────
  _stats() {
    const items = this._statsContent.map((s, i) => `
      <div class="lol-stats__item" data-stat-index="${i}">
        <div class="lol-stats__num" data-stat="num" aria-label="${escHtml(s.num)} ${escHtml(s.label)}">${escHtml(s.num)}</div>
        <div class="lol-stats__label" data-stat="label" aria-hidden="true">${escHtml(s.label)}</div>
      </div>
    `).join('');

    return `
    <section class="lol-stats" aria-label="Key figures">
      <div class="lol-stats__inner">${items}</div>
    </section>`;
  }

  // ── SECTION 7: Contact CTA + Form ─────────────────────────────────────
  _contact() {
    return `
    <section class="lol-contact" id="contact" aria-label="Contact">
      <div class="lol-contact__bg" aria-hidden="true"></div>
      <div class="lol-contact__inner">
        <p class="lol-contact__eyebrow">${t('contact.eyebrow')}</p>
        <h2 class="lol-contact__title">
          ${t('contact.title')}
        </h2>
        <form class="contact-form" id="contact-form" novalidate aria-label="${t('contact.formLabel')}">
          <!-- Honeypot — hidden from real users, bots fill it in -->
          <input type="text" name="website" id="contact-honeypot"
                 tabindex="-1" autocomplete="off" aria-hidden="true"
                 style="position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;" />
          <div class="contact-form__row">
            <div class="contact-form__field">
              <label for="contact-name" class="contact-form__label">${t('contact.name')} <span aria-hidden="true" class="required-mark">*</span></label>
              <input type="text" id="contact-name" name="name" class="contact-form__input"
                     required autocomplete="name" placeholder="${t('contact.namePlaceholder')}" maxlength="100" />
            </div>
            <div class="contact-form__field">
              <label for="contact-email" class="contact-form__label">${t('contact.email')} <span aria-hidden="true" class="required-mark">*</span></label>
              <input type="email" id="contact-email" name="email" class="contact-form__input"
                     required autocomplete="email" placeholder="${t('contact.emailPlaceholder')}" maxlength="200" />
            </div>
          </div>
          <div class="contact-form__field">
            <label for="contact-message" class="contact-form__label">${t('contact.message')} <span aria-hidden="true" class="required-mark">*</span></label>
            <textarea id="contact-message" name="message" class="contact-form__textarea"
                      required rows="5" placeholder="${t('contact.messagePlaceholder')}" maxlength="2000"></textarea>
          </div>
          <div aria-live="polite" id="contact-status" class="contact-form__status"></div>
          <button type="submit" class="lol-contact__btn contact-form__submit" id="contact-submit">
            ${t('contact.send')}
          </button>
        </form>

      </div>
    </section>`;
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  _footer() {
    return `
    <footer class="lol-footer">

      <!-- Home + the product's public IA (identity.surface.nav minus its
           hidden routes), the same list the top nav and the sitemap use. -->
      <nav class="lol-footer__top" aria-label="${t('nav.footerNav')}">
        <a href="${href('/')}"             class="lol-footer__nav-link">${t('nav.home')}</a>
        ${publicNav().map(e => `<a href="${href(e.route)}" class="lol-footer__nav-link">${escHtml(t(e.labelKey))}</a>`).join('\n        ')}
      </nav>

      <div class="lol-footer__social">
        <a id="footer-email-icon" href="${href(isHiddenRoute('/hafa-samband') ? '/' : '/hafa-samband')}"
           class="lol-footer__social-icon" aria-label="Send email">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <polyline points="2,4 12,13 22,4"/>
          </svg>
        </a>
      </div>

      <div class="lol-footer__brand">
        <div class="lol-footer__logo">${escHtml(getIdentity().brand.name)}</div>
        <p class="lol-footer__copy">
          &copy; ${new Date().getFullYear()} ${t('footer.companyLine')}
        </p>
        <nav class="lol-footer__legal" aria-label="${t('nav.legalNav')}">
          <a href="${href('/personuvernd')}" class="lol-footer__legal-link">${t('footer.privacy')}</a>
          <a href="${href('/terms')}"   class="lol-footer__legal-link">${t('footer.terms')}</a>
          <!-- CC BY attribution for the scene photography — the credits file
               is generated by scripts/build-iceland-scenes.js. Served as a
               plain document; the license requires reasonable attribution,
               and a legal-row link is the standard web form of it. -->
          <a href="/assets/iceland/CREDITS.md" class="lol-footer__legal-link" target="_blank" rel="noopener">${t('footer.photoCredits')}</a>
        </nav>
      </div>

    </footer>`;
  }

  // ── Footer email icon — the mailto is set here, not in the markup, so the
  // address never lives in the static HTML. It is the product's
  // (identity.organization.email), the same address the Organization JSON-LD
  // carries; the href in the markup is the contact page, for a page whose
  // scripts never ran.
  _initFooterLinks(view) {
    const icon = view.querySelector('#footer-email-icon');
    const email = getIdentity().organization.email;
    if (icon && email) icon.href = `mailto:${email}`;
  }

  // ── Hero video — ensure autoplay fires after mount ────────────────────
  // ── Iceland scene: hero ─────────────────────────────────────────────────
  // The stage is prepended into the section so the existing hero content
  // (data-hero-field spans, CTA, scroll hint) stacks above it unchanged.
  _initHeroScene(view) {
    const host = view.querySelector('.lol-hero--scene');
    if (!host) return;
    const stage = new SceneStage('home', { variant: 'hero' });
    host.prepend(stage.el());
    stage.mount();
    this._scenes.push(stage);
  }

  // ── DORMANT since 2026-08-22: Iceland scene section bands (tiers/steps).
  // Not called — the sections it decorates are dormant too, and the band
  // cutovers are what Halli reverted. Kept with them for the content pass. ──
  _initBandScenes(view) {
    const bands = [
      ['homeTiers', view.querySelector('.home-tiers')],
      ['homeSteps', view.querySelector('.home-steps')],
    ];
    for (const [key, section] of bands) {
      if (!section) continue;
      const stage = new SceneStage(key, { variant: 'band' });
      const el = stage.el();
      el.classList.add('ice-scene--backdrop');
      section.classList.add('home-section--scene');
      section.prepend(el);
      stage.mount();
      this._scenes.push(stage);
    }
  }

  destroy() {
    this._scenes.forEach((s) => s.destroy());
    this._scenes = [];
    if (this._unsubHeroMotion) { this._unsubHeroMotion(); this._unsubHeroMotion = null; }
  }

  _initHeroVideo(view) {
    if (this._unsubHeroMotion) { this._unsubHeroMotion(); this._unsubHeroMotion = null; }
    const video = view.querySelector('.lol-hero__bg');
    if (!video) return;

    // iOS requires muted + playsInline to be set on the element before play()
    // is invoked.  The HTML attributes cover this, but set them on the property
    // side too so that any runtime mutation (e.g. reduced-data mode) can't
    // leave us showing the native start-playback overlay.
    video.muted       = true;
    video.playsInline = true;

    // The clip is a continuous camera move, so it obeys utils/motion.js like
    // every other animated surface: reduced motion (or Save-Data) keeps the
    // poster still, and flipping the OS setting mid-visit starts or stops it.
    this._unsubHeroMotion = onMotionChange(() => {
      if (motionAllowed()) {
        video.preload = 'auto';
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
    if (!motionAllowed()) {
      video.pause();
      return;
    }

    requestAnimationFrame(() => {
      video.play().catch(() => {
        const resume = () => {
          if (motionAllowed()) video.play().catch(() => {});
          document.removeEventListener('click',      resume);
          document.removeEventListener('touchstart', resume);
        };
        document.addEventListener('click',      resume, { once: true });
        document.addEventListener('touchstart', resume, { once: true });
      });
    });
  }

  // ── Projects section — category switching logic ────────────────────────
  _initProjects(view) {
    const cats    = view.querySelectorAll('.lol-projects__cat');
    const img     = view.querySelector('#projects-preview-img');
    const title   = view.querySelector('#projects-preview-title');
    const type    = view.querySelector('#projects-preview-type');
    const contact = view.querySelector('#contact-btn');

    if (contact) {
      contact.addEventListener('click', e => {
        e.preventDefault();
        const section = document.getElementById('contact');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
      });
    }

    cats.forEach(cat => {
      const activate = () => {
        const id   = cat.dataset.cat;
        const data = this._discipline.categories.find(c => c.id === id);
        if (!data) return;

        cats.forEach(c => {
          c.classList.toggle('active', c.dataset.cat === id);
          c.setAttribute('aria-selected', c.dataset.cat === id ? 'true' : 'false');
          c.setAttribute('tabindex', c.dataset.cat === id ? '0' : '-1');
        });

        img.style.opacity = '0';
        setTimeout(() => {
          img.src           = data.img;
          img.alt           = `${data.label} projects preview`;
          title.textContent = data.label;
          type.textContent  = data.type;
          img.style.opacity = '1';
        }, 350);
      };

      cat.addEventListener('click', activate);
      cat.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
  }

  // ── Skills + Stats section — inline edit for admin/moderator ───────────
  _initSkillsEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const section     = view.querySelector('.lol-skills');
    const statsSection = view.querySelector('.lol-stats');
    if (!section) return;

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className   = 'lol-skills__edit-btn';
    editBtn.id          = 'home-edit-btn';
    editBtn.type        = 'button';
    editBtn.setAttribute('aria-label', 'Edit skills and stats sections');
    editBtn.setAttribute('data-testid', 'edit-page-btn');
    editBtn.innerHTML   = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit Section`;
    section.style.position = 'relative';
    section.appendChild(editBtn);

    // Save / cancel bar — attached to stats section (bottom of editable area)
    const controlsParent = statsSection || section;
    controlsParent.style.position = 'relative';
    const controls = document.createElement('div');
    controls.className  = 'lol-skills__edit-controls lol-skills__edit-controls--hidden';
    controls.id         = 'home-edit-bar';
    controls.setAttribute('data-testid', 'edit-controls');
    controls.innerHTML  = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="lol-skills__save-btn" id="home-edit-save" data-testid="edit-save-btn">Save Changes</button>
      <button type="button" class="lol-skills__cancel-btn" id="home-edit-cancel" data-testid="edit-cancel-btn">Cancel</button>
      <span   class="lol-skills__edit-status" aria-live="polite"></span>`;
    controlsParent.appendChild(controls);

    let _snapshot = null;      // skills snapshot for cancel
    let _statsSnapshot = null; // stats snapshot for cancel

    editBtn.addEventListener('click', () => {
      _snapshot = JSON.parse(JSON.stringify(this._content));
      _statsSnapshot = JSON.parse(JSON.stringify(this._statsContent));
      this._enterEdit(section, editBtn, controls, statsSection);
    });

    controls.querySelector('.lol-skills__save-btn').addEventListener('click', () =>
      this._saveEdit(section, controls, statsSection)
    );

    controls.querySelector('.lol-skills__cancel-btn').addEventListener('click', () => {
      this._exitEdit(section, editBtn, controls, statsSection);
      if (_snapshot) this._restoreEdit(section, _snapshot);
      if (_statsSnapshot) this._restoreStatsEdit(statsSection, _statsSnapshot);
    });
  }

  _enterEdit(section, editBtn, controls, statsSection) {
    section.classList.add('lol-skills--editing');
    editBtn.classList.add('lol-skills__edit-btn--hidden');
    controls.classList.remove('lol-skills__edit-controls--hidden');
    checkUntranslated('home_skills', controls);

    // Make skills text fields editable
    section.querySelectorAll('[data-field], [data-item]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });

    // Make stats fields editable
    if (statsSection) {
      statsSection.classList.add('lol-stats--editing');
      statsSection.querySelectorAll('[data-stat]').forEach(el => {
        el.contentEditable = 'true';
        el.spellcheck      = true;
      });
    }

    // Image overlay
    const imgWrap = section.querySelector('.lol-skills__img-wrap');
    const overlay = document.createElement('div');
    overlay.className = 'lol-skills__img-overlay';
    overlay.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      <span>Change Image</span>
      <input type="file" accept="image/jpeg,image/png,image/webp"
             class="lol-img-file-input" aria-label="Upload replacement image">`;
    imgWrap.appendChild(overlay);

    overlay.querySelector('.lol-img-file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) this._uploadImage(file, section, controls);
    });
  }

  _exitEdit(section, editBtn, controls, statsSection) {
    section.classList.remove('lol-skills--editing');
    editBtn.classList.remove('lol-skills__edit-btn--hidden');
    controls.classList.add('lol-skills__edit-controls--hidden');
    controls.querySelector('.lol-skills__edit-status').textContent = '';

    section.querySelectorAll('[data-field], [data-item]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });

    section.querySelector('.lol-skills__img-overlay')?.remove();

    // Exit stats edit
    if (statsSection) {
      statsSection.classList.remove('lol-stats--editing');
      statsSection.querySelectorAll('[data-stat]').forEach(el => {
        el.contentEditable = 'false';
        el.removeAttribute('contenteditable');
      });
    }
  }

  _restoreEdit(section, snapshot) {
    const titleHtml = escHtml(snapshot.title).replace(/\n/g, '<br>');
    section.querySelector('[data-field="eyebrow"]').innerHTML = escHtml(snapshot.eyebrow);
    section.querySelector('[data-field="title"]').innerHTML   = titleHtml;
    section.querySelector('[data-field="desc"]').innerHTML    = escHtml(snapshot.description);
    section.querySelector('.lol-skills__img').src             = snapshot.image_url;

    section.querySelectorAll('[data-item-index]').forEach(el => {
      const i = parseInt(el.dataset.itemIndex, 10);
      if (!snapshot.items[i]) return;
      el.querySelector('[data-item="label"]').innerHTML = escHtml(snapshot.items[i].label);
      el.querySelector('[data-item="value"]').innerHTML = escHtml(snapshot.items[i].value);
    });

    this._content = snapshot;
  }

  _restoreStatsEdit(statsSection, snapshot) {
    if (!statsSection) return;
    statsSection.querySelectorAll('[data-stat-index]').forEach(el => {
      const i = parseInt(el.dataset.statIndex, 10);
      if (!snapshot[i]) return;
      el.querySelector('[data-stat="num"]').innerHTML   = escHtml(snapshot[i].num);
      el.querySelector('[data-stat="label"]').innerHTML = escHtml(snapshot[i].label);
    });
    this._statsContent = snapshot;
  }

  async _uploadImage(file, section, controls) {
    const status = controls.querySelector('.lol-skills__edit-status');
    status.textContent = 'Uploading…';

    try {
      const token = await getCSRFToken();
      const fd    = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/v1/content/home_skills/image', {
        method:      'POST',
        credentials: 'include',
        headers:     token ? { 'X-CSRF-Token': token } : {},
        body:        fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');

      const { image_url } = await res.json();
      section.querySelector('.lol-skills__img').src = image_url;
      this._content = { ...this._content, image_url };
      status.textContent = 'Image updated.';
    } catch (err) {
      status.textContent = `Upload error: ${err.message}`;
    }
  }

  async _saveEdit(section, controls, statsSection) {
    const status = controls.querySelector('.lol-skills__edit-status');
    status.textContent = 'Saving…';

    // Collect skills text from DOM
    const eyebrow = section.querySelector('[data-field="eyebrow"]')?.innerText.trim() ?? this._content.eyebrow;
    const title   = section.querySelector('[data-field="title"]')?.innerText.trim()   ?? this._content.title;
    const desc    = section.querySelector('[data-field="desc"]')?.innerText.trim()    ?? this._content.description;

    const items = [];
    section.querySelectorAll('[data-item-index]').forEach(el => {
      items.push({
        label: el.querySelector('[data-item="label"]')?.innerText.trim() ?? '',
        value: el.querySelector('[data-item="value"]')?.innerText.trim() ?? '',
      });
    });

    const updated = { ...this._content, eyebrow, title, description: desc, items };

    // Collect stats from DOM
    const statsItems = [];
    if (statsSection) {
      statsSection.querySelectorAll('[data-stat-index]').forEach(el => {
        statsItems.push({
          num:   el.querySelector('[data-stat="num"]')?.innerText.trim() ?? '',
          label: el.querySelector('[data-stat="label"]')?.innerText.trim() ?? '',
        });
      });
    }

    try {
      const token = await getCSRFToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
      };

      // Save both in parallel
      const locale = encodeURIComponent(window.__locale || 'en');
      const [skillsRes, statsRes] = await Promise.all([
        fetch(`/api/v1/content/home_skills?locale=${locale}`, {
          method: 'PUT', credentials: 'include', headers,
          body: JSON.stringify(updated),
        }),
        statsSection
          ? fetch(`/api/v1/content/home_stats?locale=${locale}`, {
              method: 'PUT', credentials: 'include', headers,
              body: JSON.stringify(statsItems),
            })
          : Promise.resolve(null),
      ]);

      if (!skillsRes.ok) throw new Error((await skillsRes.json()).error || 'Skills save failed');
      if (statsRes && !statsRes.ok) throw new Error((await statsRes.json()).error || 'Stats save failed');

      this._content = await skillsRes.json();
      if (statsRes) this._statsContent = await statsRes.json();

      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }

  // ── Discipline (Projects categories) — inline edit for admin/moderator ──
  _initDisciplineEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const section = view.querySelector('.lol-projects');
    if (!section) return;

    const editBtn = document.createElement('button');
    editBtn.className = 'lol-projects__edit-btn';
    editBtn.id        = 'discipline-edit-btn';
    editBtn.type      = 'button';
    editBtn.setAttribute('aria-label', 'Edit discipline section');
    editBtn.setAttribute('data-testid', 'edit-discipline-btn');
    editBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit Section`;
    section.style.position = 'relative';
    section.appendChild(editBtn);

    const controls = document.createElement('div');
    controls.className = 'lol-projects__edit-controls lol-projects__edit-controls--hidden';
    controls.id        = 'discipline-edit-bar';
    controls.setAttribute('data-testid', 'edit-discipline-controls');
    controls.innerHTML = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="lol-projects__save-btn" data-testid="edit-discipline-save">Save Changes</button>
      <button type="button" class="lol-projects__cancel-btn" data-testid="edit-discipline-cancel">Cancel</button>
      <span class="lol-projects__edit-status" aria-live="polite"></span>
      <span class="lol-projects__edit-hint">Tip: select a category to change its image.</span>`;
    section.appendChild(controls);

    let _snapshot = null;

    editBtn.addEventListener('click', () => {
      _snapshot = JSON.parse(JSON.stringify(this._discipline));
      this._enterDisciplineEdit(section, editBtn, controls);
    });

    controls.querySelector('.lol-projects__save-btn').addEventListener('click', () =>
      this._saveDisciplineEdit(section, controls)
    );

    controls.querySelector('.lol-projects__cancel-btn').addEventListener('click', () => {
      this._exitDisciplineEdit(section, editBtn, controls);
      if (_snapshot) this._restoreDisciplineEdit(section, _snapshot);
    });
  }

  _enterDisciplineEdit(section, editBtn, controls) {
    section.classList.add('lol-projects--editing');
    editBtn.classList.add('lol-projects__edit-btn--hidden');
    controls.classList.remove('lol-projects__edit-controls--hidden');
    checkUntranslated('home_discipline', controls);

    section.querySelectorAll('[data-disc-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });

    // Each category tab: label is editable inline. Type is edited via the
    // active-preview area (reflects whichever tab is selected).
    section.querySelectorAll('.lol-projects__cat [data-cat-field="label"]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });
    section.querySelectorAll('.lol-projects__preview-name [data-cat-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });

    // Image overlay on the preview circle — uploads for whichever category
    // is currently active. To change another category's image, admin selects
    // that tab first.
    const circle = section.querySelector('.lol-projects__circle');
    if (circle && !circle.querySelector('.lol-projects__img-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'lol-projects__img-overlay';
      overlay.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span>Change Image</span>
        <input type="file" accept="image/jpeg,image/png,image/webp"
               class="lol-img-file-input" aria-label="Upload replacement image for active category">`;
      circle.appendChild(overlay);

      overlay.querySelector('.lol-img-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) this._uploadDisciplineImage(file, section, controls);
        e.target.value = ''; // allow re-upload of same filename
      });
    }

    // Sync preview label/type back to the active category as user edits them
    const previewTitle = section.querySelector('#projects-preview-title');
    const previewType  = section.querySelector('#projects-preview-type');
    const sync = () => {
      const active = section.querySelector('.lol-projects__cat.active');
      if (!active) return;
      const idx = parseInt(active.dataset.catIndex, 10);
      const cat = this._discipline.categories[idx];
      if (!cat) return;
      cat.label = previewTitle.innerText.trim();
      cat.type  = previewType.innerText.trim();
      // Mirror label change back into the tab itself
      const tabLabel = active.querySelector('[data-cat-field="label"]');
      if (tabLabel && tabLabel.innerText.trim() !== cat.label) {
        tabLabel.innerText = cat.label;
      }
    };
    previewTitle.addEventListener('input', sync);
    previewType.addEventListener('input', sync);

    // Sync tab label edits back into in-memory state too
    section.querySelectorAll('.lol-projects__cat').forEach(tab => {
      const labelEl = tab.querySelector('[data-cat-field="label"]');
      if (!labelEl) return;
      labelEl.addEventListener('input', () => {
        const idx = parseInt(tab.dataset.catIndex, 10);
        const cat = this._discipline.categories[idx];
        if (!cat) return;
        cat.label = labelEl.innerText.trim();
        if (tab.classList.contains('active') && previewTitle) {
          previewTitle.innerText = cat.label;
        }
      });
    });
  }

  _exitDisciplineEdit(section, editBtn, controls) {
    section.classList.remove('lol-projects--editing');
    editBtn.classList.remove('lol-projects__edit-btn--hidden');
    controls.classList.add('lol-projects__edit-controls--hidden');
    controls.querySelector('.lol-projects__edit-status').textContent = '';

    section.querySelectorAll('[data-disc-field], [data-cat-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });

    section.querySelector('.lol-projects__img-overlay')?.remove();
  }

  _restoreDisciplineEdit(section, snapshot) {
    section.querySelector('[data-disc-field="eyebrow"]').innerText     = snapshot.eyebrow;
    section.querySelector('[data-disc-field="heading"]').innerText     = snapshot.heading;
    section.querySelector('[data-disc-field="description"]').innerText = snapshot.description;

    section.querySelectorAll('.lol-projects__cat').forEach(tab => {
      const idx = parseInt(tab.dataset.catIndex, 10);
      const cat = snapshot.categories[idx];
      if (!cat) return;
      const labelEl = tab.querySelector('[data-cat-field="label"]');
      if (labelEl) labelEl.innerText = cat.label;
    });

    // Restore preview to the currently-active tab
    const active = section.querySelector('.lol-projects__cat.active');
    const idx = active ? parseInt(active.dataset.catIndex, 10) : 0;
    const cat = snapshot.categories[idx] || snapshot.categories[0];
    const img   = section.querySelector('#projects-preview-img');
    const title = section.querySelector('#projects-preview-title');
    const type  = section.querySelector('#projects-preview-type');
    if (img)   { img.src = cat.img; img.alt = `${cat.label} projects preview`; }
    if (title) title.innerText = cat.label;
    if (type)  type.innerText  = cat.type;

    this._discipline = snapshot;
  }

  async _uploadDisciplineImage(file, section, controls) {
    const status = controls.querySelector('.lol-projects__edit-status');
    const active = section.querySelector('.lol-projects__cat.active');
    if (!active) { status.textContent = 'Select a category first.'; return; }
    const idx = parseInt(active.dataset.catIndex, 10);
    const cat = this._discipline.categories[idx];
    if (!cat) { status.textContent = 'Active category not found.'; return; }

    status.textContent = `Uploading image for ${cat.label}…`;

    try {
      const token = await getCSRFToken();
      const fd    = new FormData();
      fd.append('file', file);

      // Composite key for nice filenames; merge=false skips a useless DB row
      // (the URL is persisted via the next PUT against home_discipline).
      const key = `home_discipline_${cat.id}`;
      const res = await fetch(`/api/v1/content/${encodeURIComponent(key)}/image?merge=false`, {
        method:      'POST',
        credentials: 'include',
        headers:     token ? { 'X-CSRF-Token': token } : {},
        body:        fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');

      const { image_url } = await res.json();
      cat.img = image_url;
      const img = section.querySelector('#projects-preview-img');
      if (img) img.src = image_url;
      status.textContent = `Image updated for ${cat.label}. Click Save to persist.`;
    } catch (err) {
      status.textContent = `Upload error: ${err.message}`;
    }
  }

  async _saveDisciplineEdit(section, controls) {
    const status = controls.querySelector('.lol-projects__edit-status');
    status.textContent = 'Saving…';

    // Collect section text from DOM
    const eyebrow     = section.querySelector('[data-disc-field="eyebrow"]')?.innerText.trim()     ?? this._discipline.eyebrow;
    const heading     = section.querySelector('[data-disc-field="heading"]')?.innerText.trim()     ?? this._discipline.heading;
    const description = section.querySelector('[data-disc-field="description"]')?.innerText.trim() ?? this._discipline.description;

    // Collect per-category data — labels come from tab DOM, types come from
    // the live `_discipline.categories[].type` (synced in _enterDisciplineEdit).
    // For the active category, also capture the current preview title/type.
    const categories = this._discipline.categories.map((cat, i) => {
      const tab = section.querySelector(`.lol-projects__cat[data-cat-index="${i}"]`);
      const labelEl = tab?.querySelector('[data-cat-field="label"]');
      return {
        id:    cat.id,
        label: labelEl?.innerText.trim() || cat.label,
        type:  cat.type,
        img:   cat.img,
      };
    });

    const updated = { eyebrow, heading, description, categories };

    try {
      const token = await getCSRFToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
      };

      const res = await fetch(`/api/v1/content/home_discipline?locale=${encodeURIComponent(window.__locale || 'en')}`, {
        method: 'PUT', credentials: 'include', headers,
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

      this._discipline = await res.json();
      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }

  // ── Contact form — fetch submission ───────────────────────────────────
  _initContactForm(view) {
    const form   = view.querySelector('#contact-form');
    const status = view.querySelector('#contact-status');
    const submit = view.querySelector('#contact-submit');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const honeypot = form.querySelector('#contact-honeypot').value;
      const name    = form.querySelector('#contact-name').value.trim();
      const email   = form.querySelector('#contact-email').value.trim();
      const message = form.querySelector('#contact-message').value.trim();

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
          body: JSON.stringify({ name, email, message, website: honeypot }),
        });

        if (res.ok) {
          status.className = 'contact-form__status contact-form__status--success';
          status.textContent = t('contact.sent');
          form.reset();
        } else {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Something went wrong.');
        }
      } catch (err) {
        status.className = 'contact-form__status contact-form__status--error';
        status.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = t('contact.send');
      }
    });
  }
}
